import {
  buildTestGenerationPrompt,
  buildTestGenerationSystemPrompt,
} from '../prompts/test-generation';
import { inferTestFilePath } from '../test-paths';
import type { TestGenerationContext } from '../types';

import type {
  GeneratedTestWithUsage,
  LlmUsage,
  TestGenerationProvider,
} from './test-generation-provider';

// Pricing per 1 million tokens (input / output) in USD.
// https://openai.com/api/pricing — baked-in at release time.
const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-2024-11-20': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-4': { input: 30.0, output: 60.0 },
  'o1': { input: 15.0, output: 60.0 },
  'o1-mini': { input: 3.0, output: 12.0 },
  'o3-mini': { input: 1.1, output: 4.4 },
};

function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const pricing = OPENAI_PRICING[model] ?? OPENAI_PRICING['gpt-4o-mini'];
  return (
    (promptTokens / 1_000_000) * pricing.input +
    (completionTokens / 1_000_000) * pricing.output
  );
}

function outputPathFor(context: TestGenerationContext): string {
  return context.testOutputPath ?? inferTestFilePath(context.file, context.framework);
}

export interface OpenAIProviderConfig {
  apiKey: string;
  model?: string;
}

export class OpenAIProvider implements TestGenerationProvider {
  readonly name = 'openai';

  constructor(private readonly config: OpenAIProviderConfig) {}

  async generateTests(context: TestGenerationContext): Promise<GeneratedTestWithUsage> {
    const model = this.config.model ?? 'gpt-4o-mini';
    const prompt = buildTestGenerationPrompt(context);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: buildTestGenerationSystemPrompt(context.language),
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error: ${err}`);
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const content = this.stripMarkdown(data.choices[0]?.message?.content ?? '');
    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    const totalTokens = data.usage?.total_tokens ?? promptTokens + completionTokens;

    const usage: LlmUsage = {
      provider: 'openai',
      modelName: model,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
    };

    return {
      filePath: outputPathFor(context),
      content,
      targetFile: context.file,
      usage,
    };
  }

  private stripMarkdown(content: string): string {
    return content
      .replace(/^```[\w]*\n?/gm, '')
      .replace(/```$/gm, '')
      .trim();
  }
}
