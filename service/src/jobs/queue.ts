import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';

import type { ServiceConfig } from '../config.js';
import type { Logger } from '../logger.js';

import type { OpenReviewJob } from './types.js';
import { QUEUE_NAME } from './types.js';

/**
 * Producer-side wrapper for the OpenReview BullMQ queue.
 *
 * Computes deterministic job IDs so that duplicate webhook deliveries
 * (GitHub retries, manual replays) collapse into a single processed job.
 *
 * We intentionally do NOT parameterize `Queue` with `OpenReviewJob`: bullmq's
 * generic signature has multiple ExtractDataType layers that bleed into the
 * type and make the surface awkward. The public `enqueue` method enforces
 * the type at the only boundary that matters.
 */
export class ReviewQueue {
  private readonly queue: Queue;

  constructor(
    connection: ConnectionOptions,
    private readonly cfg: ServiceConfig,
    private readonly logger: Logger,
  ) {
    this.queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: cfg.jobMaxAttempts,
        backoff: { type: 'exponential', delay: cfg.jobBackoffMs },
        removeOnComplete: { count: cfg.jobKeepCompleted },
        removeOnFail: { count: cfg.jobKeepFailed },
      },
    });
  }

  /** Enqueue a job. Returns true if the job was new, false if it was a dedup hit. */
  async enqueue(job: OpenReviewJob): Promise<boolean> {
    const jobId = buildJobId(job);
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      this.logger.debug({ jobId, kind: job.kind }, 'duplicate webhook job ignored');
      return false;
    }

    await this.queue.add(job.kind, job, { jobId });
    this.logger.info(
      { jobId, kind: job.kind, repo: `${job.owner}/${job.repo}`, prNumber: job.prNumber },
      'job enqueued',
    );
    return true;
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

/**
 * Compose a deterministic job ID from semantic identifiers. Different shapes
 * dedup on different fields so we don't accidentally drop legitimate retries.
 */
function buildJobId(job: OpenReviewJob): string {
  const base = `${job.kind}:${job.owner}/${job.repo}#${job.prNumber}`;
  switch (job.kind) {
    case 'review-fast':
    case 'review-rlm':
      return `${base}@${job.headSha}`;
    case 'chat':
    case 'learnings-list':
    case 'learnings-forget':
      return `${base}@comment:${job.commentId}`;
  }
}
