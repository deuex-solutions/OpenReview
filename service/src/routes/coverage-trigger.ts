import { randomUUID } from 'node:crypto';

import { GitHubClient } from '@openreview/core';
import { Router, json } from 'express';
import { z } from 'zod';

import type { ServiceConfig } from '../config.js';
import { CoverageServiceClient } from '../dispatch/coverage/index.js';
import type { GitHubAuth } from '../github/auth.js';
import type { ReviewQueue } from '../jobs/queue.js';
import type { CoverageAnalysisJob } from '../jobs/types.js';
import type { Logger } from '../logger.js';

/**
 * Manual trigger for the coverage → stacked-test-PR pipeline.
 *
 * Use case: the user already POSTed `/repositories/:id/analyze` to the
 * coverage service directly (e.g. via curl, with no GitHub webhook
 * configured on the target repo). They hand the returned `prRunId` to
 * this endpoint and OpenReview takes over: polls the run to completion,
 * opens a stacked test PR with the generated tests, and posts a
 * coverage-delta comment on the original PR.
 *
 * Wire shape:
 *
 *   POST /coverage-runs/trigger
 *   { "prRunId": "cmqgiif010005cb2572tact4a" }
 *
 *   → 202 { "status": "accepted", "prRunId": "...", "headSha": "..." }
 *
 * No auth on this endpoint — it is intended for local-dev / private-network
 * use only. Do not expose to the public internet without a reverse proxy
 * that adds auth.
 */
export function createCoverageTriggerRouter(deps: CoverageTriggerDeps): Router {
  const router = Router();

  router.post('/coverage-runs/trigger', json({ limit: '64kb' }), async (req, res) => {
    try {
      const result = await handleCoverageTrigger(req.body, deps);
      res.status(result.status).json(result.body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error({ err: msg }, 'coverage-runs/trigger crashed');
      res.status(500).json({ error: 'internal error', detail: msg });
    }
  });

  return router;
}

/* -------------------------------------------------------------------- */
/*  Pure handler — exported for unit testing                             */
/* -------------------------------------------------------------------- */

export interface CoverageTriggerDeps {
  cfg: ServiceConfig;
  logger: Logger;
  queue: Pick<ReviewQueue, 'enqueue'>;
  auth: GitHubAuth;
  /** Factory injection for tests. */
  coverageClientFactory?: (deps: {
    cfg: ServiceConfig;
    logger: Logger;
  }) => Pick<CoverageServiceClient, 'getPrRun'>;
  /** Factory injection for tests. */
  githubClientFactory?: (opts: {
    token: string;
    owner: string;
    repo: string;
  }) => Pick<GitHubClient, 'getPR'>;
}

const TriggerRequestSchema = z.object({
  prRunId: z.string().trim().min(1, 'prRunId is required'),
});

export interface TriggerOutcome {
  status: 202 | 400 | 404 | 422 | 503;
  body: Record<string, unknown>;
}

export async function handleCoverageTrigger(
  rawBody: unknown,
  deps: CoverageTriggerDeps,
): Promise<TriggerOutcome> {
  if (!deps.cfg.coverageServiceEnabled || !deps.cfg.coverageServiceUrl) {
    return {
      status: 503,
      body: {
        error:
          'coverage-service integration is disabled — set COVERAGE_SERVICE_ENABLED=true and COVERAGE_SERVICE_URL in the OpenReview service .env',
      },
    };
  }

  const parsed = TriggerRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: 'invalid request body',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
    };
  }
  const { prRunId } = parsed.data;

  const coverage = (deps.coverageClientFactory ?? defaultCoverageClientFactory)(
    deps,
  );

  // 1) Resolve the run → learn repository + prNumber.
  let run;
  try {
    run = await coverage.getPrRun(prRunId);
  } catch (err) {
    const status = extractHttpStatus(err);
    if (status === 404) {
      return { status: 404, body: { error: `prRun ${prRunId} not found` } };
    }
    throw err;
  }

  const [owner, repo] = splitRepository(run.repository);
  if (!owner || !repo) {
    return {
      status: 422,
      body: {
        error: `coverage-service returned malformed repository '${run.repository}' (expected 'owner/repo')`,
      },
    };
  }

  // 2) Resolve PR metadata via GitHub — we need head/base sha+ref + title.
  const token = await deps.auth.getTokenFor(owner, repo);
  const ghClient = (deps.githubClientFactory ??
    ((opts) => new GitHubClient(opts)))({ token, owner, repo });

  let prMeta;
  try {
    prMeta = await ghClient.getPR(run.prNumber);
  } catch (err) {
    const status = extractHttpStatus(err);
    if (status === 404) {
      return {
        status: 404,
        body: {
          error: `PR ${run.repository}#${run.prNumber} not found on GitHub (token scope?)`,
        },
      };
    }
    throw err;
  }

  // 3) Enqueue the existing coverage-analysis job with prRunId pre-populated.
  // The processor's retry-resume branch will skip POST /analyze and go straight
  // to polling + opening the stacked PR.
  const job: CoverageAnalysisJob = {
    kind: 'coverage-analysis',
    deliveryId: `manual-${randomUUID()}`,
    owner,
    repo,
    prNumber: run.prNumber,
    headSha: prMeta.head.sha,
    baseSha: prMeta.base.sha,
    headRef: prMeta.head.ref,
    baseRef: prMeta.base.ref,
    title: prMeta.title,
    prRunId,
  };

  const enqueued = await deps.queue.enqueue(job);

  deps.logger.info(
    {
      prRunId,
      repo: run.repository,
      prNumber: run.prNumber,
      headSha: prMeta.head.sha,
      enqueued,
    },
    'coverage-runs/trigger accepted',
  );

  return {
    status: 202,
    body: {
      status: enqueued ? 'accepted' : 'duplicate',
      message: enqueued
        ? 'Coverage analysis will be polled and a stacked test PR will be opened.'
        : 'A job for this PR head SHA is already in flight; the existing run will produce the PR.',
      prRunId,
      repository: run.repository,
      prNumber: run.prNumber,
      headSha: prMeta.head.sha,
    },
  };
}

/* -------------------------------------------------------------------- */
/*  Helpers                                                              */
/* -------------------------------------------------------------------- */

function splitRepository(repository: string): [string, string] {
  const [owner = '', repo = ''] = repository.split('/', 2);
  return [owner.trim(), repo.trim()];
}

function extractHttpStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const resp = (err as { response?: { status?: unknown } }).response;
  if (resp && typeof resp.status === 'number') return resp.status;
  return undefined;
}

function defaultCoverageClientFactory(deps: {
  cfg: ServiceConfig;
  logger: Logger;
}): CoverageServiceClient {
  return new CoverageServiceClient({
    baseUrl: deps.cfg.coverageServiceUrl,
    apiKey: deps.cfg.coverageServiceApiKey || undefined,
    pollIntervalMs: deps.cfg.coverageServicePollIntervalMs,
    pollTimeoutMs: deps.cfg.coverageServicePollTimeoutMs,
    logger: deps.logger,
  });
}
