import { Module } from '@nestjs/common';

import { AnalysisModule } from '../analysis/analysis.module';
import { RepositoriesModule } from '../repositories/repositories.module';

import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [RepositoriesModule, AnalysisModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
