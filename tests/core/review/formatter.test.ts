import { describe, expect, it } from 'vitest';

import { formatInlineComment, formatSummaryComment } from '../../../core/src/review/formatter.js';
import { embedReviewState } from '../../../core/src/review/review-state.js';
import type { ReviewFinding, ReviewSummary } from '../../../core/src/review/types.js';

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: 'test-1',
    category: 'bug',
    severity: 'severe',
    file: 'src/index.ts',
    startLine: 10,
    endLine: 12,
    title: 'Test finding',
    explanation: 'This is a test explanation.',
    source: 'ai',
    citations: [],
    ...overrides,
  };
}

function makeSummary(overrides: Partial<ReviewSummary> = {}): ReviewSummary {
  return {
    filesReviewed: 5,
    duration: '12s',
    mode: 'fast',
    findingsBySeverity: { severe: 0, 'non-severe': 0, investigate: 0, informational: 0 },
    totalFindings: 0,
    ...overrides,
  };
}

describe('formatInlineComment', () => {
  it('renders severe bug badge', () => {
    const result = formatInlineComment(makeFinding({ severity: 'severe' }));
    expect(result).toContain('[CRITICAL] **Bug — Severe**');
  });

  it('includes title and explanation', () => {
    const result = formatInlineComment(
      makeFinding({ title: 'My Title', explanation: 'My Explanation' }),
    );
    expect(result).toContain('My Title');
    expect(result).toContain('My Explanation');
  });
});

describe('formatSummaryComment', () => {
  it('always includes the HTML marker', () => {
    const result = formatSummaryComment(makeSummary());
    expect(result).toContain('<!-- openreview-summary -->');
  });

  it('uses Code Review header with approved badge when approved', () => {
    const result = formatSummaryComment(
      makeSummary({
        approved: true,
        totalFindings: 0,
        narrative: 'All good.',
      }),
    );
    expect(result).toContain('## Code Review');
    expect(result).toContain('✅ **Approved**');
    expect(result).toContain('All good.');
  });

  it('shows resolved and open collapsible sections', () => {
    const result = formatSummaryComment(
      makeSummary({
        approved: false,
        totalFindings: 1,
        resolvedCount: 2,
        resolvedFindings: [
          {
            fingerprint: 'a',
            category: 'bug',
            severity: 'non-severe',
            file: 'src/a.ts',
            startLine: 1,
            title: 'Resolved import error',
          },
          {
            fingerprint: 'b',
            category: 'flag',
            severity: 'informational',
            file: 'src/b.ts',
            startLine: 2,
            title: 'Duplicated helper',
          },
        ],
        openFindings: [makeFinding({ title: 'Still broken' })],
        narrative: 'Partial fix.',
      }),
    );

    expect(result).toContain('<summary>✅ 2 resolved</summary>');
    expect(result).toContain('**Bug**: Resolved import error');
    expect(result).toContain('**Quality**: Duplicated helper');
    expect(result).toContain('<summary>🔎 1 open</summary>');
    expect(result).toContain('**Bug**: Still broken');
  });

  it('embeds review state when provided', () => {
    const state = {
      version: 1 as const,
      headSha: 'abc',
      reviewedAt: '2026-01-01T00:00:00.000Z',
      findings: [],
    };
    const result = formatSummaryComment(makeSummary(), state);
    expect(result).toContain(embedReviewState(state));
  });
});
