import type { ChangedFile, DiffCoverageReport } from '../types';
import { pathsMatch } from './cobertura-parser';

export interface CoverageGapEntry {
  file: string;
  coverage: number;
  uncoveredLines: number[];
  uncoveredPercentage: number;
  /** Estimated file complexity (line count of source). */
  complexity: number;
  /** Priority score assigned by CoveragePriorityService. */
  priority?: number;
}

export interface CoverageGapsReport {
  files: CoverageGapEntry[];
  totalUncoveredLines: number;
}

/** Extract per-file coverage gaps from a diff-cover report. */
export function getCoverageGaps(
  report: DiffCoverageReport,
  thresholdPercent: number,
): CoverageGapsReport {
  const files: CoverageGapEntry[] = [];

  for (const entry of report.fileCoverage) {
    const effective = entry.diffCoveragePercent ?? entry.lineCoveragePercent;
    const uncoveredLines =
      entry.uncoveredLines.length > 0
        ? entry.uncoveredLines
        : report.uncoveredLines
            .filter((l) => pathsMatch(l.file, entry.file))
            .map((l) => l.line);

    if (effective >= thresholdPercent && uncoveredLines.length === 0) {
      continue;
    }

    const uncoveredPercentage = Math.max(0, 100 - effective);

    files.push({
      file: entry.file,
      coverage: effective,
      uncoveredLines: [...new Set(uncoveredLines)].sort((a, b) => a - b),
      uncoveredPercentage,
      complexity: 0,
    });
  }

  // Files with uncovered lines but no fileCoverage entry
  const coveredFiles = new Set(files.map((f) => f.file));
  for (const { file, line } of report.uncoveredLines) {
    if (coveredFiles.has(file)) continue;
    const existing = files.find((f) => pathsMatch(f.file, file));
    if (existing) {
      if (!existing.uncoveredLines.includes(line)) {
        existing.uncoveredLines.push(line);
        existing.uncoveredLines.sort((a, b) => a - b);
      }
    } else {
      files.push({
        file,
        coverage: 0,
        uncoveredLines: [line],
        uncoveredPercentage: 100,
        complexity: 0,
      });
      coveredFiles.add(file);
    }
  }

  const totalUncoveredLines = files.reduce(
    (sum, f) => sum + f.uncoveredLines.length,
    0,
  );

  return { files, totalUncoveredLines };
}

/** Map coverage gaps to changed source files eligible for test generation. */
export function gapsToChangedFiles(
  gaps: CoverageGapEntry[],
  sourceFiles: ChangedFile[],
): ChangedFile[] {
  const result: ChangedFile[] = [];
  for (const gap of gaps) {
    const match = sourceFiles.find((f) => pathsMatch(f.path, gap.file));
    if (match && !result.some((r) => pathsMatch(r.path, match.path))) {
      result.push(match);
    }
  }
  return result;
}

/** Detect stagnation: two consecutive iterations with gain below minimum. */
export function shouldStopForStagnation(
  recentGains: number[],
  minGain: number,
): boolean {
  if (recentGains.length < 2) return false;
  const lastTwo = recentGains.slice(-2);
  return lastTwo.every((g) => g < minGain);
}

export type OptimizationStopReason =
  | 'target_reached'
  | 'max_iterations'
  | 'plateau'
  | 'no_gaps'
  | 'unrecoverable_failure'
  | 'no_llm';

export function formatGapSummary(gaps: CoverageGapEntry[]): string {
  return gaps
    .map(
      (g) =>
        `- ${g.file}: ${g.uncoveredLines.slice(0, 20).join(',')}${g.uncoveredLines.length > 20 ? '…' : ''}`,
    )
    .join('\n');
}
