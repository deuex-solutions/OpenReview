import { Controller, Get, Param } from '@nestjs/common';

import { CostService } from './cost.service';

@Controller()
export class CostController {
  constructor(private readonly costService: CostService) {}

  @Get('repositories/:repositoryId/cost-summary')
  getRepositorySummary(@Param('repositoryId') repositoryId: string) {
    return this.costService.getRepositorySummary(repositoryId);
  }

  @Get('stats/global')
  getGlobalStats() {
    return this.costService.getGlobalStats();
  }
}
