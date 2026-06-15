import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { RepositoriesModule } from './repositories/repositories.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PrRunsModule } from './pr-runs/pr-runs.module';
import { QueueModule } from './queue/queue.module';
import { AnalysisModule } from './analysis/analysis.module';
import { GitHubModule } from './github/github.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    PrismaModule,
    QueueModule,
    GitHubModule,
    WorkspacesModule,
    RepositoriesModule,
    AnalysisModule,
    WebhooksModule,
    PrRunsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
