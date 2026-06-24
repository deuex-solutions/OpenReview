import { buildTestGenerationPrompt } from '../prompts/test-generation';
import { inferTestFilePath } from '../test-paths';
import type { TestGenerationContext } from '../types';

import type {
  GeneratedTestWithUsage,
  LlmUsage,
  TestGenerationProvider,
} from './test-generation-provider';

// Pricing per 1 million tokens (input / output) in USD.
// https://www.anthropic.com/pricing — baked-in at release time.
const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-5': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 0.8, output: 4.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  'claude-3-sonnet-20240229': { input: 3.0, output: 15.0 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};

function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const pricing = ANTHROPIC_PRICING[model] ?? ANTHROPIC_PRICING['claude-3-5-haiku-20241022'];
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}

function outputPathFor(context: TestGenerationContext): string {
  return context.testOutputPath ?? inferTestFilePath(context.file, context.framework);
}

export interface AnthropicProviderConfig {
  apiKey: string;
  model?: string;
}

export class AnthropicProvider implements TestGenerationProvider {
  readonly name = 'anthropic';

  constructor(private readonly config: AnthropicProviderConfig) {}

  async generateTests(context: TestGenerationContext): Promise<GeneratedTestWithUsage> {
    const model = this.config.model ?? 'claude-3-5-sonnet-20241022';
    const prompt = buildTestGenerationPrompt(context);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error: ${err}`);
    }

    const data = (await response.json()) as {
      content: { type: string; text: string }[];
      usage?: { input_tokens: number; output_tokens: number };
    };

    const raw = data.content.find((c) => c.type === 'text')?.text ?? '';
    const content = raw.replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim();

    const promptTokens = data.usage?.input_tokens ?? 0;
    const completionTokens = data.usage?.output_tokens ?? 0;

    const usage: LlmUsage = {
      provider: 'anthropic',
      modelName: model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
    };

    return {
      filePath: outputPathFor(context),
      content,
      targetFile: context.file,
      usage,
    };
  }
}

