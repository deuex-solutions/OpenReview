import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { RepositoriesModule } from '../repositories/repositories.module';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [RepositoriesModule, AnalysisModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
