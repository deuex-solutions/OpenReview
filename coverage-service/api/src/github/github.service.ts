import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
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

  async getPullRequest(githubRepo: string, prNumber: number) {
    try {
      return await this.provider.getPullRequest(githubRepo, prNumber);
    } catch (err) {
      throw this.mapGitHubError(err, githubRepo, prNumber);
    }
  }

  private mapGitHubError(
    err: unknown,
    githubRepo: string,
    prNumber?: number,
  ): never {
    const status = (err as { status?: number }).status;

    if (status === 404) {
      throw new NotFoundException(
        prNumber != null
          ? `Pull request #${prNumber} not found on ${githubRepo}. Verify the PR number exists and your GitHub token can access the repo.`
          : `Repository ${githubRepo} not found or not accessible.`,
      );
    }

    if (status === 401 || status === 403) {
      throw new UnauthorizedException(
        `GitHub API access denied for ${githubRepo}. Check GITHUB_PAT or GitHub App credentials.`,
      );
    }

    throw err;
  }
}
