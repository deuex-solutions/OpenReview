import { Module } from '@nestjs/common';
import { PrAnalysisService } from './pr-analysis.service';
import { AnalysisController } from './analysis.controller';
import { RepositoriesModule } from '../repositories/repositories.module';

@Module({
  imports: [RepositoriesModule],
  controllers: [AnalysisController],
  providers: [PrAnalysisService],
  exports: [PrAnalysisService],
})
export class AnalysisModule {}
