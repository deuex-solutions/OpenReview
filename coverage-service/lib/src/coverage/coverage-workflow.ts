import { readFile } from 'fs/promises';
import { join } from 'path';

import type {
  BaselineMetrics,
  CoverageBlocker,
  CoverageBlockerEntry,
  CoverageWorkflowSummary,
  DiffCoverageReport,
  ChangedFile,
  FileCoverage,
  UncoveredLine,
} from '../types';
import type { CoverageProvider } from '../providers/coverage-provider';

import { parseCoberturaXml, pathsMatch } from './cobertura-parser';
import { computeDiffCoverageFromGit } from './git-diff-coverage';

export function getEffectiveCoverage(
  diffCoverage: number | null,
  overallCoverage: number,
): number {
  return diffCoverage ?? overallCoverage;
}

export function meetsThreshold(
  effectiveCoverage: number,
  thresholdPercent: number,
): boolean {
  return effectiveCoverage >= thresholdPercent;
}

export function extractBaselineMetrics(
  report: DiffCoverageReport,
): BaselineMetrics {
  const hasDiffCoverage = report.fileCoverage.some(
    (f) => f.diffCoveragePercent !== null,
  );

  return {
    overallCoverage: report.totalCoveragePercent,
    diffCoverage: hasDiffCoverage ? report.diffCoveragePercent : null,
    uncoveredLines: report.uncoveredLines,
  };
}

/** Recompute filesWithPoorCoverage using configurable threshold. */
export function applyCoverageThreshold(
  report: DiffCoverageReport,
  thresholdPercent: number,
): DiffCoverageReport {
  const filesWithPoorCoverage = report.fileCoverage
    .filter((f) => {
      const effective = f.diffCoveragePercent ?? f.lineCoveragePercent;
      return effective < thresholdPercent;
    })
    .map((f) => f.file);

  const uniquePoor = [...new Set(filesWithPoorCoverage)];

  return {
    ...report,
    filesWithPoorCoverage: uniquePoor.length
      ? uniquePoor
      : report.uncoveredLines.length > 0
        ? [
            ...new Set(
              report.uncoveredLines.map((l) => l.file),
            ),
          ]
        : [],
  };
}

export function selectFilesForGeneration(
  report: DiffCoverageReport,
  sourceFiles: ChangedFile[],
  thresholdPercent: number,
): ChangedFile[] {
  const thresholded = applyCoverageThreshold(report, thresholdPercent);

  if (thresholded.filesWithPoorCoverage.length === 0) {
    const effective = getEffectiveCoverage(
      report.diffCoveragePercent,
      report.totalCoveragePercent,
    );
    if (
      sourceFiles.length > 0 &&
      report.fileCoverage.length === 0 &&
      !meetsThreshold(effective, thresholdPercent)
    ) {
      return sourceFiles;
    }
    return [];
  }

  return sourceFiles.filter((f) =>
    thresholded.filesWithPoorCoverage.some((poor) =>
      pathsMatch(f.path, poor),
    ),
  );
}

/** Prefer diff-cover when Cobertura has data; fall back to git diff when it does not. */
export async function resolveDiffCoverageReport(params: {
  coverageXmlPath: string;
  repoDir: string;
  compareRef: string;
  headBranch: string;
  targetFiles: string[];
  thresholdPercent: number;
  coverageProvider: CoverageProvider;
}): Promise<DiffCoverageReport> {
  const cobertura = params.coverageXmlPath
    ? await parseCoberturaXml(params.coverageXmlPath)
    : { totalCoveragePercent: 0, files: [] };

  if (cobertura.files.length === 0 && params.targetFiles.length > 0) {
    return computeDiffCoverageFromGit(
      params.coverageXmlPath,
      params.repoDir,
      params.compareRef,
      params.headBranch,
      params.targetFiles,
      params.thresholdPercent,
    );
  }

  return params.coverageProvider.runDiffCoverage(
    params.coverageXmlPath,
    params.compareRef,
    params.repoDir,
  );
}

function effectiveFileCoverage(entry: FileCoverage | undefined): number {
  if (!entry) return 0;
  return entry.diffCoveragePercent ?? entry.lineCoveragePercent;
}

