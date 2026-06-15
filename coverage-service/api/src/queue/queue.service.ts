import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PR_ANALYSIS_QUEUE, PrAnalysisJobData } from '@openreview/coverage-lib';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queue: Queue<PrAnalysisJobData>;

  constructor() {
    this.queue = new Queue<PrAnalysisJobData>(PR_ANALYSIS_QUEUE, {
      connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
    });
  }

  async enqueuePrAnalysis(data: PrAnalysisJobData) {
    return this.queue.add('analyze-pr', data, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
