import type {
  GitHubAuthMode} from '@openreview/coverage-lib';
import {
  createCoverageProvider,
  createTestGenerationProvider,
  GitHubProvider
} from '@openreview/coverage-lib';

import { prisma } from './prisma';

export function createRepositoryProvider() {
  const authMode = (process.env.GITHUB_AUTH_MODE ?? 'pat') as GitHubAuthMode;

  return new GitHubProvider({
    authMode,
    pat: process.env.GITHUB_PAT,
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    // Static ID: set when running in single-org mode (Option A).
    // Leave blank in multi-tenant mode (Option C) — the resolver below takes over.
    installationId: process.env.GITHUB_APP_INSTALLATION_ID || undefined,
    // Dynamic resolver: looks up the installation ID per-repo from the database.
    // Only invoked when authMode === 'app' and no static installationId is set.
    resolveInstallationId: async (githubRepo: string) => {
      const repo = await prisma.repository.findFirst({
        where: { githubRepo },
        select: { githubInstallationId: true },
      });
      return repo?.githubInstallationId ?? null;
    },
  });
}

export function createCoverageProviderFromEnv() {
  const type = (process.env.COVERAGE_PROVIDER ?? 'diff-cover') as
    | 'diff-cover'
    | 'covpeek';
  return createCoverageProvider(type);
}

const TEST_GENERATION_MODEL_DEFAULTS: Record<
  'openai' | 'anthropic' | 'local',
  string
> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  local: 'local-model',
};

/** Model used only for LLM test generation (separate from OPENAI_MODEL / ANTHROPIC_MODEL). */
export function resolveTestGenerationModel(
  provider: 'openai' | 'anthropic' | 'local',
): string {
  const dedicated = process.env.TEST_GENERATION_MODEL?.trim();
  if (dedicated) return dedicated;
  return TEST_GENERATION_MODEL_DEFAULTS[provider];
}

export function createLLMProvider() {
  const provider = (process.env.LLM_PROVIDER ?? 'openai') as
    | 'openai'
    | 'anthropic'
    | 'local';

  return createTestGenerationProvider(provider, {
    apiKey:
      provider === 'anthropic'
        ? process.env.ANTHROPIC_API_KEY
        : process.env.OPENAI_API_KEY,
    model: resolveTestGenerationModel(provider),
    baseUrl: process.env.LOCAL_LLM_URL,
  });
}
