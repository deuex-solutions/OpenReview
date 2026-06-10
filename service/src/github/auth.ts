import type { ServiceConfig } from '../config.js';

/**
 * Resolve a GitHub token suitable for posting reviews and reading PRs.
 *
 * v1 uses a single shared PAT for every repository. The interface is shaped
 * so that swapping in GitHub App installation tokens later is a one-file
 * change: callers always pass (owner, repo) and receive a string token.
 */
export interface GitHubAuth {
  getTokenFor(owner: string, repo: string): Promise<string>;
}

export function createPatAuth(cfg: ServiceConfig): GitHubAuth {
  if (!cfg.githubPat) {
    throw new Error('GITHUB_PAT is required for the PAT auth provider.');
  }

  return {
    async getTokenFor(_owner: string, _repo: string): Promise<string> {
      return cfg.githubPat;
    },
  };
}
