import { GeneratedTest, TestGenerationContext } from '../types';
import { TestGenerationProvider } from './test-generation-provider';
import {
  buildTestGenerationPrompt,
  buildTestGenerationSystemPrompt,
} from '../prompts/test-generation';
import { inferTestFilePath } from '../test-paths';

export interface OpenAIProviderConfig {
  apiKey: string;
  model?: string;
}

export class OpenAIProvider implements TestGenerationProvider {
  readonly name = 'openai';

  constructor(private readonly config: OpenAIProviderConfig) {}

  async generateTests(context: TestGenerationContext): Promise<GeneratedTest> {
    const prompt = buildTestGenerationPrompt(context);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model ?? 'gpt-4o-mini',
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
    };
    const content = this.stripMarkdown(data.choices[0]?.message?.content ?? '');

    return {
      filePath: inferTestFilePath(context.file, context.framework),
      content,
      targetFile: context.file,
    };
  }

  private stripMarkdown(content: string): string {
    return content
      .replace(/^```[\w]*\n?/gm, '')
      .replace(/```$/gm, '')
      .trim();
  }
}
