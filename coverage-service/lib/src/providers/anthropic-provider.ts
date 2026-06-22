import { buildTestGenerationPrompt } from '../prompts/test-generation';
import { inferTestFilePath } from '../test-paths';
import type { GeneratedTest, TestGenerationContext } from '../types';

import type { TestGenerationProvider } from './test-generation-provider';

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

  async generateTests(context: TestGenerationContext): Promise<GeneratedTest> {
    const prompt = buildTestGenerationPrompt(context);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model ?? 'claude-3-5-sonnet-20241022',
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
    };
    const raw = data.content.find((c) => c.type === 'text')?.text ?? '';
    const content = raw.replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim();

    return {
      filePath: outputPathFor(context),
      content,
      targetFile: context.file,
    };
  }
}
