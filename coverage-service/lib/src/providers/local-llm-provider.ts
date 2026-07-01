import { buildTestGenerationPrompt } from '../prompts/test-generation';
import {
  buildTestabilityClassificationPrompt,
  parseTestabilityClassificationResponse,
} from '../prompts/testability-classification';
import { inferTestFilePath } from '../test-paths';
import type { TestGenerationContext } from '../types';

import type {
  GeneratedTestWithUsage,
  TestGenerationProvider,
  TestabilityClassification,
} from './test-generation-provider';

function outputPathFor(context: TestGenerationContext): string {
  return context.testOutputPath ?? inferTestFilePath(context.file, context.framework);
}

export interface LocalLLMProviderConfig {
  baseUrl?: string;
  model?: string;
}

export class LocalLLMProvider implements TestGenerationProvider {
  readonly name = 'local';

  constructor(private readonly config: LocalLLMProviderConfig) {}

  async classifyTestability(
    context: TestGenerationContext,
  ): Promise<TestabilityClassification> {
    const prompt = buildTestabilityClassificationPrompt(context);
    const baseUrl = this.config.baseUrl ?? 'http://localhost:8000/v1';

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model ?? 'local-model',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      }),
    });

    if (!response.ok) {
      throw new Error(`Local LLM error: ${await response.text()}`);
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
    };
    const raw = data.choices[0]?.message?.content ?? '';

    return {
      ...parseTestabilityClassificationResponse(raw),
      usage: null,
    };
  }

  async generateTests(context: TestGenerationContext): Promise<GeneratedTestWithUsage> {
    const prompt = buildTestGenerationPrompt(context);
    const baseUrl = this.config.baseUrl ?? 'http://localhost:8000/v1';

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model ?? 'local-model',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`Local LLM error: ${await response.text()}`);
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
    };
    const content = (data.choices[0]?.message?.content ?? '')
      .replace(/^```[\w]*\n?/gm, '')
      .replace(/```$/gm, '')
      .trim();

    return {
      filePath: outputPathFor(context),
      content,
      targetFile: context.file,
      testCategory: 'UNIT_TEST_WORTHWHILE',
      usage: null, // Local LLM — no cost tracking
    };
  }
}
