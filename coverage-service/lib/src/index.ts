export * from './types';
export * from './coverage/cobertura-parser';
export * from './coverage/git-diff-coverage';
export * from './coverage/coverage-config';
export * from './coverage/coverage-workflow';
export * from './providers/coverage-provider';
export * from './providers/diff-cover-provider';
export * from './providers/covpeek-provider';
export * from './providers/repository-provider';
export * from './providers/github-provider';
export * from './providers/test-generation-provider';
export * from './providers/openai-provider';
export * from './providers/anthropic-provider';
export * from './providers/local-llm-provider';
export * from './prompts/test-generation';
export * from './test-paths';
export * from './prepare-test-generation';
export * from './analysis/code-analyzer';

import { AnthropicProvider } from './providers/anthropic-provider';
import { CovPeekProvider } from './providers/covpeek-provider';
import { DiffCoverProvider } from './providers/diff-cover-provider';
import { LocalLLMProvider } from './providers/local-llm-provider';
import { OpenAIProvider } from './providers/openai-provider';

export function createCoverageProvider(
  type: 'diff-cover' | 'covpeek' = 'diff-cover',
) {
  if (type === 'covpeek') return new CovPeekProvider();
  return new DiffCoverProvider();
}

export function createTestGenerationProvider(
  type: 'openai' | 'anthropic' | 'local',
  config: Record<string, string | undefined>,
) {
  switch (type) {
    case 'anthropic':
      return new AnthropicProvider({
        apiKey: config.apiKey!,
        model: config.model,
      });
    case 'local':
      return new LocalLLMProvider({
        baseUrl: config.baseUrl,
        model: config.model,
      });
    default:
      return new OpenAIProvider({
        apiKey: config.apiKey!,
        model: config.model,
      });
  }
}
