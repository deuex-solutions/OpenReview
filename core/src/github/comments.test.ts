import { describe, expect, it } from 'vitest';

import type { ReviewFinding, ReviewSummary } from './comments.js';
import { formatInlineComment, formatSummaryComment } from './comments.js';

/* ------------------------------------------------------------------ */
/*  formatInlineComment                                                */
/* ------------------------------------------------------------------ */

describe('formatInlineComment', () => {
  it('formats a finding with severity badge and explanation', () => {
    const finding: ReviewFinding = {
      file: 'src/index.ts',
      line: 10,
      severity: 'high',
      title: 'Potential null dereference',
      explanation: 'The variable `user` may be undefined at this point.',
    };

    const result = formatInlineComment(finding);
    expect(result).toContain('**High**');
    expect(result).toContain('Potential null dereference');
    expect(result).toContain('The variable `user` may be undefined');
  });

  it('includes a suggested fix code block when provided', () => {
    const finding: ReviewFinding = {
      file: 'src/index.ts',
      line: 5,
      severity: 'medium',
      title: 'Use optional chaining',
      explanation: 'Safer to use optional chaining here.',
      suggestedFix: 'const name = user?.name ?? "unknown";',
    };

    const result = formatInlineComment(finding);
    expect(result).toContain('```suggestion');
    expect(result).toContain('const name = user?.name ?? "unknown";');
    expect(result).toContain('**Suggested fix:**');
  });

  it('handles all severity levels', () => {
    const severities = ['critical', 'high', 'medium', 'low', 'info'] as const;
    for (const severity of severities) {
      const result = formatInlineComment({
        file: 'a.ts',
        line: 1,
        severity,
        title: 'Test',
        explanation: 'Test',
      });
      expect(result.length).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  formatSummaryComment                                               */
/* ------------------------------------------------------------------ */

describe('formatSummaryComment', () => {
  it('includes the HTML marker for replace-not-duplicate', () => {
    const summary: ReviewSummary = {
      totalFindings: 3,
      bySeverity: { critical: 0, high: 1, medium: 2, low: 0, info: 0 },
      filesReviewed: 5,
      duration: '12s',
      mode: 'fast',
    };

    const result = formatSummaryComment(summary);
    expect(result).toContain('<!-- openreview-summary -->');
  });

  it('shows severity table for findings', () => {
    const summary: ReviewSummary = {
      totalFindings: 3,
      bySeverity: { critical: 1, high: 0, medium: 2, low: 0, info: 0 },
      filesReviewed: 10,
      duration: '8s',
      mode: 'rlm',
    };

    const result = formatSummaryComment(summary);
    expect(result).toContain('**Critical**');
    expect(result).toContain('**Medium**');
    expect(result).toContain('**Total:** 3 findings');
    expect(result).toContain('**Mode:** rlm');
  });

  it('shows success message when no findings', () => {
    const summary: ReviewSummary = {
      totalFindings: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      filesReviewed: 3,
      duration: '2s',
      mode: 'fast',
    };

    const result = formatSummaryComment(summary);
    expect(result).toContain('No issues found');
  });

  it('includes highlights when provided', () => {
    const summary: ReviewSummary = {
      totalFindings: 1,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 1, info: 0 },
      filesReviewed: 2,
      duration: '5s',
      mode: 'fast',
      highlights: ['Consider adding error handling', 'Good test coverage'],
    };

    const result = formatSummaryComment(summary);
    expect(result).toContain('- Consider adding error handling');
    expect(result).toContain('- Good test coverage');
    expect(result).toContain('### Highlights');
  });

  it('uses singular "finding" for count of 1', () => {
    const summary: ReviewSummary = {
      totalFindings: 1,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 1 },
      filesReviewed: 1,
      duration: '1s',
      mode: 'fast',
    };

    const result = formatSummaryComment(summary);
    expect(result).toContain('**Total:** 1 finding');
    expect(result).not.toContain('1 findings');
  });
});
