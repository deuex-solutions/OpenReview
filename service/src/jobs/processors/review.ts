import { runFastReview } from '@openreview/core';

import type { GitHubAuth } from '../../github/auth.js';
import type { Logger } from '../../logger.js';
import type { FastReviewJob } from '../types.js';

import { buildPRRuntime } from './context.js';

/**
 * Process a fast review job: fetch PR data, run runFastReview, post results.
 * Mirrors what the GitHub Action does in action/src/pr-handler.ts.
 */
export async function processFastReview(
  job: FastReviewJob,
  deps: { auth: GitHubAuth; logger: Logger },
): Promise<void> {
  const log = deps.logger.child({
    job: 'review-fast',
    repo: `${job.owner}/${job.repo}`,
    prNumber: job.prNumber,
  });

  log.info('starting fast review');

  const { poster, pr } = await buildPRRuntime(job, deps.auth);

  await poster.postAcknowledgement(
    job.prNumber,
    '[INFO] **OpenReview** — Review started... results will appear shortly.',
  );

  try {
    const { findings, summary } = await runFastReview(pr);

    if (findings.length > 0) {
      await poster.postReview(job.prNumber, findings);
    }
    await poster.postSummaryComment(job.prNumber, summary);

    log.info(
      { findings: findings.length, duration: summary.duration },
      'fast review complete',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'fast review failed');
    await poster.postAcknowledgement(
      job.prNumber,
      `[ERROR] **OpenReview** — Review failed: ${msg}`,
    );
    throw err;
  }
}
