import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type {
  PrAnalysisJobData,
  TestGenerationJobData} from '@openreview/coverage-lib';
import {
  PR_ANALYSIS_QUEUE,
  TEST_GENERATION_QUEUE
} from '@openreview/coverage-lib';
import { Queue } from 'bullmq';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly prAnalysisQueue: Queue<PrAnalysisJobData>;
  private readonly testGenerationQueue: Queue<TestGenerationJobData>;

  constructor() {
    const connection = {
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    };

    this.prAnalysisQueue = new Queue<PrAnalysisJobData>(PR_ANALYSIS_QUEUE, {
      connection,
    });
    this.testGenerationQueue = new Queue<TestGenerationJobData>(
      TEST_GENERATION_QUEUE,
      { connection },
    );
  }

  async enqueuePrAnalysis(data: PrAnalysisJobData) {
    return this.prAnalysisQueue.add('analyze-pr', data, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    });
  }

  async enqueueTestGeneration(data: TestGenerationJobData) {
    return this.testGenerationQueue.add('generate-test', data, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    });
  }

  async onModuleDestroy() {
    await Promise.all([
      this.prAnalysisQueue.close(),
      this.testGenerationQueue.close(),
    ]);
  }
}
