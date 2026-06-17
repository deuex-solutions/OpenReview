import type { GeneratedTest, TestGenerationContext } from '../types';

export interface TestGenerationProvider {
  readonly name: string;
  generateTests(context: TestGenerationContext): Promise<GeneratedTest>;
}
