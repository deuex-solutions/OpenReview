import type {
  GeneratedTest,
  GeneratedTestCategory,
  TestGenerationContext,
} from '../types';

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** USD estimated at call-time from a baked-in pricing table; null for unknown models or local LLMs. */
  estimatedCostUsd: number | null;
  modelName: string;
  provider: string;
}

export interface GeneratedTestWithUsage extends GeneratedTest {
  usage: LlmUsage | null;
}

export interface TestabilityClassification {
  category: GeneratedTestCategory;
  reason: string;
  usage: LlmUsage | null;
}

export interface TestGenerationProvider {
  readonly name: string;
  classifyTestability(
    context: TestGenerationContext,
  ): Promise<TestabilityClassification>;
  generateTests(context: TestGenerationContext): Promise<GeneratedTestWithUsage>;
}
