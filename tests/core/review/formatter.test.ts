import { describe, expect, it } from 'vitest';

import { formatInlineComment, formatSummaryComment } from '../../../core/src/review/formatter.js';
import type { ReviewFinding, ReviewSummary } from '../../../core/src/review/types.js';

/* ------------------------------------------------------------------ */
/*  Helper                                                             */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  formatInlineComment — exhaustive                                   */
/* ------------------------------------------------------------------ */

describe('formatInlineComment', () => {
  it('renders severe bug badge', () => {
    const result = formatInlineComment(makeFinding({ severity: 'severe' }));
    expect(result).toContain('[CRITICAL] **Bug — Severe**');
  });

  it('renders non-severe bug badge', () => {
    const result = formatInlineComment(makeFinding({ severity: 'non-severe' }));
    expect(result).toContain('[MODERATE] **Bug — Non-severe**');
  });

  it('renders investigate flag badge', () => {
    const result = formatInlineComment(makeFinding({ severity: 'investigate' }));
    expect(result).toContain('[FLAG] **Investigate**');
  });

  it('renders informational flag badge', () => {
    const result = formatInlineComment(makeFinding({ severity: 'informational' }));
    expect(result).toContain('[INFO] **Informational**');
  });

  it('includes title and explanation', () => {
    const result = formatInlineComment(
      makeFinding({ title: 'My Title', explanation: 'My Explanation' }),
    );
    expect(result).toContain('My Title');
    expect(result).toContain('My Explanation');
  });

  it('includes suggested fix with GitHub suggestion syntax', () => {
    const result = formatInlineComment(makeFinding({ suggestedFix: 'const x = 2;' }));
    expect(result).toContain('```suggestion');
    expect(result).toContain('const x = 2;');
    expect(result).toContain('**Suggested fix:**');
  });

  it('omits suggested fix section when not provided', () => {
    const result = formatInlineComment(makeFinding({ suggestedFix: undefined }));
    expect(result).not.toContain('Suggested fix');
    expect(result).not.toContain('```suggestion');
  });

  it('shows linter attribution for linter source', () => {
    const result = formatInlineComment(makeFinding({ source: 'linter', linterName: 'ESLint' }));
    expect(result).toContain('> Source: ESLint');
  });

  it('shows combined attribution for both source', () => {
    const result = formatInlineComment(makeFinding({ source: 'both', linterName: 'Ruff' }));
    expect(result).toContain('> Source: AI + Ruff');
  });

  it('falls back to "linter" when linterName is undefined for linter source', () => {
    const result = formatInlineComment(makeFinding({ source: 'linter', linterName: undefined }));
    expect(result).toContain('> Source: linter');
  });

  it('does not show source attribution for AI-only findings', () => {
    const result = formatInlineComment(makeFinding({ source: 'ai' }));
    expect(result).not.toContain('Source:');
  });

  it('handles multiline suggested fix', () => {
    const fix = 'if (x) {\n  return true;\n}';
    const result = formatInlineComment(makeFinding({ suggestedFix: fix }));
    expect(result).toContain(fix);
  });

  it('handles special characters in title and explanation', () => {
    const result = formatInlineComment(
      makeFinding({
        title: 'Use `??` instead of `||`',
        explanation: 'The `||` operator coerces to boolean — use `??` for nullish coalescing.',
      }),
    );
    expect(result).toContain('`??`');
    expect(result).toContain('`||`');
  });

  it('handles empty title and explanation', () => {
    const result = formatInlineComment(makeFinding({ title: '', explanation: '' }));
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0); // Badge should still be there
  });
});

/* ------------------------------------------------------------------ */
/*  formatSummaryComment — exhaustive                                  */
/* ------------------------------------------------------------------ */

