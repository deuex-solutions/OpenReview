/* ------------------------------------------------------------------ */
/*  Review Data Model                                                  */
/* ------------------------------------------------------------------ */

/** Bug or flag — determines how the finding is presented. */
export type FindingCategory = 'bug' | 'flag';

/** Severity levels ordered from most to least critical. */
export type FindingSeverity = 'severe' | 'non-severe' | 'investigate' | 'informational';

/** Where the finding originated. */
export type FindingSource = 'ai' | 'linter' | 'both';

/** A reference to a specific range in the source code. */
export interface Citation {
  file: string;
  startLine: number;
  endLine: number;
}

/** A single review finding produced by AI, a linter, or both. */
export interface ReviewFinding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  file: string;
  startLine: number;
  endLine: number;
  title: string;
  explanation: string;
  suggestedFix?: string;
  source: FindingSource;
  linterName?: string;
  citations: Citation[];
}

/** Aggregated summary of a review session. */
export interface ReviewSummary {
  filesReviewed: number;
  duration: string;
  mode: 'fast' | 'rlm';
  findingsBySeverity: Record<FindingSeverity, number>;
  totalFindings: number;
}

/** Diagnostic trace for observability into the review pipeline. */
export interface ReviewTrace {
  model: string;
  rawFindingsCount: number;
  postValidationCount: number;
  droppedByCitation: Array<{ file: string; lines: string; title: string }>;
  finalFindingsCount: number;
  emptyReason?: 'llm_returned_empty' | 'all_filtered_by_citation' | 'structured_and_fallback_empty';
  path: string;
  durationMs: number;
}

/** Full context passed to the review engine. */
export interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  diff: string;
  files: string[];
  metadata: {
    title: string;
    body: string;
    headSha: string;
    baseSha: string;
    author: string;
  };
  instructions: string;
  learnings: string[];
}

/* ------------------------------------------------------------------ */
/*  Severity ordering (for sorting)                                    */
/* ------------------------------------------------------------------ */

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  severe: 0,
  'non-severe': 1,
  investigate: 2,
  informational: 3,
};

/** Sort findings by severity (most critical first). */
export function sortFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
