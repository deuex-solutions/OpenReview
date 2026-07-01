import { SnapshotBuilder, parseDiff, runRLM } from '@openreview/core';

import type { GitHubAuth } from '../../github/auth.js';
import type { Logger } from '../../logger.js';
import type { RlmReviewJob } from '../types.js';

import { buildPRRuntime } from './context.js';

/**
 * Process a deep (RLM) review triggered by `@openreview rlm`.
 * RLM is iterative and can take 2-5 minutes; the user has already been
 * acknowledged via the webhook handler.
 */
export async function processRlmReview(
  job: RlmReviewJob,
  deps: { auth: GitHubAuth; logger: Logger },
): Promise<void> {
  const log = deps.logger.child({
    job: 'review-rlm',
    repo: `${job.owner}/${job.repo}`,
    prNumber: job.prNumber,
  });

  log.info('starting RLM deep review');

  const { client, poster, pr } = await buildPRRuntime(job, deps.auth);

  await poster.postAcknowledgement(
    job.prNumber,
    '[INFO] **OpenReview** — Deep review started (RLM mode)... this may take 2-5 minutes.',
  );

  try {
    const snapshot = new SnapshotBuilder({
      client,
      headRef: pr.metadata.headSha,
      diffs: parseDiff(pr.diff),
    });

    const findings = await runRLM(pr, snapshot, (event) => {
      log.debug({ iter: event.iteration, type: event.type }, event.message.slice(0, 120));
    });

    if (findings.length > 0) {
      await poster.postReview(job.prNumber, findings);
    }

    await poster.postAcknowledgement(
      job.prNumber,
      `[SUCCESS] **OpenReview** — RLM deep review complete. Found ${findings.length} issue(s).`,
    );

    log.info({ findings: findings.length }, 'RLM review complete');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'RLM review failed');
    await poster.postAcknowledgement(
      job.prNumber,
      `[ERROR] **OpenReview** — RLM review failed: ${msg}`,
    );
    throw err;
  }
}