/** Pick one changed source file for standalone test generation. */
export function pickTargetFileForTestGeneration(
  report: DiffCoverageReport,
  sourceFiles: ChangedFile[],
  thresholdPercent: number,
): ChangedFile | null {
  if (sourceFiles.length === 0) return null;

  const belowThreshold = selectFilesForGeneration(
    report,
    sourceFiles,
    thresholdPercent,
  );
  const pool = belowThreshold.length > 0 ? belowThreshold : sourceFiles;

  const sorted = [...pool].sort((a, b) => {
    const covA = report.fileCoverage.find((f) => pathsMatch(f.file, a.path));
    const covB = report.fileCoverage.find((f) => pathsMatch(f.file, b.path));
    return effectiveFileCoverage(covA) - effectiveFileCoverage(covB);
  });

  return sorted[0] ?? null;
}

export function buildCoverageDeltas(
  before: BaselineMetrics,
  after: BaselineMetrics,
): { coverageDelta: number; diffCoverageDelta: number | null } {
  const coverageDelta = after.overallCoverage - before.overallCoverage;
  const diffCoverageDelta =
    before.diffCoverage !== null && after.diffCoverage !== null
      ? after.diffCoverage - before.diffCoverage
      : null;

  return { coverageDelta, diffCoverageDelta };
}

