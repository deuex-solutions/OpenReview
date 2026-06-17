import { Body, Controller, Param, Post } from '@nestjs/common';

import type { GitHubService } from '../github/github.service';
import type { RepositoriesService } from '../repositories/repositories.service';

import type { TriggerAnalysisDto } from './dto/trigger-analysis.dto';
import type { PrAnalysisService } from './pr-analysis.service';

@Controller('repositories')
export class AnalysisController {
  constructor(
    private readonly prAnalysis: PrAnalysisService,
    private readonly github: GitHubService,
    private readonly repositories: RepositoriesService,
  ) {}

  @Post(':repositoryId/analyze')
  async analyze(
    @Param('repositoryId') repositoryId: string,
    @Body() dto: TriggerAnalysisDto,
  ) {
    const repository = await this.repositories.findOne(repositoryId);
    const pr = await this.github.getPullRequest(
      repository.githubRepo,
      dto.prNumber,
    );

    return this.prAnalysis.trigger({
      repositoryId,
      prNumber: pr.number,
      headBranch: pr.headBranch,
      headSha: pr.headSha,
      baseBranch: pr.baseBranch,
    });
  }
}
