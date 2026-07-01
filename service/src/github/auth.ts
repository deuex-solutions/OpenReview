import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

import type { ServiceConfig } from '../config.js';

/**
 * Resolve a GitHub token suitable for posting reviews and reading PRs.
 * Callers pass (owner, repo) and receive a string token.
 */
export interface GitHubAuth {
  getTokenFor(owner: string, repo: string): Promise<string>;
}

export type GitHubAuthMode = 'pat' | 'app';

interface CachedInstallationToken {
  token: string;
  expiresAtMs: number;
}

export function createGitHubAuth(cfg: ServiceConfig): GitHubAuth {
  if (cfg.githubAuthMode === 'app') {
    return createAppInstallationAuth(cfg);
  }
  return createPatAuth(cfg);
}

export function createPatAuth(cfg: ServiceConfig): GitHubAuth {
  if (!cfg.githubPat) {
    throw new Error('GITHUB_PAT is required when GITHUB_AUTH_MODE=pat.');
  }

  return {
    async getTokenFor(_owner: string, _repo: string): Promise<string> {
      return cfg.githubPat;
    },
  };
}

/**
 * GitHub App auth — posts comments as the bot, not the PAT owner.
 * Resolves the installation ID per repo via the GitHub API unless
 * GITHUB_APP_INSTALLATION_ID is set (single-org mode).
 */
export function createAppInstallationAuth(cfg: ServiceConfig): GitHubAuth {
  if (!cfg.githubAppId || !cfg.githubAppPrivateKey) {
    throw new Error(
      'GitHub App auth requires GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.',
    );
  }

  const privateKey = cfg.githubAppPrivateKey.replace(/\\n/g, '\n');
  const staticInstallationId = cfg.githubAppInstallationId
    ? Number.parseInt(cfg.githubAppInstallationId, 10)
    : undefined;

  const installationIdByRepo = new Map<string, number>();
  const tokenByInstallation = new Map<number, CachedInstallationToken>();

  const appAuth = createAppAuth({
    appId: cfg.githubAppId,
    privateKey,
  });

  async function resolveInstallationId(owner: string, repo: string): Promise<number> {
    if (staticInstallationId && !Number.isNaN(staticInstallationId)) {
      return staticInstallationId;
    }

    const key = `${owner}/${repo}`;
    const cached = installationIdByRepo.get(key);
    if (cached) return cached;

    const appOctokit = new Octokit({
      auth: (await appAuth({ type: 'app' })).token,
    });
    const { data } = await appOctokit.rest.apps.getRepoInstallation({
      owner,
      repo,
    });
    installationIdByRepo.set(key, data.id);
    return data.id;
  }

  async function installationToken(installationId: number): Promise<string> {
    const cached = tokenByInstallation.get(installationId);
    if (cached && cached.expiresAtMs > Date.now() + 60_000) {
      return cached.token;
    }

    const auth = createAppAuth({
      appId: cfg.githubAppId!,
      privateKey,
      installationId,
    });
    const result = await auth({ type: 'installation' });
    tokenByInstallation.set(installationId, {
      token: result.token,
      expiresAtMs: new Date(result.expiresAt).getTime(),
    });
    return result.token;
  }

  return {
    async getTokenFor(owner: string, repo: string): Promise<string> {
      const installationId = await resolveInstallationId(owner, repo);
      return installationToken(installationId);
    },
  };
}
