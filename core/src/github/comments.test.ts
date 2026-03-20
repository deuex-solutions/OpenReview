import { describe, expect, it } from 'vitest';

import { formatInlineComment, formatSummaryComment } from '../review/formatter.js';
import type { ReviewFinding, ReviewSummary } from '../review/types.js';

/* ------------------------------------------------------------------ */
/*  formatInlineComment                                                */
/* ------------------------------------------------------------------ */

describe('formatInlineComment', () => {
  it('formats a finding with severity badge and explanation', () => {
    const finding: ReviewFinding = {
      id: 'test-1',
      category: 'bug',
      severity: 'severe',
      file: 'src/index.ts',
      startLine: 10,
      endLine: 10,
      title: 'Potential null dereference',
      explanation: 'The variable `user` may be undefined at this point.',
      source: 'ai',
      citations: [],
    };

    const result = formatInlineComment(finding);
    expect(result).toContain('**Bug — Severe**');
    expect(result).toContain('Potential null dereference');
    expect(result).toContain('The variable `user` may be undefined');
  });

  it('includes a suggested fix code block when provided', () => {
    const finding: ReviewFinding = {
      id: 'test-2',
      category: 'flag',
      severity: 'investigate',
      file: 'src/index.ts',
      startLine: 5,
      endLine: 5,
      title: 'Use optional chaining',
      explanation: 'Safer to use optional chaining here.',
      suggestedFix: 'const name = user?.name ?? "unknown";',
      source: 'ai',
      citations: [],
    };

    const result = formatInlineComment(finding);
    expect(result).toContain('```suggestion');
    expect(result).toContain('const name = user?.name ?? "unknown";');
    expect(result).toContain('**Suggested fix:**');
  });

  it('handles all severity levels', () => {
    const severities = ['severe', 'non-severe', 'investigate', 'informational'] as const;
    for (const severity of severities) {
      const result = formatInlineComment({
        id: `test-${severity}`,
        category: severity === 'severe' || severity === 'non-severe' ? 'bug' : 'flag',
        severity,
        file: 'a.ts',
        startLine: 1,
        endLine: 1,
        title: 'Test',
        explanation: 'Test',
        source: 'ai',
        citations: [],
      });
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('shows linter attribution for linter findings', () => {
    const finding: ReviewFinding = {
      id: 'test-lint',
      category: 'flag',
      severity: 'informational',
      file: 'a.ts',
      startLine: 1,
      endLine: 1,
      title: 'ESLint: no-unused-vars',
      explanation: 'Variable is unused.',
      source: 'linter',
      linterName: 'ESLint',
      citations: [],
    };

    const result = formatInlineComment(finding);
    expect(result).toContain('Source: ESLint');
  });

  it('shows combined attribution for merged findings', () => {
    const finding: ReviewFinding = {
      id: 'test-both',
      category: 'bug',
      severity: 'non-severe',
      file: 'a.ts',
      startLine: 1,
      endLine: 1,
      title: 'Potential issue',
      explanation: 'Detected by both.',
      source: 'both',
      linterName: 'Ruff',
      citations: [],
    };

    const result = formatInlineComment(finding);
    expect(result).toContain('Source: AI + Ruff');
  });
});

/* ------------------------------------------------------------------ */
/*  formatSummaryComment                                               */
/* ------------------------------------------------------------------ */

describe('formatSummaryComment', () => {
  it('includes the HTML marker for replace-not-duplicate', () => {
    const summary: ReviewSummary = {
      totalFindings: 3,
      findingsBySeverity: { severe: 0, 'non-severe': 1, investigate: 2, informational: 0 },
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
      findingsBySeverity: { severe: 1, 'non-severe': 0, investigate: 2, informational: 0 },
      filesReviewed: 10,
      duration: '8s',
      mode: 'rlm',
    };

    const result = formatSummaryComment(summary);
    expect(result).toContain('**Bug — Severe**');
    expect(result).toContain('**Flag — Investigate**');
    expect(result).toContain('**Total:** 3 findings');
  });

  it('shows success message when no findings', () => {
    const summary: ReviewSummary = {
      totalFindings: 0,
      findingsBySeverity: { severe: 0, 'non-severe': 0, investigate: 0, informational: 0 },
      filesReviewed: 3,
      duration: '2s',
      mode: 'fast',
    };

    const result = formatSummaryComment(summary);
    expect(result).toContain('No issues found');
  });

  it('includes trigger hints', () => {
    const summary: ReviewSummary = {
      totalFindings: 0,
      findingsBySeverity: { severe: 0, 'non-severe': 0, investigate: 0, informational: 0 },
      filesReviewed: 1,
      duration: '1s',
      mode: 'fast',
    };

    const result = formatSummaryComment(summary);
    expect(result).toContain('`@openreview rlm`');
    expect(result).toContain('`@openreview <your question>`');
  });

  it('uses singular "finding" for count of 1', () => {
    const summary: ReviewSummary = {
      totalFindings: 1,
      findingsBySeverity: { severe: 0, 'non-severe': 0, investigate: 0, informational: 1 },
      filesReviewed: 1,
      duration: '1s',
      mode: 'fast',
    };

    const result = formatSummaryComment(summary);
    expect(result).toContain('**Total:** 1 finding');
    expect(result).not.toContain('1 findings');
  });
});
