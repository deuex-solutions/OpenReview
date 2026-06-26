import { describe, expect, it } from 'vitest';

import {
  diffReviewFindings,
  embedReviewState,
  enrichReviewSummary,
  fingerprintFinding,
  findingsMatch,
  normalizeFindingTitle,
  parseReviewState,
  toStoredFinding,
} from '../../../core/src/review/review-state.js';
import type { PRContext, ReviewFinding, ReviewSummary } from '../../../core/src/review/types.js';

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: 'f-1',
    category: 'bug',
    severity: 'non-severe',
    file: 'src/foo.ts',
    startLine: 10,
    endLine: 10,
    title: 'Missing null check',
    explanation: 'x can be null',
    source: 'ai',
    citations: [],
    ...overrides,
  };
}

function makePr(overrides: Partial<PRContext> = {}): PRContext {
  return {
    owner: 'acme',
    repo: 'app',
    prNumber: 1,
    diff: '',
    files: ['src/foo.ts'],
    metadata: {
      title: 'Add fixture deletion',
      body: 'Implements round deletion for tournaments.',
      headSha: 'abc123',
      baseSha: 'def456',
      author: 'dev',
    },
    instructions: '',
    learnings: [],
    ...overrides,
  };
}

function makeSummary(): ReviewSummary {
  return {
    filesReviewed: 3,
    duration: '8s',
    mode: 'fast',
    findingsBySeverity: { severe: 0, 'non-severe': 1, investigate: 0, informational: 0 },
    totalFindings: 1,
  };
}

describe('fingerprintFinding', () => {
  it('normalizes title whitespace and case', () => {
    const a = fingerprintFinding(makeFinding({ title: '  Missing   Null Check ' }));
    const b = fingerprintFinding(makeFinding({ title: 'missing null check' }));
    expect(a).toBe(b);
  });
});

describe('findingsMatch', () => {
  it('matches when line number drifts slightly', () => {
    const prev = toStoredFinding(makeFinding({ startLine: 10 }));
    const curr = makeFinding({ startLine: 14 });
    expect(findingsMatch(prev, curr)).toBe(true);
  });

  it('does not match different titles', () => {
    const prev = toStoredFinding(makeFinding({ title: 'Issue A' }));
    const curr = makeFinding({ title: 'Issue B' });
    expect(findingsMatch(prev, curr)).toBe(false);
  });
});

describe('diffReviewFindings', () => {
  it('marks missing previous findings as resolved', () => {
    const previous = [toStoredFinding(makeFinding({ title: 'Fixed bug' }))];
    const current = [makeFinding({ title: 'New bug', startLine: 40 })];

    const diff = diffReviewFindings(previous, current);
    expect(diff.resolved).toHaveLength(1);
    expect(diff.resolved[0].title).toBe('Fixed bug');
    expect(diff.new).toHaveLength(1);
    expect(diff.new[0].title).toBe('New bug');
  });

  it('keeps unchanged findings out of the new list', () => {
    const previous = [toStoredFinding(makeFinding())];
    const current = [makeFinding()];

    const diff = diffReviewFindings(previous, current);
    expect(diff.resolved).toHaveLength(0);
    expect(diff.new).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(1);
  });
});

describe('review state embed/parse', () => {
  it('round-trips state in a comment body', () => {
    const state = {
      version: 1 as const,
      headSha: 'sha1',
      reviewedAt: '2026-01-01T00:00:00.000Z',
      findings: [toStoredFinding(makeFinding())],
    };
    const body = `<!-- openreview-summary -->\n${embedReviewState(state)}\n## Code Review`;
    expect(parseReviewState(body)?.headSha).toBe('sha1');
    expect(parseReviewState(body)?.findings).toHaveLength(1);
  });
});

describe('enrichReviewSummary', () => {
  it('builds approved summary when previous issues are gone', () => {
    const previous = {
      version: 1 as const,
      headSha: 'old',
      reviewedAt: '2026-01-01T00:00:00.000Z',
      findings: [toStoredFinding(makeFinding())],
    };

    const summary = enrichReviewSummary(makePr(), [], makeSummary(), previous);
    expect(summary.approved).toBe(true);
    expect(summary.resolvedCount).toBe(1);
    expect(summary.totalFindings).toBe(0);
    expect(summary.narrative).toContain('Resolved 1 previous finding');
  });

  it('includes PR title and body in narrative', () => {
    const summary = enrichReviewSummary(makePr(), [makeFinding()], makeSummary(), null);
    expect(summary.narrative).toContain('Add fixture deletion');
    expect(summary.narrative).toContain('Implements round deletion');
  });
});

describe('normalizeFindingTitle', () => {
  it('trims and collapses spaces', () => {
    expect(normalizeFindingTitle('  hello   world ')).toBe('hello world');
  });
});
