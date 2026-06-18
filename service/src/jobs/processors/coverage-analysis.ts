import type { GitHubClient } from '@openreview/core';

import type { ServiceConfig } from '../../config.js';
import {
  CoverageServiceClient,
  buildOriginalPRComment,
  buildTestPRBody,
  type CreateRepositoryRequest,
  type PrRun,
} from '../../dispatch/coverage/index.js';
import type { GitHubAuth } from '../../github/auth.js';
import { PRAuthor } from '../../github/pr-author.js';
import type { Logger } from '../../logger.js';
import type { CoverageAnalysisJob } from '../types.js';

import { buildPRRuntime } from './context.js';

/**
 * Dependencies for {@link processCoverageAnalysis}.
 *
 * `persistJobData` is how we make the pipeline tolerant to mid-run worker
 * crashes: once we have a `prRunId` from the coverage service, we push it
 * back into the BullMQ job so a retry resumes polling instead of starting
 * a brand-new run.
 */
export interface CoverageAnalysisDeps {
  auth: GitHubAuth;
  logger: Logger;
  cfg: ServiceConfig;
  /** Wired by the worker to `job.updateData`. */
  persistJobData?: (next: CoverageAnalysisJob) => Promise<void>;
  /** Injection seam for tests. */
  coverageClientFactory?: (deps: {
    cfg: ServiceConfig;
    logger: Logger;
  }) => Pick<
    CoverageServiceClient,
    'findOrCreateRepository' | 'triggerAnalysis' | 'waitForPrRun'
  >;
  /** Injection seam for tests. */
  prAuthorFactory?: (
    client: GitHubClient,
  ) => Pick<PRAuthor, 'branchExists' | 'commitFiles' | 'openOrUpdatePR'>;
}

/**
 * Orchestrate the coverage + test-generation pipeline for one PR.
 *
 * Steps:
 *   1. Ensure the repository is registered (POST /repositories, idempotent).
 *   2. Trigger analysis (POST /repositories/:id/analyze) unless this job
 *      already has a `prRunId` from a prior attempt.
 *   3. Persist the new `prRunId` back to BullMQ so retries resume polling
 *      instead of re-triggering.
 *   4. Poll GET /pr-runs/:id until terminal.
 *   5. On COMPLETED with files: author a stacked PR with the generated tests
 *      targeting the original PR's head branch.
 *   6. Post a coverage-delta summary comment on the original PR.
 *
 * Any failure throws so BullMQ records the attempt and retries per the
 * queue's exponential backoff. The deterministic `jobId` (built from
 * `headSha`) keeps webhook-side dedup intact across delivery retries.
 */
export async function processCoverageAnalysis(
  job: CoverageAnalysisJob,
  deps: CoverageAnalysisDeps,
): Promise<void> {
  const log = deps.logger.child({
    job: 'coverage-analysis',
    repo: `${job.owner}/${job.repo}`,
    prNumber: job.prNumber,
  });

  log.info({ prRunId: job.prRunId }, 'starting coverage analysis');

  const { client, poster } = await buildPRRuntime(job, deps.auth);
  const coverage = (deps.coverageClientFactory ?? defaultCoverageClientFactory)(
    deps,
  );

  // Only post the "started" ack on the first attempt — repeated comments are
  // annoying when BullMQ retries the job.
  if (!job.prRunId) {
    await poster.postAcknowledgement(
      job.prNumber,
      '[INFO] **OpenReview** — Coverage analysis started. A stacked PR with the generated tests will be opened on completion.',
    );
  }

  // ------------------------------------------------------------------ //
  // 1) Ensure repository is registered                                  //
  // ------------------------------------------------------------------ //

  const repoInput: CreateRepositoryRequest = {
    githubRepo: `${job.owner}/${job.repo}`,
    defaultBranch: deps.cfg.coverageServiceDefaultBranch || 'main',
    ...optionalStr('coverageCommand', deps.cfg.coverageServiceCoverageCommand),
    ...optionalStr('testCommand', deps.cfg.coverageServiceTestCommand),
    ...optionalStr('installCommand', deps.cfg.coverageServiceInstallCommand),
  };

  const repo = await coverage.findOrCreateRepository(repoInput);
  log.debug({ repoId: repo.id }, 'repository ready');

  // ------------------------------------------------------------------ //
  // 2) Trigger analysis (skip if we already have a prRunId)             //
  // ------------------------------------------------------------------ //

  let prRunId = job.prRunId;
  if (!prRunId) {
    const accepted = await coverage.triggerAnalysis(repo.id, job.prNumber);
    prRunId = accepted.prRunId;
    log.info({ prRunId }, 'coverage analysis enqueued');

    // 3) Persist for retry-resume. Best-effort: if the persist fails we still
    // proceed with this attempt — a retry would just trigger a fresh run.
    if (deps.persistJobData) {
      try {
        await deps.persistJobData({ ...job, prRunId });
      } catch (err) {
        log.warn(
          { err: (err as Error).message },
          'failed to persist prRunId; retries may re-trigger analysis',
        );
      }
    }
  } else {
    log.info({ prRunId }, 'resuming polling for existing pr-run');
  }

  // ------------------------------------------------------------------ //
  // 4) Poll until terminal                                              //
  // ------------------------------------------------------------------ //

  const run = await coverage.waitForPrRun(prRunId);
  log.info(
    {
      prRunId,
      status: run.status,
      diffCoverageAfter: run.diffCoverageAfter,
      generatedTests: run.generatedTestFiles.length,
    },
    'coverage analysis finished',
  );

  // ------------------------------------------------------------------ //
  // 5) Author stacked PR (if there are generated tests)                  //
  // ------------------------------------------------------------------ //

  let testPrUrl: string | null = null;
  let testPrFileCount = 0;

  if (run.status === 'COMPLETED' && run.generatedTestFiles.length > 0) {
    const { url, count } = await openStackedTestPR({
      job,
      run,
      client,
      cfg: deps.cfg,
      log,
      prAuthorFactory: deps.prAuthorFactory,
    });
    testPrUrl = url;
    testPrFileCount = count;
  }

  // ------------------------------------------------------------------ //
  // 6) Summary comment on the original PR                                //
  // ------------------------------------------------------------------ //

  const summary = buildOriginalPRComment({
    run,
    testPrUrl,
    testPrFileCount,
  });
  await poster.postAcknowledgement(job.prNumber, summary);

  if (run.status === 'FAILED') {
    // Throw so BullMQ records the attempt as failed — useful in the dashboard.
    throw new Error(`coverage service reported FAILED for pr-run ${prRunId}`);
  }
}

