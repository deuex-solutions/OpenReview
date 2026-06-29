import type { CoverageGapEntry } from './coverage-gap-analysis';

export interface PriorityContext {
  /** Number of previous failed generation/repair attempts per file. */
  failureCounts: Map<string, number>;
  /** Source line counts per file for complexity scoring. */
  sourceLineCounts: Map<string, number>;
}

/**
 * Score and sort coverage gaps for the next optimization iteration.
 *
 * priority = missingDiffLines * 10 + uncoveredPercentage - failedAttempts * 5
 */
export function prioritizeCoverageGaps(
  gaps: CoverageGapEntry[],
  context: PriorityContext,
): CoverageGapEntry[] {
  const scored = gaps.map((gap) => {
    const missingLines = gap.uncoveredLines.length;
    const failedAttempts = context.failureCounts.get(gap.file) ?? 0;
    const lineCount = context.sourceLineCounts.get(gap.file) ?? 0;
    const complexityPenalty = lineCount > 500 ? 5 : lineCount > 200 ? 2 : 0;

    const priority =
      missingLines * 10 +
      gap.uncoveredPercentage -
      failedAttempts * 5 -
      complexityPenalty;

    return {
      ...gap,
      complexity: lineCount,
      priority,
    };
  });

  return scored.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}
