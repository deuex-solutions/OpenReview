import {
  buildFastReviewSummary,
  fingerprintPullRequestDiff,
  runFastReview,
} from '@openreview/core';

import type { ServiceConfig } from '../../config.js';
import type { GitHubAuth } from '../../github/auth.js';
import type { Logger } from '../../logger.js';
import type { ReviewCache } from '../../review/review-cache.js';
import type { FastReviewJob } from '../types.js';

import { buildPRRuntime } from './context.js';

export interface FastReviewDeps {
  auth: GitHubAuth;
  logger: Logger;
  reviewCache: ReviewCache;
  cfg: ServiceConfig;
}

/**
 * Process a fast review job: fetch PR data, run runFastReview, post results.
 * Reuses cached findings when an identical reviewable diff was seen before.
 */
export async function processFastReview(
  job: FastReviewJob,
  deps: FastReviewDeps,
): Promise<void> {
  const log = deps.logger.child({
    job: 'review-fast',
    repo: `${job.owner}/${job.repo}`,
    prNumber: job.prNumber,
  });

  log.info('starting fast review');

  const { poster, pr } = await buildPRRuntime(job, deps.auth);
  const fingerprint = fingerprintPullRequestDiff(pr.diff, pr.files);

  try {
    const cached = await deps.reviewCache.get(job.owner, job.repo, fingerprint);
    let findings;
    let summary;
    let fromCache = false;

    if (cached) {
      findings = cached.findings;
      summary = buildFastReviewSummary(findings, pr.files.length, 0);
      fromCache = true;
    } else {
      const result = await runFastReview(pr);
      findings = result.findings;
      summary = result.summary;
      await deps.reviewCache.set(job.owner, job.repo, fingerprint, findings);
    }

    const finalSummary = await poster.postReviewResults(job.prNumber, pr, findings, summary);

    log.info(
      {
        findings: findings.length,
        newFindings: finalSummary.newCount ?? findings.length,
        resolved: finalSummary.resolvedCount ?? 0,
        approved: finalSummary.approved ?? false,
        duration: finalSummary.duration,
        fromCache,
        diffFingerprint: fingerprint.slice(0, 12),
      },
      fromCache
        ? 'fast review complete (cache hit) — summary comment updated'
        : 'fast review complete — summary comment updated',
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
