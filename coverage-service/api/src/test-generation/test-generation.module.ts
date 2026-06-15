import { Module } from '@nestjs/common';
import { RepositoriesModule } from '../repositories/repositories.module';
import {
  TestGenerationRunsController,
  TestGenerationTriggerController,
} from './test-generation.controller';
import { TestGenerationService } from './test-generation.service';

@Module({
  imports: [RepositoriesModule],
  controllers: [TestGenerationTriggerController, TestGenerationRunsController],
  providers: [TestGenerationService],
})
export class TestGenerationModule {}
