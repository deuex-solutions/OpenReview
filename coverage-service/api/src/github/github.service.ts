import { Injectable } from '@nestjs/common';
import { GitHubAuthMode, GitHubProvider } from '@openreview/coverage-lib';

@Injectable()
export class GitHubService {
  private readonly provider: GitHubProvider;

  constructor() {
    const authMode = (process.env.GITHUB_AUTH_MODE ?? 'pat') as GitHubAuthMode;
    this.provider = new GitHubProvider({
      authMode,
      pat: process.env.GITHUB_PAT,
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
      installationId: process.env.GITHUB_APP_INSTALLATION_ID,
    });
  }

  getPullRequest(githubRepo: string, prNumber: number) {
    return this.provider.getPullRequest(githubRepo, prNumber);
  }
}
