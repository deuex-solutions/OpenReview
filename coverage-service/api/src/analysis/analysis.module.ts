import { Module } from '@nestjs/common';

import { RepositoriesModule } from '../repositories/repositories.module';

import { AnalysisController } from './analysis.controller';
import { PrAnalysisService } from './pr-analysis.service';

@Module({
  imports: [RepositoriesModule],
  controllers: [AnalysisController],
  providers: [PrAnalysisService],
  exports: [PrAnalysisService],
})
export class AnalysisModule {}
