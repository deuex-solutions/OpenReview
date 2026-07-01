import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { CostController } from './cost.controller';
import { CostService } from './cost.service';

@Module({
  imports: [PrismaModule],
  controllers: [CostController],
  providers: [CostService],
  exports: [CostService],
})
export class CostModule {}
