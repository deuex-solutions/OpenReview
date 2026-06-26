import { loadConfig as loadCoreConfig, validateConfig as validateCoreConfig } from '@openreview/core';
import { Worker } from 'bullmq';
import type { Job } from 'bullmq';


import { assertConfigReady, loadServiceConfig } from './config.js';
import { createGitHubAuth } from './github/auth.js';
import { createRedisConnection } from './jobs/connection.js';
import { processChat } from './jobs/processors/chat.js';
import { processCoverageAnalysis } from './jobs/processors/coverage-analysis.js';
import {
  processLearningsForget,
  processLearningsList,
} from './jobs/processors/learnings.js';
import { processFastReview } from './jobs/processors/review.js';
import { processRlmReview } from './jobs/processors/rlm.js';
import { QUEUE_NAME } from './jobs/types.js';
import type { CoverageAnalysisJob, OpenReviewJob } from './jobs/types.js';
import { createLogger } from './logger.js';
import { ReviewCache } from './review/review-cache.js';

/**
 * Worker entrypoint. Pulls jobs from BullMQ and runs the corresponding
 * processor against @openreview/core. Stateless: scale by running more
 * workers — BullMQ handles locking and retries.
 */
async function main(): Promise<void> {
  const cfg = loadServiceConfig();
  const logger = createLogger(cfg);

  try {
    assertConfigReady(cfg);
    // Workers actually invoke the LLM — ensure at least one provider is configured.
    validateCoreConfig(loadCoreConfig());
  } catch (err) {
    logger.fatal({ err: (err as Error).message }, 'startup configuration error');
    process.exit(1);
  }

  const auth = createGitHubAuth(cfg);
  const connection = createRedisConnection(cfg);
  const reviewCache = new ReviewCache(connection, cfg, logger);

  const worker = new Worker<OpenReviewJob>(
    QUEUE_NAME,
    async (job: Job<OpenReviewJob>) => {
      const data = job.data;
      switch (data.kind) {
        case 'review-fast':
          return processFastReview(data, { auth, logger, reviewCache, cfg });
        case 'review-rlm':
          return processRlmReview(data, { auth, logger });
        case 'chat':
          return processChat(data, { auth, logger });
        case 'learnings-list':
          return processLearningsList(data, { auth, logger });
        case 'learnings-forget':
          return processLearningsForget(data, { auth, logger });
        case 'coverage-analysis':
          return processCoverageAnalysis(data, {
            auth,
            logger,
            cfg,
            persistJobData: async (next: CoverageAnalysisJob) => {
              await job.updateData(next);
            },
          });
      }
    },
    { connection, concurrency: cfg.workerConcurrency },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, kind: job.name }, 'job completed');
  });
  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, kind: job?.name, attemptsMade: job?.attemptsMade, err: err.message },
      'job failed',
    );
  });
  worker.on('error', (err) => {
    logger.error({ err: err.message }, 'worker error');
  });

  logger.info({ concurrency: cfg.workerConcurrency }, 'worker ready');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down worker');
    await worker.close();
    await connection.quit();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal error in worker entrypoint:', err);
  process.exit(1);
});
