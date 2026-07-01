// Thin typed fetch client for the coverage-service API.
// All functions read NEXT_PUBLIC_API_URL (defaults to localhost:3001 for dev).

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3010';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    next: { revalidate: 0 }, // always fresh on every request
  });
  if (!res.ok) throw new Error(`API error ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────

export type PrRunStatus =
  | 'PENDING' | 'CLONING' | 'RUNNING_COVERAGE' | 'ANALYZING'
  | 'GENERATING_TESTS' | 'RUNNING_TESTS' | 'RECALCULATING'
  | 'COMPLETED' | 'FAILED';

export type ExecutionStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'PARTIAL';

export interface Repository {
  id: string;
  githubRepo: string;
  defaultBranch: string;
  createdAt: string;
}

export interface PrRunSummary {
  id: string;
  prNumber: number;
  status: PrRunStatus;
  startedAt: string;
  completedAt: string | null;
  coverageResult: {
    beforeCoverage: number | null;
    afterCoverage: number | null;
    generatedTestsCount: number;
    executionStatus: ExecutionStatus;
  } | null;
}

export interface PrRunDetail {
  id: string;
  repository: string;
  prNumber: number;
  status: PrRunStatus;
  startedAt: string;
  completedAt: string | null;
  coverageBefore: number | null;
  coverageAfter: number | null;
  diffCoverageBefore: number | null;
  diffCoverageAfter: number | null;
  generatedTestsCount: number;
  filesImproved: string[];
  executionStatus: ExecutionStatus;
  workflowSummary: unknown;
  generatedTestFiles: {
    id: string;
    filePath: string;
    targetFile: string;
    passed: boolean | null;
    category: 'UNIT_TEST_WORTHWHILE' | 'INTEGRATION_TEST_NEEDED';
    integrationTestReason: string | null;
    fileContent: string | null;
  }[];
  logs: { level: string; message: string; createdAt: string }[];
}

export interface ModelCostBreakdown {
  provider: string;
  modelName: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface PrCostBreakdown {
  prNumber: number;
  prRunId: string;
  calls: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface RepositoryCostSummary {
  repositoryId: string;
  githubRepo: string;
  totalCalls: number;
  totalTokens: number;
  estimatedCostUsd: number;
  byModel: ModelCostBreakdown[];
  byPr: PrCostBreakdown[];
}

export interface GlobalStats {
  totalRepositories: number;
  totalPrRuns: number;
  totalTestGenerationRuns: number;
  totalLlmCalls: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

// ── Fetchers ───────────────────────────────────────────────────────────────

export const api = {
  repositories: {
    list: () => apiFetch<Repository[]>('/repositories'),
    prRuns: (repoId: string) =>
      apiFetch<PrRunSummary[]>(`/pr-runs/repository/${repoId}`),
    costSummary: (repoId: string) =>
      apiFetch<RepositoryCostSummary>(`/repositories/${repoId}/cost-summary`),
  },
  prRuns: {
    get: (id: string) => apiFetch<PrRunDetail>(`/pr-runs/${id}`),
  },
  stats: {
    global: () => apiFetch<GlobalStats>('/stats/global'),
  },
};

// ── Formatters ─────────────────────────────────────────────────────────────

export function fmtCost(usd: number | null | undefined): string {
  if (usd == null) return '—';
  if (usd === 0) return '$0.00';
  if (usd < 0.001) return '<$0.001';
  return `$${usd.toFixed(4)}`;
}

export function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

export function fmtDuration(start: string, end: string | null | undefined): string {
  if (!end) return 'In progress';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function statusBadgeClass(status: PrRunStatus): string {
  const map: Record<PrRunStatus, string> = {
    PENDING: 'badge-pending',
    CLONING: 'badge-running',
    RUNNING_COVERAGE: 'badge-running',
    ANALYZING: 'badge-running',
    GENERATING_TESTS: 'badge-running',
    RUNNING_TESTS: 'badge-running',
    RECALCULATING: 'badge-running',
    COMPLETED: 'badge-completed',
    FAILED: 'badge-failed',
  };
  return map[status] ?? 'badge-skipped';
}

export function executionBadgeClass(status: ExecutionStatus): string {
  const map: Record<ExecutionStatus, string> = {
    PASS: 'badge-pass',
    FAIL: 'badge-fail',
    SKIPPED: 'badge-skipped',
    PARTIAL: 'badge-partial',
  };
  return map[status] ?? 'badge-skipped';
}
