import type { FindingCategory, FindingSeverity, PRContext, ReviewFinding, ReviewSummary } from './types.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export const REVIEW_STATE_MARKER = '<!-- openreview-state:';

/** Persisted finding snapshot embedded in the summary comment. */
export interface StoredFinding {
  fingerprint: string;
  category: FindingCategory;
  severity: FindingSeverity;
  file: string;
  startLine: number;
  title: string;
}

export interface ReviewState {
  version: 1;
  headSha: string;
  reviewedAt: string;
  findings: StoredFinding[];
}

export interface ReviewDiff {
  open: ReviewFinding[];
  resolved: StoredFinding[];
  new: ReviewFinding[];
  unchanged: ReviewFinding[];
}

/* ------------------------------------------------------------------ */
/*  Fingerprints                                                       */
/* ------------------------------------------------------------------ */

export function normalizeFindingTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Stable key for matching the same issue across review runs. */
export function fingerprintFinding(finding: Pick<ReviewFinding, 'file' | 'startLine' | 'title'>): string {
  return `${finding.file}:${finding.startLine}:${normalizeFindingTitle(finding.title)}`;
}

export function toStoredFinding(finding: ReviewFinding): StoredFinding {
  return {
    fingerprint: fingerprintFinding(finding),
    category: finding.category,
    severity: finding.severity,
    file: finding.file,
    startLine: finding.startLine,
    title: finding.title,
  };
}

const LINE_DRIFT_TOLERANCE = 12;

export function findingsMatch(previous: StoredFinding, current: ReviewFinding): boolean {
  if (fingerprintFinding(current) === previous.fingerprint) return true;
  if (previous.file !== current.file) return false;
  if (normalizeFindingTitle(previous.title) !== normalizeFindingTitle(current.title)) return false;
  return Math.abs(previous.startLine - current.startLine) <= LINE_DRIFT_TOLERANCE;
}

/* ------------------------------------------------------------------ */
/*  Diff across runs                                                   */
/* ------------------------------------------------------------------ */

export function diffReviewFindings(
  previous: StoredFinding[],
  current: ReviewFinding[],
): ReviewDiff {
  const resolved: StoredFinding[] = [];
  const matchedCurrent = new Set<ReviewFinding>();

  for (const prev of previous) {
    const match = current.find((c) => findingsMatch(prev, c));
    if (match) {
      matchedCurrent.add(match);
    } else {
      resolved.push(prev);
    }
  }

  const unchanged: ReviewFinding[] = [];
  const newFindings: ReviewFinding[] = [];

  for (const finding of current) {
    if (matchedCurrent.has(finding)) {
      unchanged.push(finding);
    } else {
      newFindings.push(finding);
    }
  }

  return {
    open: current,
    resolved,
    new: newFindings,
    unchanged,
  };
}

/* ------------------------------------------------------------------ */
/*  State embed / parse                                                */
/* ------------------------------------------------------------------ */

export function embedReviewState(state: ReviewState): string {
  const payload = Buffer.from(JSON.stringify(state), 'utf-8').toString('base64url');
  return `${REVIEW_STATE_MARKER}${payload} -->`;
}

export function parseReviewState(body: string): ReviewState | null {
  const start = body.indexOf(REVIEW_STATE_MARKER);
  if (start === -1) return null;

  const payloadStart = start + REVIEW_STATE_MARKER.length;
  const end = body.indexOf(' -->', payloadStart);
  if (end === -1) return null;

  try {
    const raw = Buffer.from(body.slice(payloadStart, end), 'base64url').toString('utf-8');
    const parsed = JSON.parse(raw) as ReviewState;
    if (parsed?.version !== 1 || !Array.isArray(parsed.findings)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildReviewState(pr: PRContext, findings: ReviewFinding[]): ReviewState {
  return {
    version: 1,
    headSha: pr.metadata.headSha,
    reviewedAt: new Date().toISOString(),
    findings: findings.map(toStoredFinding),
  };
}

/* ------------------------------------------------------------------ */
/*  Summary enrichment                                                 */
/* ------------------------------------------------------------------ */

function categoryLabel(finding: Pick<ReviewFinding, 'category' | 'severity'>): string {
  if (finding.category === 'bug') return 'Bug';
  if (finding.severity === 'informational') return 'Quality';
  return 'Flag';
}

export function buildReviewNarrative(
  pr: PRContext,
  diff: ReviewDiff,
): string {
  const parts: string[] = [];

  const title = pr.metadata.title?.trim();
  if (title) parts.push(title);

  const bodyFirstLine = pr.metadata.body
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (bodyFirstLine && bodyFirstLine !== title) {
    parts.push(bodyFirstLine);
  }

  if (diff.resolved.length > 0 && diff.open.length === 0) {
    parts.push(
      `Resolved ${diff.resolved.length} previous finding${diff.resolved.length === 1 ? '' : 's'}; no remaining open findings.`,
    );
  } else if (diff.resolved.length > 0) {
    parts.push(
      `Resolved ${diff.resolved.length} previous finding${diff.resolved.length === 1 ? '' : 's'}; ${diff.open.length} still open.`,
    );
  } else if (diff.open.length === 0) {
    parts.push('No issues found in the latest changes.');
  } else if (diff.new.length > 0 && diff.unchanged.length === 0) {
    parts.push(`${diff.open.length} finding${diff.open.length === 1 ? '' : 's'} to review.`);
  } else if (diff.new.length > 0) {
    parts.push(
      `${diff.new.length} new finding${diff.new.length === 1 ? '' : 's'}; ${diff.unchanged.length} still open from earlier review.`,
    );
  } else {
    parts.push(`${diff.open.length} finding${diff.open.length === 1 ? '' : 's'} still need attention.`);
  }

  return parts.join(' ');
}

export function formatFindingListItem(finding: Pick<StoredFinding, 'category' | 'severity' | 'title'>): string {
  return `- **${categoryLabel(finding)}**: ${finding.title}`;
}

export function enrichReviewSummary(
  pr: PRContext,
  findings: ReviewFinding[],
  base: ReviewSummary,
  previousState: ReviewState | null,
): ReviewSummary {
  const previousFindings = previousState?.findings ?? [];
  const diff = diffReviewFindings(previousFindings, findings);
  const actionableOpen = diff.open.filter((f) => f.severity !== 'informational');

  const findingsBySeverity: ReviewSummary['findingsBySeverity'] = {
    severe: 0,
    'non-severe': 0,
    investigate: 0,
    informational: 0,
  };
  for (const finding of diff.open) {
    findingsBySeverity[finding.severity]++;
  }

  return {
    ...base,
    findingsBySeverity,
    totalFindings: diff.open.length,
    openFindings: diff.open,
    resolvedFindings: diff.resolved,
    newFindings: diff.new,
    narrative: buildReviewNarrative(pr, diff),
    approved: actionableOpen.length === 0,
    headSha: pr.metadata.headSha,
    resolvedCount: diff.resolved.length,
    newCount: diff.new.length,
  };
}
