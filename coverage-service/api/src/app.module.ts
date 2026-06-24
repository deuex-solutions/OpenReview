import { Module } from '@nestjs/common';

import { AnalysisModule } from './analysis/analysis.module';
import { CostModule } from './cost/cost.module';
import { GitHubModule } from './github/github.module';
import { HealthController } from './health/health.controller';
import { PrRunsModule } from './pr-runs/pr-runs.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { RepositoriesModule } from './repositories/repositories.module';
import { TestGenerationModule } from './test-generation/test-generation.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    PrismaModule,
    QueueModule,
    GitHubModule,
    RepositoriesModule,
    AnalysisModule,
    TestGenerationModule,
    WebhooksModule,
    PrRunsModule,
    CostModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

