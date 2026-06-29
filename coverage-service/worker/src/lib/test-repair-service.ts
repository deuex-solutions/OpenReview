import type { GeneratedTestWithUsage } from '@openreview/coverage-lib';
import {
  getMaxRepairAttempts,
  isRepairLoopEnabled,
} from '@openreview/coverage-lib';

export interface TestRepairParams {
  maxAttempts?: number;
  runTest: () => Promise<{ passed: boolean; output: string }>;
  repair: (failureLogs: string, previousContent: string, attempt: number) => Promise<GeneratedTestWithUsage | null>;
  writeTest: (content: string) => Promise<void>;
  log: (message: string) => Promise<void>;
}

export interface TestRepairResult {
  passed: boolean;
  repairAttempts: number;
  failureReason?: string;
  finalContent?: string;
}

/**
 * Repair loop for failing generated tests.
 * Sends failure output back to the LLM up to MAX_REPAIR_ATTEMPTS times.
 */
export class TestRepairService {
  async repairUntilPassing(params: TestRepairParams): Promise<TestRepairResult> {
    if (!isRepairLoopEnabled()) {
      const result = await params.runTest();
      return {
        passed: result.passed,
        repairAttempts: 0,
        failureReason: result.passed ? undefined : result.output.slice(-2000),
      };
    }

    const maxAttempts = params.maxAttempts ?? getMaxRepairAttempts();
    let repairAttempts = 0;
    let lastOutput = '';
    let previousContent = '';

    while (repairAttempts < maxAttempts) {
      const result = await params.runTest();
      if (result.passed) {
        return { passed: true, repairAttempts, finalContent: previousContent || undefined };
      }

      lastOutput = result.output;
      repairAttempts++;

      await params.log(
        `Repair attempt ${repairAttempts}/${maxAttempts}`,
      );

      const repaired = await params.repair(
        lastOutput.slice(-4000),
        previousContent,
        repairAttempts + 1,
      );

      if (!repaired?.content) {
        break;
      }

      previousContent = repaired.content;
      await params.writeTest(repaired.content);
    }

    const finalResult = await params.runTest();
    return {
      passed: finalResult.passed,
      repairAttempts,
      failureReason: finalResult.passed
        ? undefined
        : (finalResult.output || lastOutput).slice(-2000),
      finalContent: previousContent || undefined,
    };
  }
}
