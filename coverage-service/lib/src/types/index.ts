export type PrRunStatus =
  | 'PENDING'
  | 'CLONING'
  | 'RUNNING_COVERAGE'
  | 'ANALYZING'
  | 'GENERATING_TESTS'
  | 'RUNNING_TESTS'
  | 'RECALCULATING'
  | 'COMPLETED'
  | 'FAILED';

export type ExecutionStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'PARTIAL';

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  patch?: string;
}

export interface ImpactedSymbol {
  name: string;
  kind: 'function' | 'class' | 'method' | 'module';
  file: string;
  startLine: number;
  endLine: number;
  signature?: string;
}

export interface UncoveredLine {
  file: string;
  line: number;
}

/** Alias for uncovered changed lines in diff coverage reports. */
export type ChangedLine = UncoveredLine;

export type CoverageBlocker =
  | 'EXTERNAL_DEPENDENCY'
  | 'ENVIRONMENT_DEPENDENT'
  | 'DEAD_CODE'
  | 'GENERATED_CODE'
  | 'COMPLEX_MOCKING_REQUIRED'
  | 'UNKNOWN';

export interface BaselineMetrics {
  overallCoverage: number;
  diffCoverage: number | null;
  uncoveredLines: ChangedLine[];
}

export interface CoverageBlockerEntry {
  file: string;
  line: number;
  blocker: CoverageBlocker;
  reason: string;
  suggestedMocks: string[];
  suggestedRefactoring: string | null;
}

export type CoverageWorkflowStatus =
  | 'threshold_met'
  | 'success'
  | 'threshold_not_reached'
  | 'plateau_reached';

export interface CoverageIterationSummary {
  iteration: number;
  coverageBefore: number;
  coverageAfter: number | null;
  coverageGain: number | null;
  generatedTests: number;
  failedTests: number;
  stopReason?: string | null;
}

export interface CoverageWorkflowSummary {
  status: CoverageWorkflowStatus;
  thresholdReached: boolean;
  attempts: number;
  generatedTests: string[];
  testsPassing: number;
  coverageBefore: number;
  coverageAfter: number;
  diffCoverageBefore: number | null;
  diffCoverageAfter: number | null;
  blockers: CoverageBlockerEntry[];
  targetCoverage: number;
  currentCoverage: number;
  optimizationIterations?: CoverageIterationSummary[];
  stopReason?: string | null;
}

export enum GenerationMode {
  NEW_TEST_FILE = 'NEW_TEST_FILE',
  COVERAGE_GAP = 'COVERAGE_GAP',
}

export interface FileCoverage {
  file: string;
  lineCoveragePercent: number;
  diffCoveragePercent: number | null;
  uncoveredLines: number[];
}

export interface DiffCoverageReport {
  diffCoveragePercent: number;
  totalCoveragePercent: number;
  uncoveredLines: UncoveredLine[];
  filesWithPoorCoverage: string[];
  fileCoverage: FileCoverage[];
  rawOutput: string;
}

export interface GeneratedTest {
  filePath: string;
  content: string;
  targetFile: string;
}

export interface TestGenerationContext {
  language: string;
  framework: string;
  file: string;
  diff: string;
  source: string;
  existingTests: string;
  uncoveredLines: string;
  symbols: ImpactedSymbol[];
  /** Packages already declared by the repository (requirements, pyproject, package.json). */
  repoPackages: string[];
  /** Full PR-branch source file (not a snippet). */
  useFullSource?: boolean;
  /** Diff coverage % for this file, when below threshold. */
  fileDiffCoverage?: number | null;
  /** Exported symbol names from the source file (JS/TS). */
  exportedSymbols?: string[];
  /** Set when repairing a failing generated test. */
  failureLogs?: string;
  previousTestContent?: string;
  attemptNumber?: number;
  /** Repo-relative path where the generated test file will be written. */
  testOutputPath?: string;
  /** True when updating an existing test file instead of creating a new one. */
  isUpdatingExistingTest?: boolean;
  /** Generation mode: full file or gap-targeted incremental tests. */
  generationMode?: GenerationMode;
  /** Previously generated test content for this target (avoid duplication). */
  previousGeneratedTests?: string;
  /** Coverage report excerpt for this file. */
  coverageReport?: string;
  /** True for config/prompt/schema export files requiring smoke tests. */
  isConfigExportFile?: boolean;
  /** True for complex service files (retry, LLM, HTTP, pagination). */
  isComplexServiceFile?: boolean;
  /** Similar test examples from the repository. */
  similarTestExamples?: string;
  /** Suggested export names for smoke tests. */
  smokeTestExports?: string[];
}

export interface PrAnalysisJobData {
  prRunId: string;
  repositoryId: string;
  prNumber: number;
  baseBranch: string;
  headBranch: string;
  headSha: string;
}

export interface CoverageMetrics {
  totalCoveragePercent: number;
  diffCoveragePercent: number;
}

export interface PrRunResult {
  prRunId: string;
  status: PrRunStatus;
  beforeCoverage: CoverageMetrics | null;
  afterCoverage: CoverageMetrics | null;
  generatedTestsCount: number;
  filesImproved: string[];
  executionStatus: ExecutionStatus;
  generatedTests: GeneratedTest[];
  logs: string[];
  workflowSummary?: CoverageWorkflowSummary | null;
}

export const PR_ANALYSIS_QUEUE = 'pr-analysis';

export type TestGenerationStatus =
  | 'PENDING'
  | 'CLONING'
  | 'GENERATING_TESTS'
  | 'COMPLETED'
  | 'FAILED';

export interface TestGenerationJobData {
  runId: string;
  repositoryId: string;
  prNumber: number;
  /** Omitted when the worker should auto-pick from PR diff coverage. */
  targetFile?: string;
  baseBranch: string;
  headBranch: string;
}

export const TEST_GENERATION_QUEUE = 'test-generation';
