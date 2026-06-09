import { describe, expect, it } from 'vitest';

import { sortFindings } from '../../../core/src/review/types.js';
import type { ReviewFinding } from '../../../core/src/review/types.js';

function makeFinding(
  severity: ReviewFinding['severity'],
  id = 'test',
  overrides: Partial<ReviewFinding> = {},
): ReviewFinding {
  return {
    id,
    category: severity === 'severe' || severity === 'non-severe' ? 'bug' : 'flag',
    severity,
    file: 'a.ts',
    startLine: 1,
    endLine: 1,
    title: `Finding ${severity}`,
    explanation: 'Test',
    source: 'ai',
    citations: [],
    ...overrides,
  };
}

describe('sortFindings', () => {
  it('sorts severe first, then non-severe, investigate, informational', () => {
    const input = [
      makeFinding('informational', '4'),
      makeFinding('severe', '1'),
      makeFinding('investigate', '3'),
      makeFinding('non-severe', '2'),
    ];

    const sorted = sortFindings(input);
    expect(sorted.map((f) => f.severity)).toEqual([
      'severe',
      'non-severe',
      'investigate',
      'informational',
    ]);
  });

  it('does not mutate the original array', () => {
    const input = [makeFinding('informational'), makeFinding('severe')];
    const sorted = sortFindings(input);
    expect(sorted).not.toBe(input);
    expect(input[0].severity).toBe('informational');
  });

  it('handles empty array', () => {
    expect(sortFindings([])).toEqual([]);
  });

  it('handles single element', () => {
    const input = [makeFinding('investigate')];
    const sorted = sortFindings(input);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].severity).toBe('investigate');
  });

  it('handles all same severity', () => {
    const input = [
      makeFinding('severe', '1'),
      makeFinding('severe', '2'),
      makeFinding('severe', '3'),
    ];
    const sorted = sortFindings(input);
    expect(sorted).toHaveLength(3);
    expect(sorted.every((f) => f.severity === 'severe')).toBe(true);
  });

  it('preserves relative order for same severity (stable sort)', () => {
    const input = [
      makeFinding('severe', 'first'),
      makeFinding('severe', 'second'),
      makeFinding('severe', 'third'),
    ];
    const sorted = sortFindings(input);
    expect(sorted.map((f) => f.id)).toEqual(['first', 'second', 'third']);
  });

  it('handles all four severities interleaved', () => {
    const input = [
      makeFinding('informational', 'i1'),
      makeFinding('severe', 's1'),
      makeFinding('non-severe', 'n1'),
      makeFinding('investigate', 'inv1'),
      makeFinding('severe', 's2'),
      makeFinding('informational', 'i2'),
    ];
    const sorted = sortFindings(input);
    expect(sorted.map((f) => f.severity)).toEqual([
      'severe',
      'severe',
      'non-severe',
      'investigate',
      'informational',
      'informational',
    ]);
  });

  it('preserves all finding properties after sort', () => {
    const finding = makeFinding('severe', 'full', {
      file: 'important.ts',
      startLine: 42,
      endLine: 44,
      title: 'Critical Bug',
      explanation: 'This is bad',
      suggestedFix: 'fix it',
      source: 'both',
      linterName: 'ESLint',
      citations: [{ file: 'important.ts', startLine: 42, endLine: 44 }],
    });

    const sorted = sortFindings([makeFinding('informational'), finding]);
    const result = sorted[0]; // severe should come first
    expect(result.id).toBe('full');
    expect(result.file).toBe('important.ts');
    expect(result.startLine).toBe(42);
    expect(result.suggestedFix).toBe('fix it');
    expect(result.linterName).toBe('ESLint');
    expect(result.citations).toHaveLength(1);
  });

  it('sorts by impact scope when severities are equal', () => {
    const input = [
      makeFinding('severe', 's-low-impact', { impactScope: { affectedFiles: 1, affectedPages: 0 } }),
      makeFinding('severe', 's-high-pages', { impactScope: { affectedFiles: 5, affectedPages: 2 } }),
      makeFinding('severe', 's-high-files', { impactScope: { affectedFiles: 10, affectedPages: 0 } }),
      makeFinding('non-severe', 'n-high-impact', { impactScope: { affectedFiles: 10, affectedPages: 5 } }),
    ];
    
    // Expected order:
    // 1. severe, 2 pages (s-high-pages)
    // 2. severe, 0 pages, 10 files (s-high-files)
    // 3. severe, 0 pages, 1 file (s-low-impact)
    // 4. non-severe, high impact (severity takes precedence) (n-high-impact)
    
    const sorted = sortFindings(input);
    expect(sorted.map(f => f.id)).toEqual([
      's-high-pages',
      's-high-files',
      's-low-impact',
      'n-high-impact'
    ]);
  });
});

