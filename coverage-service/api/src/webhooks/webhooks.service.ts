import { Injectable, Logger } from '@nestjs/common';

import type { PrAnalysisService } from '../analysis/pr-analysis.service';
import type { RepositoriesService } from '../repositories/repositories.service';

interface PullRequestPayload {
  action: string;
  pull_request: {
    number: number;
    head: { ref: string; sha: string };
    base: { ref: string };
  };
  repository: { full_name: string };
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prAnalysis: PrAnalysisService,
    private readonly repositories: RepositoriesService,
  ) {}

  async handlePullRequest(payload: Record<string, unknown>) {
    const pr = payload as unknown as PullRequestPayload;
    const action = pr.action;

    if (!['opened', 'synchronize', 'reopened'].includes(action)) {
      return { skipped: true, reason: `action ${action} ignored` };
    }

    const githubRepo = pr.repository.full_name;
    const repository = await this.repositories.findByGithubRepo(githubRepo);

    if (!repository) {
      this.logger.warn(`No registered repository for ${githubRepo}`);
      return { skipped: true, reason: 'repository not registered' };
    }

    return this.prAnalysis.trigger({
      repositoryId: repository.id,
      prNumber: pr.pull_request.number,
      headBranch: pr.pull_request.head.ref,
      headSha: pr.pull_request.head.sha,
      baseBranch: pr.pull_request.base.ref,
    });
  }
}
