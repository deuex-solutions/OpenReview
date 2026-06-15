import {
  createCoverageProvider,
  createTestGenerationProvider,
  GitHubProvider,
  GitHubAuthMode,
} from '@openreview/coverage-lib';

export function createRepositoryProvider() {
  const authMode = (process.env.GITHUB_AUTH_MODE ?? 'pat') as GitHubAuthMode;
  return new GitHubProvider({
    authMode,
    pat: process.env.GITHUB_PAT,
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    installationId: process.env.GITHUB_APP_INSTALLATION_ID,
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