describe('formatSummaryComment', () => {
  it('always includes the HTML marker', () => {
    const result = formatSummaryComment(makeSummary());
    expect(result).toContain('<!-- openreview-summary -->');
  });

  it('always includes the header', () => {
    const result = formatSummaryComment(makeSummary());
    expect(result).toContain('## OpenReview Summary');
  });

  it('shows files reviewed, duration, and mode', () => {
    const result = formatSummaryComment(
      makeSummary({ filesReviewed: 42, duration: '5m 30s', mode: 'rlm' }),
    );
    expect(result).toContain('**Files reviewed:** 42');
    expect(result).toContain('**Duration:** 5m 30s');
    expect(result).toContain('**Mode:** rlm');
  });

  it('shows no-issues message for zero findings', () => {
    const result = formatSummaryComment(makeSummary({ totalFindings: 0 }));
    expect(result).toContain('[SUCCESS] No issues found.');
    expect(result).not.toContain('| Severity');
  });

  it('shows severity table for findings', () => {
    const result = formatSummaryComment(
      makeSummary({
        totalFindings: 6,
        findingsBySeverity: { severe: 1, 'non-severe': 2, investigate: 1, informational: 2 },
      }),
    );
    expect(result).toContain('[CRITICAL] **Bug — Severe**');
    expect(result).toContain('[MODERATE] **Bug — Non-severe**');
    expect(result).toContain('[FLAG] **Investigate**');
    expect(result).toContain('[INFO] **Informational**');
    expect(result).toContain('**Total:** 6 findings');
  });

  it('only shows non-zero severity rows', () => {
    const result = formatSummaryComment(
      makeSummary({
        totalFindings: 1,
        findingsBySeverity: { severe: 1, 'non-severe': 0, investigate: 0, informational: 0 },
      }),
    );
    expect(result).toContain('[CRITICAL] **Bug — Severe**');
    expect(result).not.toContain('[MODERATE] **Bug — Non-severe**');
    expect(result).not.toContain('[FLAG] **Investigate**');
    expect(result).not.toContain('[INFO] **Informational**');
  });

  it('uses singular "finding" for count of 1', () => {
    const result = formatSummaryComment(
      makeSummary({
        totalFindings: 1,
        findingsBySeverity: { severe: 1, 'non-severe': 0, investigate: 0, informational: 0 },
      }),
    );
    expect(result).toContain('**Total:** 1 finding');
    expect(result).not.toContain('1 findings');
  });

  it('uses plural "findings" for count > 1', () => {
    const result = formatSummaryComment(
      makeSummary({
        totalFindings: 5,
        findingsBySeverity: { severe: 5, 'non-severe': 0, investigate: 0, informational: 0 },
      }),
    );
    expect(result).toContain('5 findings');
  });

  it('includes trigger hints', () => {
    const result = formatSummaryComment(makeSummary());
    expect(result).toContain('`@openreview rlm`');
    expect(result).toContain('`@openreview <your question>`');
  });

  it('handles very large counts', () => {
    const result = formatSummaryComment(
      makeSummary({
        totalFindings: 9999,
        filesReviewed: 500,
        findingsBySeverity: { severe: 9999, 'non-severe': 0, investigate: 0, informational: 0 },
      }),
    );
    expect(result).toContain('9999');
    expect(result).toContain('500');
  });

  it('severity rows appear in correct order (severe first)', () => {
    const result = formatSummaryComment(
      makeSummary({
        totalFindings: 4,
        findingsBySeverity: { severe: 1, 'non-severe': 1, investigate: 1, informational: 1 },
      }),
    );

    const severeIdx = result.indexOf('[CRITICAL] **Bug — Severe**');
    const nonSevereIdx = result.indexOf('[MODERATE] **Bug — Non-severe**');
    const investigateIdx = result.indexOf('[FLAG] **Investigate**');
    const infoIdx = result.indexOf('[INFO] **Informational**');

    expect(severeIdx).toBeLessThan(nonSevereIdx);
    expect(nonSevereIdx).toBeLessThan(investigateIdx);
    expect(investigateIdx).toBeLessThan(infoIdx);
  });
});
