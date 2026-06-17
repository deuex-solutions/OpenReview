import { Module } from '@nestjs/common';

import { PrRunsController } from './pr-runs.controller';
import { PrRunsService } from './pr-runs.service';

@Module({
  controllers: [PrRunsController],
  providers: [PrRunsService],
  exports: [PrRunsService],
})
export class PrRunsModule {}