/* -------------------------------------------------------------------- */
/*  Helpers                                                              */
/* -------------------------------------------------------------------- */

async function openStackedTestPR(args: {
  job: CoverageAnalysisJob;
  run: PrRun;
  client: GitHubClient;
  cfg: ServiceConfig;
  log: Logger;
  prAuthorFactory?: CoverageAnalysisDeps['prAuthorFactory'];
}): Promise<{ url: string | null; count: number }> {
  const { job, run, client, cfg, log } = args;

  const files = run.generatedTestFiles
    .filter((t) => t.fileContent.length > 0)
    .map((t) => ({ path: t.filePath, content: t.fileContent }));

  if (files.length === 0) {
    log.warn('coverage service reported tests with empty content; skipping PR');
    return { url: null, count: 0 };
  }

  const author = (args.prAuthorFactory ?? ((c) => new PRAuthor(c)))(client);
  const branch = `${cfg.coverageServiceBranchPrefix || 'openreview/tests'}/pr-${job.prNumber}`;
  const branchExisted = await author.branchExists(branch);
  const shortSha = job.headSha.slice(0, 7);

  const commitMessage = branchExisted
    ? `test: OpenReview — refresh tests for PR #${job.prNumber} @ ${shortSha}\n\nAuto-generated by the coverage service.`
    : `test: OpenReview — add ${files.length} generated test file${
        files.length === 1 ? '' : 's'
      } for PR #${job.prNumber}\n\nAuto-generated by the coverage service.`;

  const commit = await author.commitFiles({
    branch,
    baseSha: job.headSha,
    files,
    commitMessage,
  });

  if (!commit) {
    log.warn('commitFiles returned null; aborting PR open');
    return { url: null, count: 0 };
  }

  const opened = await author.openOrUpdatePR({
    base: job.headRef,
    head: branch,
    title: `[OpenReview] Tests for PR #${job.prNumber}: ${job.title}`,
    body: buildTestPRBody({
      run,
      headRef: job.headRef,
      testPrFileCount: files.length,
    }),
  });

  log.info(
    {
      branch,
      commitSha: commit.commitSha,
      testPrNumber: opened.number,
      created: opened.created,
      updated: opened.updated,
      fileCount: files.length,
    },
    opened.updated ? 'stacked test PR updated' : 'stacked test PR ready',
  );

  return { url: opened.url, count: files.length };
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

/**
 * Omit a key from the request when the config value is empty — lets the
 * coverage service fall back to its own defaults rather than overwriting
 * them with empty strings.
 */
function optionalStr<K extends string>(
  key: K,
  value: string | undefined,
): Partial<Record<K, string>> {
  if (!value || value.trim() === '') return {};
  return { [key]: value } as Partial<Record<K, string>>;
}
