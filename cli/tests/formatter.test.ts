import { describe, it, expect } from 'vitest';
import { formatText, formatMarkdown } from '../src/formatter.js';
import type { ReviewFinding, ReviewSummary } from '@openreview/core';

describe('CLI Formatter', () => {
  const mockSummary: ReviewSummary = {
    filesReviewed: 5,
    duration: '2s',
    mode: 'fast',
    findingsBySeverity: { severe: 1, 'non-severe': 0, investigate: 0, informational: 0 },
    totalFindings: 1,
    impactSummary: {
      totalImpacted: 10,
      affectedPageCount: 3
    }
  };

  const mockFinding: ReviewFinding = {
    id: '1',
    category: 'bug',
    severity: 'severe',
    file: 'src/components/Button.tsx',
    startLine: 10,
    endLine: 10,
    title: 'Null pointer exception',
    explanation: 'Could be null',
    source: 'ai',
    citations: [],
    impactScope: {
      affectedFiles: 5,
      affectedPages: 2
    }
  };

  describe('formatText', () => {
    it('should format finding with impact scope', () => {
      const output = formatText([mockFinding], mockSummary);
      expect(output).toContain('[Impact: 2 pages, 5 files]');
      expect(output).toContain('🔴 SEVERE src/components/Button.tsx:10 — Null pointer exception');
    });

    it('should include impact summary', () => {
      const output = formatText([mockFinding], mockSummary);
      expect(output).toContain('Impact Summary: 10 total files impacted, 3 UI pages/routes affected');
    });
  });

  describe('formatMarkdown', () => {
    it('should format finding with impact scope', () => {
      const output = formatMarkdown([mockFinding], mockSummary);
      expect(output).toContain('_[Impact: 2 pages, 5 files]_');
    });

    it('should include impact summary', () => {
      const output = formatMarkdown([mockFinding], mockSummary);
      expect(output).toContain('**Impact:** 10 total files impacted, 3 UI pages/routes affected');
    });
  });
});
