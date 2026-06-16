import axios from 'axios';
import type { AxiosInstance } from 'axios';

import type { Logger } from '../../logger.js';

import {
  PrRunSchema,
  RepositoryListSchema,
  RepositorySchema,
  TERMINAL_PR_RUN_STATUSES,
  TriggerAnalysisResponseSchema,
  type CreateRepositoryRequest,
  type PrRun,
  type Repository,
  type TriggerAnalysisResponse,
} from './types.js';

export interface CoverageServiceClientOptions {
  baseUrl: string;
  /** Optional shared secret; sent as `x-api-key`. */
  apiKey?: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  logger: Logger;
  /** Per-request HTTP timeout — defaults to 30s. */
  requestTimeoutMs?: number;
  /** Injection seam for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injection seam for tests. */
  http?: AxiosInstance;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

/**
 * Thin HTTP client for the Coverage Service.
 *
 * Three methods correspond 1:1 to the service's public endpoints:
 *   - `findOrCreateRepository`   — POST /repositories  (with a GET fallback for dedup)
 *   - `triggerAnalysis`          — POST /repositories/:id/analyze
 *   - `getPrRun` / `waitForPrRun`— GET  /pr-runs/:id
 *
 * The client owns no state beyond the axios instance, so it is safe to
 * construct one per job. Durability across worker restarts comes from BullMQ
 * (job retry) + `CoverageAnalysisJob.prRunId` being persisted to job.data.
 */
export class CoverageServiceClient {
  private readonly http: AxiosInstance;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: CoverageServiceClientOptions) {
    this.sleep = opts.sleep ?? defaultSleep;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (opts.apiKey && opts.apiKey.length > 0) {
      headers['x-api-key'] = opts.apiKey;
    }

    this.http =
      opts.http ??
      axios.create({
        baseURL: opts.baseUrl.replace(/\/+$/, ''),
        timeout: opts.requestTimeoutMs ?? 30_000,
        headers,
      });
  }

  /* ----------------------------------------------------------------- */
  /*  Repositories                                                      */
  /* ----------------------------------------------------------------- */

  /**
   * Look the repo up by `githubRepo` and POST /repositories if it is not
   * already registered. Idempotent at the API level — the coverage service
   * stores `githubRepo` with a unique constraint.
   */
  async findOrCreateRepository(input: CreateRepositoryRequest): Promise<Repository> {
    const existing = await this.findRepositoryByGithubRepo(input.githubRepo);
    if (existing) {
      this.opts.logger.debug(
        { repoId: existing.id, githubRepo: input.githubRepo },
        'coverage-service: repository already registered',
      );
      return existing;
    }

    this.opts.logger.info(
      { githubRepo: input.githubRepo },
      'coverage-service: registering repository',
    );
    try {
      const { data } = await this.http.post('/repositories', input);
      return RepositorySchema.parse(data);
    } catch (err) {
      // Race: another worker may have created the repo between our list and
      // our create. Fall back to a second lookup.
      if (isUniqueViolation(err)) {
        const recheck = await this.findRepositoryByGithubRepo(input.githubRepo);
        if (recheck) return recheck;
      }
      throw err;
    }
  }

  /** GET /repositories then filter client-side. */
  private async findRepositoryByGithubRepo(
    githubRepo: string,
  ): Promise<Repository | null> {
    const { data } = await this.http.get('/repositories');
    const list = RepositoryListSchema.parse(data);
    return list.find((r) => r.githubRepo === githubRepo) ?? null;
  }

  /* ----------------------------------------------------------------- */
  /*  Analysis                                                          */
  /* ----------------------------------------------------------------- */

  /** POST /repositories/:repoId/analyze — returns `{ prRunId, ... }`. */
  async triggerAnalysis(
    repoId: string,
    prNumber: number,
  ): Promise<TriggerAnalysisResponse> {
    this.opts.logger.info(
      { repoId, prNumber },
      'coverage-service: triggering analysis',
    );
    const { data } = await this.http.post(
      `/repositories/${encodeURIComponent(repoId)}/analyze`,
      { prNumber },
    );
    return TriggerAnalysisResponseSchema.parse(data);
  }

  /* ----------------------------------------------------------------- */
  /*  PR runs                                                           */
  /* ----------------------------------------------------------------- */

  /** GET /pr-runs/:id — single fetch, any status. */
  async getPrRun(prRunId: string): Promise<PrRun> {
    const { data } = await this.http.get(
      `/pr-runs/${encodeURIComponent(prRunId)}`,
    );
    return PrRunSchema.parse(data);
  }

  /**
   * Poll `getPrRun` until status is terminal (`COMPLETED` or `FAILED`) or the
   * deadline expires. Backoff is exponential, capped at 30 s.
   *
   * The first poll happens immediately (no initial sleep) so a run that has
   * already completed before we started polling resolves on the very next
   * tick.
   */
  async waitForPrRun(prRunId: string): Promise<PrRun> {
    const deadline = Date.now() + this.opts.pollTimeoutMs;
    let attempt = 0;

    while (Date.now() < deadline) {
      const run = await this.getPrRun(prRunId);
      this.opts.logger.debug(
        { prRunId, attempt, status: run.status },
        'coverage-service: polled pr-run',
      );

      if (TERMINAL_PR_RUN_STATUSES.has(run.status)) return run;

      const waitMs = Math.min(
        this.opts.pollIntervalMs * Math.pow(2, attempt),
        30_000,
      );
      await this.sleep(waitMs);
      attempt += 1;
    }

    throw new Error(
      `Coverage service did not finish within ${this.opts.pollTimeoutMs}ms for pr-run ${prRunId}.`,
    );
  }
}

/* -------------------------------------------------------------------- */
/*  Internal helpers                                                     */
/* -------------------------------------------------------------------- */

/** Match the Prisma unique-constraint error envelope NestJS surfaces. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const status = (err as { response?: { status?: number } }).response?.status;
  if (status === 409) return true;
  if (status === 400 || status === 500) {
    const msg = (err as { response?: { data?: { message?: unknown } } }).response
      ?.data?.message;
    if (typeof msg === 'string' && /unique/i.test(msg)) return true;
  }
  return false;
}
