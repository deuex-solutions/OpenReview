import { GeneratedTest, TestGenerationContext } from '../types';
import { TestGenerationProvider } from './test-generation-provider';
import { buildTestGenerationPrompt } from '../prompts/test-generation';
import { inferTestFilePath } from '../test-paths';

export interface LocalLLMProviderConfig {
  baseUrl?: string;
  model?: string;
}

export class LocalLLMProvider implements TestGenerationProvider {
  readonly name = 'local';

  constructor(private readonly config: LocalLLMProviderConfig) {}

  async generateTests(context: TestGenerationContext): Promise<GeneratedTest> {
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
      filePath: inferTestFilePath(context.file, context.framework),
      content,
      targetFile: context.file,
    };
  }
}
