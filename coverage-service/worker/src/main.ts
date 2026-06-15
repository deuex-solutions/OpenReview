import './load-env';
import { Job, Worker } from 'bullmq';
import { PR_ANALYSIS_QUEUE, PrAnalysisJobData } from '@openreview/coverage-lib';
import { PrAnalysisProcessor } from './processors/pr-analysis.processor';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? '2', 10);
const executionTimeoutMs = parseInt(
  process.env.EXECUTION_TIMEOUT_MS ?? '3600000',
  10,
);
// Keep the BullMQ lock alive for long installs + test runs (uv sync, pytest, etc.).
const lockDurationMs = parseInt(
  process.env.JOB_LOCK_DURATION_MS ?? String(executionTimeoutMs),
  10,
);
const stalledIntervalMs = parseInt(
  process.env.JOB_STALLED_INTERVAL_MS ?? '120000',
  10,
);
const maxStalledCount = parseInt(process.env.JOB_MAX_STALLED_COUNT ?? '5', 10);

const processor = new PrAnalysisProcessor();

const worker = new Worker<PrAnalysisJobData>(
  PR_ANALYSIS_QUEUE,
  async (job: Job<PrAnalysisJobData>) => processor.process(job.data, job),
  {
    connection: { url: redisUrl },
    concurrency,
    lockDuration: lockDurationMs,
    stalledInterval: stalledIntervalMs,
    maxStalledCount,
  },
);

worker.on('active', (job) => {
  console.log(
    `Job ${job.id} started — PR run ${job.data.prRunId}, repo PR #${job.data.prNumber}`,
  );
});

worker.on('progress', (job, progress) => {
  console.log(`Job ${job.id} progress:`, progress);
});

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed for PR run ${job.data.prRunId}`);
});

worker.on('failed', (job, err) => {
  console.error(
    `Job ${job?.id} failed for PR run ${job?.data.prRunId}:`,
    err.message,
  );
});

console.log(
  `Worker started with concurrency ${concurrency}, lockDuration ${lockDurationMs}ms`,
);

const forceShutdown = process.env.WORKER_FORCE_SHUTDOWN === 'true';

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down worker...`);
  await worker.close(forceShutdown);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
