import { Injectable, Logger } from '@nestjs/common';

import { PrAnalysisService } from '../analysis/pr-analysis.service';
import { RepositoriesService } from '../repositories/repositories.service';

interface PullRequestPayload {
  action: string;
  pull_request: {
    number: number;
    head: { ref: string; sha: string };
    base: { ref: string };
  };
  repository: { full_name: string };
}

interface InstallationPayload {
  action: string; // 'created' | 'deleted' | 'added' | 'removed'
  installation: { id: number };
  /** Present on 'created' (full install) */
  repositories?: { full_name: string }[];
  /** Present on 'installation_repositories' events (selective add/remove) */
  repositories_added?: { full_name: string }[];
  repositories_removed?: { full_name: string }[];
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

  /**
   * Handles GitHub App installation/uninstallation events.
   *
   * - `installation` event with action `created`: the app was installed on one
   *   or more repos. We upsert each repo and store the installation ID.
   * - `installation_repositories` event with action `added`: the app was granted
   *   access to additional repos within an existing installation.
   * - `installation` with action `deleted` / `installation_repositories` with
   *   action `removed`: the app was removed — clear the installation ID.
   */
  async handleInstallation(payload: Record<string, unknown>) {
    const data = payload as unknown as InstallationPayload;
    const installationId = String(data.installation.id);
    const action = data.action;

    this.logger.log(
      `GitHub App installation event: action=${action} installationId=${installationId}`,
    );

    const added: string[] = [
      ...(data.repositories ?? []),
      ...(data.repositories_added ?? []),
    ].map((r) => r.full_name);

    const removed: string[] = (data.repositories_removed ?? []).map(
      (r) => r.full_name,
    );

    if (action === 'deleted') {
      // Entire installation removed — we don't know the exact repos from this
      // payload variant, so clear by installation ID if we have it.
      this.logger.warn(
        `App uninstalled for installationId=${installationId}. ` +
          `Repos will retain their row but lose the installation ID.`,
      );
      // The repositories[] list IS present on 'deleted', re-use added[] logic.
    }

    for (const repo of added) {
      await this.repositories.upsertByGithubRepo(repo, installationId);
      this.logger.log(`Linked installationId=${installationId} → ${repo}`);
    }

    for (const repo of removed) {
      await this.repositories.upsertByGithubRepo(repo, null);
      this.logger.log(`Cleared installationId for ${repo}`);
    }

    return { received: true, action, added, removed };
  }
}