const BLOCKER_PATTERNS: Array<{
  blocker: CoverageBlocker;
  patterns: RegExp[];
}> = [
  {
    blocker: 'EXTERNAL_DEPENDENCY',
    patterns: [
      /\b(requests|httpx|aiohttp|urllib|fetch\s*\(|axios|boto3|redis|kafka|grpc|sqlalchemy|psycopg|pymongo|stripe|twilio)\b/i,
      /\bfrom\s+[\w.]+\s+import\s+.*(?:client|sdk|api)\b/i,
    ],
  },
  {
    blocker: 'ENVIRONMENT_DEPENDENT',
    patterns: [
      /\bos\.environ\b/,
      /\bos\.getenv\b/,
      /\bprocess\.env\b/,
      /\bgetenv\s*\(/,
      /\bNODE_ENV\b/,
    ],
  },
  {
    blocker: 'DEAD_CODE',
    patterns: [
      /\bpragma:\s*no cover\b/i,
      /\braise\s+NotImplementedError\b/,
      /\bpass\s*#\s*unreachable\b/i,
      /\bTODO\b.*\btest\b/i,
      /^\s*pass\s*$/m,
    ],
  },
  {
    blocker: 'GENERATED_CODE',
    patterns: [
      /@generated/i,
      /auto-?generated/i,
      /do not edit/i,
      /code generated by/i,
    ],
  },
  {
    blocker: 'COMPLEX_MOCKING_REQUIRED',
    patterns: [
      /\b(subprocess|multiprocessing|threading|asyncio\.create_subprocess|socket\.|WebSocket|child_process)\b/,
      /\b@patch\.object\b.*\bopen\b/,
      /\bfs\.(readFile|writeFile|mkdir)\b/,
    ],
  },
];

function classifyLineContent(lineContent: string): CoverageBlocker {
  for (const { blocker, patterns } of BLOCKER_PATTERNS) {
    if (patterns.some((p) => p.test(lineContent))) {
      return blocker;
    }
  }
  return 'UNKNOWN';
}

function blockerReason(blocker: CoverageBlocker): string {
  switch (blocker) {
    case 'EXTERNAL_DEPENDENCY':
      return 'Line interacts with an external service or SDK that requires stubbing at the integration boundary.';
    case 'ENVIRONMENT_DEPENDENT':
      return 'Line depends on environment variables or runtime configuration not set in the test harness.';
    case 'DEAD_CODE':
      return 'Line appears unreachable, intentionally excluded, or placeholder code.';
    case 'GENERATED_CODE':
      return 'Line is in generated or boilerplate code that should not be covered directly.';
    case 'COMPLEX_MOCKING_REQUIRED':
      return 'Line requires heavy process, filesystem, or network mocking to exercise safely.';
    default:
      return 'Coverage gap could not be classified automatically.';
  }
}

function blockerSuggestions(
  blocker: CoverageBlocker,
  lineContent: string,
): { suggestedMocks: string[]; suggestedRefactoring: string | null } {
  switch (blocker) {
    case 'EXTERNAL_DEPENDENCY':
      return {
        suggestedMocks: [
          'Patch the client at the module import path used by production code (unittest.mock.patch / node:test mocks).',
          'Return deterministic fake responses instead of calling live services.',
        ],
        suggestedRefactoring:
          'Inject dependencies via constructor or function parameters to simplify mocking.',
      };
    case 'ENVIRONMENT_DEPENDENT':
      return {
        suggestedMocks: [
          'Set required env vars in test setup (monkeypatch.setenv / process.env in beforeEach).',
        ],
        suggestedRefactoring:
          'Read configuration through a small config object that tests can override.',
      };
    case 'COMPLEX_MOCKING_REQUIRED':
      return {
        suggestedMocks: [
          'Mock subprocess/socket/fs at the boundary the module imports.',
          'Use AsyncMock for async context managers and streams.',
        ],
        suggestedRefactoring:
          'Extract pure logic from I/O-heavy code so core behavior can be unit tested.',
      };
    case 'DEAD_CODE':
      return {
        suggestedMocks: [],
        suggestedRefactoring:
          'Remove unreachable code or mark it with pragma: no cover if intentionally excluded.',
      };
    case 'GENERATED_CODE':
      return {
        suggestedMocks: [],
        suggestedRefactoring:
          'Exclude generated files from coverage scope or test the generator instead.',
      };
    default:
      return {
        suggestedMocks: [
          `Add a focused unit test exercising the branch containing: ${lineContent.trim().slice(0, 80)}`,
        ],
        suggestedRefactoring: null,
      };
  }
}

export async function classifyCoverageBlockers(
  repoDir: string,
  uncoveredLines: UncoveredLine[],
  sourceByFile: Map<string, string>,
): Promise<CoverageBlockerEntry[]> {
  const entries: CoverageBlockerEntry[] = [];

  for (const { file, line } of uncoveredLines) {
    let source = sourceByFile.get(file);
    if (!source) {
      try {
        source = await readFile(join(repoDir, file), 'utf-8');
        sourceByFile.set(file, source);
      } catch {
        entries.push({
          file,
          line,
          blocker: 'UNKNOWN',
          reason: 'Could not read source file to classify this line.',
          suggestedMocks: [],
          suggestedRefactoring: null,
        });
        continue;
      }
    }

    const lineContent = source.split('\n')[line - 1] ?? '';
    const blocker = classifyLineContent(lineContent);
    const { suggestedMocks, suggestedRefactoring } = blockerSuggestions(
      blocker,
      lineContent,
    );

    entries.push({
      file,
      line,
      blocker,
      reason: blockerReason(blocker),
      suggestedMocks,
      suggestedRefactoring,
    });
  }

  return entries;
}

export function buildWorkflowSummary(params: {
  status: CoverageWorkflowSummary['status'];
  thresholdPercent: number;
  thresholdReached: boolean;
  attempts: number;
  generatedTests: { filePath: string; passed: boolean | null }[];
  coverageBefore: BaselineMetrics;
  coverageAfter: BaselineMetrics;
  blockers: CoverageBlockerEntry[];
  optimizationIterations?: CoverageWorkflowSummary['optimizationIterations'];
  stopReason?: string | null;
}): CoverageWorkflowSummary {
  const testsPassing = params.generatedTests.filter((t) => t.passed === true)
    .length;

  return {
    status: params.status,
    thresholdReached: params.thresholdReached,
    attempts: params.attempts,
    generatedTests: params.generatedTests.map((t) => t.filePath),
    testsPassing,
    coverageBefore: params.coverageBefore.overallCoverage,
    coverageAfter: params.coverageAfter.overallCoverage,
    diffCoverageBefore: params.coverageBefore.diffCoverage,
    diffCoverageAfter: params.coverageAfter.diffCoverage,
    blockers: params.blockers,
    targetCoverage: params.thresholdPercent,
    currentCoverage: getEffectiveCoverage(
      params.coverageAfter.diffCoverage,
      params.coverageAfter.overallCoverage,
    ),
    optimizationIterations: params.optimizationIterations,
    stopReason: params.stopReason,
  };
}
