import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import type { GitHubService } from '../github/github.service';
import type { RepositoriesService } from '../repositories/repositories.service';

import type { GenerateTestDto } from './dto/generate-test.dto';
import type { TestGenerationService } from './test-generation.service';

@Controller('repositories')
export class TestGenerationTriggerController {
  constructor(
    private readonly testGeneration: TestGenerationService,
    private readonly github: GitHubService,
    private readonly repositories: RepositoriesService,
  ) {}

  @Post(':repositoryId/generate-test')
  async generateTest(
    @Param('repositoryId') repositoryId: string,
    @Body() dto: GenerateTestDto,
  ) {
    const repository = await this.repositories.findOne(repositoryId);
    const pr = await this.github.getPullRequest(
      repository.githubRepo,
      dto.prNumber,
    );

    return this.testGeneration.trigger({
      repositoryId,
      prNumber: pr.number,
      filePath: dto.filePath,
      headBranch: pr.headBranch,
      baseBranch: pr.baseBranch,
    });
  }
}

@Controller('test-generation-runs')
export class TestGenerationRunsController {
  constructor(private readonly testGeneration: TestGenerationService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.testGeneration.findOne(id);
  }
}
