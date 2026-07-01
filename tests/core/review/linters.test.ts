import { describe, expect, it } from 'vitest';

import {
  deduplicateFindings,
  parseEslintOutput,
  parseGitleaksOutput,
  parseRuffOutput,
  parseSemgrepOutput,
  parseShellcheckOutput,
} from '../../../core/src/review/linters.js';
import type { ReviewFinding } from '../../../core/src/review/types.js';

/* ------------------------------------------------------------------ */
/*  ESLint parser                                                      */
/* ------------------------------------------------------------------ */

describe('parseEslintOutput', () => {
  it('parses ESLint JSON output into findings', () => {
    const raw = JSON.stringify([
      {
        filePath: 'src/index.ts',
        messages: [
          {
            ruleId: 'no-unused-vars',
            severity: 1,
            message: "'foo' is defined but never used.",
            line: 5,
            endLine: 5,
            column: 7,
            endColumn: 10,
          },
          {
            ruleId: 'no-undef',
            severity: 2,
            message: "'bar' is not defined.",
            line: 12,
            column: 3,
          },
        ],
      },
    ]);

    const findings = parseEslintOutput(raw);
    expect(findings).toHaveLength(2);

    expect(findings[0].linterName).toBe('ESLint');
    expect(findings[0].source).toBe('linter');
    expect(findings[0].severity).toBe('informational'); // severity 1 = warning
    expect(findings[0].startLine).toBe(5);
    expect(findings[0].category).toBe('flag');

    expect(findings[1].severity).toBe('non-severe'); // severity 2 = error
    expect(findings[1].category).toBe('bug');
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseEslintOutput('not json')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseEslintOutput('')).toEqual([]);
  });

  it('handles empty results', () => {
    expect(parseEslintOutput(JSON.stringify([{ filePath: 'a.ts', messages: [] }]))).toEqual([]);
  });

  it('handles multiple files with multiple messages', () => {
    const raw = JSON.stringify([
      {
        filePath: 'a.ts',
        messages: [
          { ruleId: 'rule1', severity: 1, message: 'msg1', line: 1, column: 1 },
          { ruleId: 'rule2', severity: 2, message: 'msg2', line: 2, column: 1 },
        ],
      },
      {
        filePath: 'b.ts',
        messages: [{ ruleId: 'rule3', severity: 1, message: 'msg3', line: 10, column: 5 }],
      },
    ]);

    const findings = parseEslintOutput(raw);
    expect(findings).toHaveLength(3);
    expect(findings[0].file).toBe('a.ts');
    expect(findings[2].file).toBe('b.ts');
  });

  it('uses "error" when ruleId is null', () => {
    const raw = JSON.stringify([
      {
        filePath: 'a.ts',
        messages: [{ ruleId: null, severity: 2, message: 'Parse error', line: 1, column: 1 }],
      },
    ]);

    const findings = parseEslintOutput(raw);
    expect(findings[0].title).toBe('ESLint: error');
    expect(findings[0].id).toContain('unknown');
  });

  it('defaults endLine to line when endLine is missing', () => {
    const raw = JSON.stringify([
      {
        filePath: 'a.ts',
        messages: [{ ruleId: 'test', severity: 1, message: 'msg', line: 7, column: 1 }],
      },
    ]);

    const findings = parseEslintOutput(raw);
    expect(findings[0].startLine).toBe(7);
    expect(findings[0].endLine).toBe(7);
  });

  it('includes fix text when available', () => {
    const raw = JSON.stringify([
      {
        filePath: 'a.ts',
        messages: [
          {
            ruleId: 'semi',
            severity: 2,
            message: 'Missing semicolon.',
            line: 1,
            column: 10,
            fix: { range: [9, 9], text: ';' },
          },
        ],
      },
    ]);

    const findings = parseEslintOutput(raw);
    expect(findings[0].suggestedFix).toBe(';');
  });

  it('generates unique IDs per finding', () => {
    const raw = JSON.stringify([
      {
        filePath: 'a.ts',
        messages: [
          { ruleId: 'r1', severity: 1, message: 'm1', line: 1, column: 1 },
          { ruleId: 'r2', severity: 1, message: 'm2', line: 2, column: 1 },
        ],
      },
    ]);

    const findings = parseEslintOutput(raw);
    expect(findings[0].id).not.toBe(findings[1].id);
  });

  it('handles JSON array that is not the expected shape', () => {
    expect(parseEslintOutput(JSON.stringify([1, 2, 3]))).toEqual([]);
  });

  it('handles null input gracefully', () => {
    expect(parseEslintOutput('null')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Ruff parser                                                        */
/* ------------------------------------------------------------------ */

describe('parseRuffOutput', () => {
  it('parses Ruff JSON output', () => {
    const raw = JSON.stringify([
      {
        code: 'F401',
        message: 'os imported but unused',
        filename: 'app.py',
        location: { row: 1, column: 1 },
        end_location: { row: 1, column: 10 },
      },
    ]);

    const findings = parseRuffOutput(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0].linterName).toBe('Ruff');
    expect(findings[0].title).toBe('Ruff: F401');
    expect(findings[0].file).toBe('app.py');
    expect(findings[0].source).toBe('linter');
    expect(findings[0].category).toBe('flag');
    expect(findings[0].severity).toBe('non-severe');
  });

  it('defaults endLine to startLine when end_location is missing', () => {
    const raw = JSON.stringify([
      {
        code: 'E501',
        message: 'line too long',
        filename: 'a.py',
        location: { row: 42, column: 1 },
      },
    ]);

    const findings = parseRuffOutput(raw);
    expect(findings[0].startLine).toBe(42);
    expect(findings[0].endLine).toBe(42);
  });

  it('handles multiple diagnostics', () => {
    const raw = JSON.stringify([
      { code: 'F401', message: 'msg1', filename: 'a.py', location: { row: 1, column: 1 } },
      { code: 'E501', message: 'msg2', filename: 'b.py', location: { row: 5, column: 80 } },
      { code: 'W291', message: 'msg3', filename: 'a.py', location: { row: 10, column: 1 } },
    ]);

    const findings = parseRuffOutput(raw);
    expect(findings).toHaveLength(3);
  });

  it('returns empty for invalid JSON', () => {
    expect(parseRuffOutput('garbage')).toEqual([]);
  });

  it('returns empty for empty array', () => {
    expect(parseRuffOutput('[]')).toEqual([]);
  });

  it('skips malformed entries (missing required fields)', () => {
    const raw = JSON.stringify([
      { code: 'F401' }, // missing filename, location
      42, // not an object
      { code: 'F401', filename: 'a.py', location: { row: 1, column: 1 } }, // valid
    ]);
    const findings = parseRuffOutput(raw);
    expect(findings).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Semgrep parser                                                     */
/* ------------------------------------------------------------------ */

describe('parseSemgrepOutput', () => {
  it('parses Semgrep JSON output', () => {
    const raw = JSON.stringify({
      results: [
        {
          check_id: 'javascript.express.security.audit.xss',
          path: 'server.js',
          start: { line: 20, col: 5 },
          end: { line: 22, col: 10 },
          extra: { message: 'Potential XSS vulnerability', severity: 'ERROR' },
        },
      ],
    });

    const findings = parseSemgrepOutput(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('severe');
    expect(findings[0].category).toBe('bug');
    expect(findings[0].linterName).toBe('Semgrep');
  });

  it('maps WARNING severity to non-severe', () => {
    const raw = JSON.stringify({
      results: [
        {
          check_id: 'test-rule',
          path: 'a.js',
          start: { line: 1, col: 1 },
          end: { line: 1, col: 10 },
          extra: { severity: 'WARNING' },
        },
      ],
    });

    const findings = parseSemgrepOutput(raw);
    expect(findings[0].severity).toBe('non-severe');
    expect(findings[0].category).toBe('flag');
  });

  it('maps INFO severity to investigate', () => {
    const raw = JSON.stringify({
      results: [
        {
          check_id: 'test-rule',
          path: 'a.js',
          start: { line: 1, col: 1 },
          end: { line: 1, col: 10 },
          extra: { severity: 'INFO' },
        },
      ],
    });

    const findings = parseSemgrepOutput(raw);
    expect(findings[0].severity).toBe('investigate');
  });

  it('maps unknown severity to investigate', () => {
    const raw = JSON.stringify({
      results: [
        {
          check_id: 'test-rule',
          path: 'a.js',
          start: { line: 1, col: 1 },
          end: { line: 1, col: 10 },
          extra: { severity: 'UNKNOWN_LEVEL' },
        },
      ],
    });

    const findings = parseSemgrepOutput(raw);
    expect(findings[0].severity).toBe('investigate');
  });

  it('uses check_id as fallback when extra.message is missing', () => {
    const raw = JSON.stringify({
      results: [
        {
          check_id: 'my-custom-rule',
          path: 'a.js',
          start: { line: 1, col: 1 },
          end: { line: 1, col: 10 },
        },
      ],
    });

    const findings = parseSemgrepOutput(raw);
    expect(findings[0].explanation).toBe('my-custom-rule');
  });

  it('returns empty for missing results key', () => {
    expect(parseSemgrepOutput(JSON.stringify({}))).toEqual([]);
  });

  it('returns empty for results: null', () => {
    expect(parseSemgrepOutput(JSON.stringify({ results: null }))).toEqual([]);
  });

  it('returns empty for invalid JSON', () => {
    expect(parseSemgrepOutput('not json')).toEqual([]);
  });

  it('skips malformed result entries', () => {
    const raw = JSON.stringify({
      results: [
        { check_id: 'rule1' }, // missing path, start, end
        { check_id: 'rule2', path: 'a.js', start: { line: 1, col: 1 }, end: { line: 1, col: 5 } }, // valid
      ],
    });
    const findings = parseSemgrepOutput(raw);
    expect(findings).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  ShellCheck parser                                                  */
/* ------------------------------------------------------------------ */

describe('parseShellcheckOutput', () => {
  it('parses ShellCheck JSON output', () => {
    const raw = JSON.stringify([
      {
        file: 'deploy.sh',
        line: 3,
        endLine: 3,
        column: 1,
        endColumn: 15,
        level: 'error',
        code: 2086,
        message: 'Double quote to prevent globbing and word splitting.',
      },
    ]);

    const findings = parseShellcheckOutput(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('ShellCheck: SC2086');
    expect(findings[0].category).toBe('bug');
    expect(findings[0].severity).toBe('non-severe');
  });

  it('maps warning level to informational', () => {
    const raw = JSON.stringify([
      { file: 'a.sh', line: 1, column: 1, level: 'warning', code: 1234, message: 'Test' },
    ]);

    const findings = parseShellcheckOutput(raw);
    expect(findings[0].severity).toBe('informational');
    expect(findings[0].category).toBe('flag');
  });

  it('maps info level to informational', () => {
    const raw = JSON.stringify([
      { file: 'a.sh', line: 1, column: 1, level: 'info', code: 5678, message: 'Info msg' },
    ]);

    const findings = parseShellcheckOutput(raw);
    expect(findings[0].severity).toBe('informational');
  });

  it('maps style level to informational', () => {
    const raw = JSON.stringify([
      { file: 'a.sh', line: 1, column: 1, level: 'style', code: 9999, message: 'Style msg' },
    ]);

    const findings = parseShellcheckOutput(raw);
    expect(findings[0].severity).toBe('informational');
  });

  it('defaults endLine to line when missing', () => {
    const raw = JSON.stringify([
      { file: 'a.sh', line: 15, column: 1, level: 'error', code: 2086, message: 'Test' },
    ]);

    const findings = parseShellcheckOutput(raw);
    expect(findings[0].endLine).toBe(15);
  });

  it('returns empty for invalid JSON', () => {
    expect(parseShellcheckOutput('invalid')).toEqual([]);
  });

  it('returns empty for empty array', () => {
    expect(parseShellcheckOutput('[]')).toEqual([]);
  });

  it('skips malformed entries', () => {
    const raw = JSON.stringify([
      { file: 'a.sh' }, // missing line, code
      'not an object',
      { file: 'b.sh', line: 1, column: 1, level: 'error', code: 2086, message: 'Valid' }, // valid
    ]);
    const findings = parseShellcheckOutput(raw);
    expect(findings).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Gitleaks parser                                                    */
/* ------------------------------------------------------------------ */

describe('parseGitleaksOutput', () => {
  it('parses Gitleaks JSON output', () => {
    const raw = JSON.stringify([
      {
        RuleID: 'generic-api-key',
        Description: 'Generic API Key',
        File: '.env.prod',
        StartLine: 5,
        EndLine: 5,
        Match: 'API_KEY=sk-1234...',
      },
    ]);

    const findings = parseGitleaksOutput(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('severe');
    expect(findings[0].category).toBe('bug');
    expect(findings[0].linterName).toBe('Gitleaks');
    expect(findings[0].explanation).toContain('Secret detected');
    expect(findings[0].explanation).toContain('`API_KEY=sk-1234...`');
  });

  it('defaults EndLine to StartLine when missing', () => {
    const raw = JSON.stringify([
      {
        RuleID: 'aws-key',
        Description: 'AWS Key',
        File: 'config.json',
        StartLine: 10,
        Match: 'AKIA...',
      },
    ]);

    const findings = parseGitleaksOutput(raw);
    expect(findings[0].startLine).toBe(10);
    expect(findings[0].endLine).toBe(10);
  });

  it('handles multiple leaks', () => {
    const raw = JSON.stringify([
      { RuleID: 'r1', Description: 'd1', File: 'a.env', StartLine: 1, Match: 'm1' },
      { RuleID: 'r2', Description: 'd2', File: 'b.env', StartLine: 3, Match: 'm2' },
      { RuleID: 'r3', Description: 'd3', File: 'a.env', StartLine: 8, Match: 'm3' },
    ]);

    const findings = parseGitleaksOutput(raw);
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.severity === 'severe')).toBe(true);
  });

  it('returns empty for invalid JSON', () => {
    expect(parseGitleaksOutput('not json')).toEqual([]);
  });

  it('returns empty for empty array', () => {
    expect(parseGitleaksOutput('[]')).toEqual([]);
  });

  it('returns empty for null JSON', () => {
    expect(parseGitleaksOutput('null')).toEqual([]);
  });

  it('skips malformed entries', () => {
    const raw = JSON.stringify([
      { RuleID: 'r1' }, // missing File, StartLine
      42,
      { RuleID: 'r2', File: 'a.env', StartLine: 1, Description: 'd', Match: 'm' }, // valid
    ]);
    const findings = parseGitleaksOutput(raw);
    expect(findings).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Deduplication                                                      */
/* ------------------------------------------------------------------ */

describe('deduplicateFindings', () => {
  function makeFinding(
    file: string,
    startLine: number,
    endLine: number,
    source: ReviewFinding['source'],
    linterName?: string,
  ): ReviewFinding {
    return {
      id: `${source}-${file}-${startLine}`,
      category: 'bug',
      severity: 'non-severe',
      file,
      startLine,
      endLine,
      title: 'Test finding',
      explanation: 'Test',
      source,
      linterName,
      citations: [],
    };
  }

  it('merges overlapping AI + linter findings into source: both', () => {
    const ai = [makeFinding('a.ts', 10, 12, 'ai')];
    const linter = [makeFinding('a.ts', 11, 11, 'linter', 'ESLint')];

    const merged = deduplicateFindings(ai, linter);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('both');
    expect(merged[0].linterName).toBe('ESLint');
  });

  it('keeps non-overlapping findings separate', () => {
    const ai = [makeFinding('a.ts', 10, 12, 'ai')];
    const linter = [makeFinding('b.ts', 5, 5, 'linter', 'Ruff')];

    const merged = deduplicateFindings(ai, linter);
    expect(merged).toHaveLength(2);
  });

  it('keeps non-overlapping lines in same file separate', () => {
    const ai = [makeFinding('a.ts', 10, 12, 'ai')];
    const linter = [makeFinding('a.ts', 50, 52, 'linter', 'ESLint')];

    const merged = deduplicateFindings(ai, linter);
    expect(merged).toHaveLength(2);
  });

  it('handles empty inputs', () => {
    expect(deduplicateFindings([], [])).toEqual([]);
    expect(deduplicateFindings([makeFinding('a.ts', 1, 1, 'ai')], [])).toHaveLength(1);
    expect(deduplicateFindings([], [makeFinding('a.ts', 1, 1, 'linter')])).toHaveLength(1);
  });

  it('detects exact line overlap (single line)', () => {
    const ai = [makeFinding('a.ts', 5, 5, 'ai')];
    const linter = [makeFinding('a.ts', 5, 5, 'linter', 'ESLint')];

    const merged = deduplicateFindings(ai, linter);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('both');
  });

  it('detects overlap at boundary (AI ends where linter starts)', () => {
    const ai = [makeFinding('a.ts', 5, 10, 'ai')];
    const linter = [makeFinding('a.ts', 10, 15, 'linter', 'ESLint')];

    const merged = deduplicateFindings(ai, linter);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('both');
  });

  it('does not merge adjacent but non-overlapping ranges', () => {
    const ai = [makeFinding('a.ts', 5, 9, 'ai')];
    const linter = [makeFinding('a.ts', 10, 15, 'linter', 'ESLint')];

    const merged = deduplicateFindings(ai, linter);
    // Lines 5-9 and 10-15: line 10 touches line 9's end+1, but overlap check is <=
    // Actually: aStart(5) <= bEnd(15) && bStart(10) <= aEnd(9) → 10 <= 9 is FALSE
    // So they should NOT merge
    expect(merged).toHaveLength(2);
  });

  it('handles multiple AI findings with one linter finding', () => {
    const ai = [makeFinding('a.ts', 5, 10, 'ai'), makeFinding('a.ts', 20, 25, 'ai')];
    const linter = [makeFinding('a.ts', 8, 8, 'linter', 'ESLint')];

    const merged = deduplicateFindings(ai, linter);
    expect(merged).toHaveLength(2);
    expect(merged[0].source).toBe('both'); // first AI finding merged
    expect(merged[1].source).toBe('ai'); // second AI finding unchanged
  });

  it('handles one AI finding matching multiple linter findings', () => {
    const ai = [makeFinding('a.ts', 5, 20, 'ai')];
    const linter = [
      makeFinding('a.ts', 8, 8, 'linter', 'ESLint'),
      makeFinding('a.ts', 15, 15, 'linter', 'Ruff'),
    ];

    const merged = deduplicateFindings(ai, linter);
    // First linter merges with AI, second linter also finds AI as match
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('both');
  });

  it('preserves AI finding data when merging (title, explanation, etc.)', () => {
    const ai: ReviewFinding[] = [
      {
        id: 'ai-123',
        category: 'bug',
        severity: 'severe',
        file: 'a.ts',
        startLine: 5,
        endLine: 10,
        title: 'AI Title',
        explanation: 'AI Explanation',
        suggestedFix: 'fix code',
        source: 'ai',
        citations: [{ file: 'a.ts', startLine: 5, endLine: 10 }],
      },
    ];
    const linter = [makeFinding('a.ts', 7, 7, 'linter', 'Semgrep')];

    const merged = deduplicateFindings(ai, linter);
    expect(merged[0].title).toBe('AI Title');
    expect(merged[0].explanation).toBe('AI Explanation');
    expect(merged[0].suggestedFix).toBe('fix code');
    expect(merged[0].severity).toBe('severe');
    expect(merged[0].source).toBe('both');
    expect(merged[0].linterName).toBe('Semgrep');
  });
});
