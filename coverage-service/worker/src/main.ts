import './load-env';
import type {
  PrAnalysisJobData,
  TestGenerationJobData} from '@openreview/coverage-lib';
import {
  PR_ANALYSIS_QUEUE,
  TEST_GENERATION_QUEUE
} from '@openreview/coverage-lib';
import type { Job} from 'bullmq';
import { Worker } from 'bullmq';

import { PrAnalysisProcessor } from './processors/pr-analysis.processor';
import { TestGenerationProcessor } from './processors/test-generation.processor';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? '2', 10);
const executionTimeoutMs = parseInt(
  process.env.EXECUTION_TIMEOUT_MS ?? '3600000',
  10,
);
const lockDurationMs = parseInt(
  process.env.JOB_LOCK_DURATION_MS ?? String(executionTimeoutMs),
  10,
);
const stalledIntervalMs = parseInt(
  process.env.JOB_STALLED_INTERVAL_MS ?? '120000',
  10,
);
const maxStalledCount = parseInt(process.env.JOB_MAX_STALLED_COUNT ?? '5', 10);

const prAnalysisProcessor = new PrAnalysisProcessor();
const testGenerationProcessor = new TestGenerationProcessor();

const prAnalysisWorker = new Worker<PrAnalysisJobData>(
  PR_ANALYSIS_QUEUE,
  async (job: Job<PrAnalysisJobData>) =>
    prAnalysisProcessor.process(job.data, job),
  {
    connection: { url: redisUrl },
    concurrency,
    lockDuration: lockDurationMs,
    stalledInterval: stalledIntervalMs,
    maxStalledCount,
  },
);

const testGenerationWorker = new Worker<TestGenerationJobData>(
  TEST_GENERATION_QUEUE,
  async (job: Job<TestGenerationJobData>) =>
    testGenerationProcessor.process(job.data, job),
  {
    connection: { url: redisUrl },
    concurrency,
    lockDuration: lockDurationMs,
    stalledInterval: stalledIntervalMs,
    maxStalledCount,
  },
);

prAnalysisWorker.on('active', (job) => {
  console.log(
    `Job ${job.id} started — PR run ${job.data.prRunId}, repo PR #${job.data.prNumber}`,
  );
});

prAnalysisWorker.on('completed', (job) => {
  console.log(`Job ${job.id} completed for PR run ${job.data.prRunId}`);
});

prAnalysisWorker.on('failed', (job, err) => {
  console.error(
    `Job ${job?.id} failed for PR run ${job?.data.prRunId}:`,
    err.message,
  );
});

testGenerationWorker.on('active', (job) => {
  console.log(
    `Job ${job.id} started — test generation ${job.data.runId}, ${job.data.targetFile}`,
  );
});

testGenerationWorker.on('completed', (job) => {
  console.log(`Job ${job.id} completed for test generation ${job.data.runId}`);
});

testGenerationWorker.on('failed', (job, err) => {
  console.error(
    `Job ${job?.id} failed for test generation ${job?.data.runId}:`,
    err.message,
  );
});

console.log(
  `Worker started with concurrency ${concurrency}, lockDuration ${lockDurationMs}ms`,
);

const forceShutdown = process.env.WORKER_FORCE_SHUTDOWN === 'true';

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down worker...`);
  await Promise.all([
    prAnalysisWorker.close(forceShutdown),
    testGenerationWorker.close(forceShutdown),
  ]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
