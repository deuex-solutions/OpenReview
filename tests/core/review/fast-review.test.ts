import { describe, expect, it } from 'vitest';

import { extractDiffLineMap, parseLLMResponse } from '../../../core/src/review/fast-review.js';

/* ------------------------------------------------------------------ */
/*  parseLLMResponse — exhaustive                                      */
/* ------------------------------------------------------------------ */

describe('parseLLMResponse', () => {
  it('parses a valid JSON array of findings', () => {
    const response = JSON.stringify([
      {
        category: 'bug',
        severity: 'severe',
        file: 'src/auth.ts',
        startLine: 42,
        endLine: 44,
        title: 'SQL injection risk',
        explanation: 'User input is directly interpolated into the query.',
        suggestedFix: 'db.query("SELECT * FROM users WHERE id = $1", [userId])',
      },
    ]);

    const findings = parseLLMResponse(response);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('bug');
    expect(findings[0].severity).toBe('severe');
    expect(findings[0].source).toBe('ai');
    expect(findings[0].citations).toHaveLength(1);
    expect(findings[0].citations[0].file).toBe('src/auth.ts');
    expect(findings[0].citations[0].startLine).toBe(42);
    expect(findings[0].citations[0].endLine).toBe(44);
    expect(findings[0].id).toMatch(/^ai-/);
  });

  it('handles response wrapped in ```json code fences', () => {
    const response =
      '```json\n[{"category":"flag","severity":"investigate","file":"a.ts","startLine":1,"endLine":1,"title":"T","explanation":"E"}]\n```';
    const findings = parseLLMResponse(response);
    expect(findings).toHaveLength(1);
  });

  it('handles response wrapped in ``` code fences (no language)', () => {
    const response =
      '```\n[{"category":"bug","severity":"severe","file":"a.ts","startLine":1,"title":"T","explanation":"E"}]\n```';
    const findings = parseLLMResponse(response);
    expect(findings).toHaveLength(1);
  });

  it('returns empty array for totally invalid text', () => {
    expect(parseLLMResponse('I found no issues in this code.')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseLLMResponse('')).toEqual([]);
  });

  it('returns empty array for non-array JSON', () => {
    expect(parseLLMResponse('{"not": "an array"}')).toEqual([]);
  });

  it('returns empty array for JSON number', () => {
    expect(parseLLMResponse('42')).toEqual([]);
  });

  it('returns empty array for JSON string', () => {
    expect(parseLLMResponse('"hello"')).toEqual([]);
  });

  it('returns empty array for JSON null', () => {
    expect(parseLLMResponse('null')).toEqual([]);
  });

  it('skips items missing required field: file', () => {
    const response = JSON.stringify([
      { category: 'bug', severity: 'severe', startLine: 1, title: 'T', explanation: 'E' },
    ]);
    expect(parseLLMResponse(response)).toEqual([]);
  });

  it('skips items missing required field: startLine', () => {
    const response = JSON.stringify([
      { category: 'bug', severity: 'severe', file: 'a.ts', title: 'T', explanation: 'E' },
    ]);
    expect(parseLLMResponse(response)).toEqual([]);
  });

  it('skips items missing required field: title', () => {
    const response = JSON.stringify([
      { category: 'bug', severity: 'severe', file: 'a.ts', startLine: 1, explanation: 'E' },
    ]);
    expect(parseLLMResponse(response)).toEqual([]);
  });

  it('skips items missing required field: explanation', () => {
    const response = JSON.stringify([
      { category: 'bug', severity: 'severe', file: 'a.ts', startLine: 1, title: 'T' },
    ]);
    expect(parseLLMResponse(response)).toEqual([]);
  });

  it('skips invalid items but keeps valid ones', () => {
    const response = JSON.stringify([
      { bad: 'item' },
      {
        category: 'bug',
        severity: 'severe',
        file: 'a.ts',
        startLine: 1,
        title: 'Valid',
        explanation: 'Valid',
      },
      { category: 'bug' }, // missing fields
    ]);

    const findings = parseLLMResponse(response);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('Valid');
  });

  it('defaults endLine to startLine when missing', () => {
    const response = JSON.stringify([
      {
        category: 'bug',
        severity: 'non-severe',
        file: 'a.ts',
        startLine: 10,
        title: 'T',
        explanation: 'E',
      },
    ]);

    const findings = parseLLMResponse(response);
    expect(findings[0].endLine).toBe(10);
  });

  it('defaults unknown severity to investigate', () => {
    const response = JSON.stringify([
      {
        category: 'bug',
        severity: 'unknown-level',
        file: 'a.ts',
        startLine: 1,
        title: 'T',
        explanation: 'E',
      },
    ]);

    const findings = parseLLMResponse(response);
    expect(findings[0].severity).toBe('investigate');
  });

  it('defaults missing severity to investigate', () => {
    const response = JSON.stringify([
      { category: 'bug', file: 'a.ts', startLine: 1, title: 'T', explanation: 'E' },
    ]);

    const findings = parseLLMResponse(response);
    expect(findings[0].severity).toBe('investigate');
  });

  it('defaults unknown category to flag', () => {
    const response = JSON.stringify([
      {
        category: 'unknown',
        severity: 'severe',
        file: 'a.ts',
        startLine: 1,
        title: 'T',
        explanation: 'E',
      },
    ]);

    const findings = parseLLMResponse(response);
    expect(findings[0].category).toBe('flag');
  });

  it('preserves suggestedFix when present', () => {
    const response = JSON.stringify([
      {
        category: 'bug',
        severity: 'severe',
        file: 'a.ts',
        startLine: 1,
        title: 'T',
        explanation: 'E',
        suggestedFix: 'const x = 2;',
      },
    ]);

    const findings = parseLLMResponse(response);
    expect(findings[0].suggestedFix).toBe('const x = 2;');
  });

  it('suggestedFix is undefined when not present', () => {
    const response = JSON.stringify([
      {
        category: 'bug',
        severity: 'severe',
        file: 'a.ts',
        startLine: 1,
        title: 'T',
        explanation: 'E',
      },
    ]);

    const findings = parseLLMResponse(response);
    expect(findings[0].suggestedFix).toBeUndefined();
  });

  it('extracts JSON array embedded in surrounding text', () => {
    const response =
      'Here are the findings:\n[{"category":"bug","severity":"severe","file":"a.ts","startLine":1,"title":"T","explanation":"E"}]\nDone reviewing.';
    const findings = parseLLMResponse(response);
    expect(findings).toHaveLength(1);
  });

  it('handles multiline JSON response', () => {
    const response = `[
  {
    "category": "bug",
    "severity": "severe",
    "file": "a.ts",
    "startLine": 1,
    "endLine": 3,
    "title": "T",
    "explanation": "E"
  }
]`;
    const findings = parseLLMResponse(response);
    expect(findings).toHaveLength(1);
  });

  it('handles empty JSON array', () => {
    expect(parseLLMResponse('[]')).toEqual([]);
  });

  it('handles large number of findings', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      category: 'flag',
      severity: 'informational',
      file: `file${i}.ts`,
      startLine: i + 1,
      title: `Finding ${i}`,
      explanation: `Explanation ${i}`,
    }));
    const findings = parseLLMResponse(JSON.stringify(items));
    expect(findings).toHaveLength(100);
  });

  it('each finding gets a unique ID', () => {
    const response = JSON.stringify([
      {
        category: 'bug',
        severity: 'severe',
        file: 'a.ts',
        startLine: 1,
        title: 'T1',
        explanation: 'E1',
      },
      {
        category: 'bug',
        severity: 'severe',
        file: 'a.ts',
        startLine: 1,
        title: 'T2',
        explanation: 'E2',
      },
    ]);

    const findings = parseLLMResponse(response);
    expect(findings[0].id).not.toBe(findings[1].id);
  });

  it('handles startLine of 0', () => {
    // startLine of 0 is falsy — should be rejected as invalid
    const response = JSON.stringify([
      {
        category: 'bug',
        severity: 'severe',
        file: 'a.ts',
        startLine: 0,
        title: 'T',
        explanation: 'E',
      },
    ]);
    const findings = parseLLMResponse(response);
    expect(findings).toEqual([]);
  });

  it('handles all valid severities', () => {
    const severities = ['severe', 'non-severe', 'investigate', 'informational'];
    for (const sev of severities) {
      const response = JSON.stringify([
        {
          category: 'bug',
          severity: sev,
          file: 'a.ts',
          startLine: 1,
          title: 'T',
          explanation: 'E',
        },
      ]);
      const findings = parseLLMResponse(response);
      expect(findings[0].severity).toBe(sev);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  extractDiffLineMap — exhaustive                                    */
/* ------------------------------------------------------------------ */

describe('extractDiffLineMap', () => {
  it('extracts added line numbers per file', () => {
    const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -5,3 +5,4 @@ function hello() {
   console.log('hello');
+  console.log('world');
+  console.log('!');
   return true;`;

    const map = extractDiffLineMap(diff);
    expect(map.has('src/index.ts')).toBe(true);
    const lines = map.get('src/index.ts')!;
    expect(lines.has(6)).toBe(true);
    expect(lines.has(7)).toBe(true);
    expect(lines.has(5)).toBe(false); // context line
    expect(lines.has(8)).toBe(false); // context line after added
  });

  it('handles multiple files in one diff', () => {
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 line1
+added in a
 line2
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,1 +1,2 @@
 existing
+added in b`;

    const map = extractDiffLineMap(diff);
    expect(map.size).toBe(2);
    expect(map.get('a.ts')!.has(2)).toBe(true);
    expect(map.get('b.ts')!.has(2)).toBe(true);
  });

  it('returns empty map for empty diff', () => {
    const map = extractDiffLineMap('');
    expect(map.size).toBe(0);
  });

  it('handles new file (all lines added)', () => {
    const diff = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,3 @@
+line 1
+line 2
+line 3`;

    const map = extractDiffLineMap(diff);
    const lines = map.get('new.ts')!;
    expect(lines.has(1)).toBe(true);
    expect(lines.has(2)).toBe(true);
    expect(lines.has(3)).toBe(true);
    expect(lines.size).toBe(3);
  });

  it('handles deleted file (no added lines)', () => {
    const diff = `diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-line 1
-line 2`;

    const map = extractDiffLineMap(diff);
    // File should exist in map but with no added lines
    expect(map.get('old.ts')?.size ?? 0).toBe(0);
  });

  it('skips --- and +++ lines (file markers)', () => {
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 existing
+new line`;

    const map = extractDiffLineMap(diff);
    // Should not have spurious entries from --- or +++ lines
    const lines = map.get('a.ts')!;
    expect(lines.size).toBe(1);
    expect(lines.has(2)).toBe(true);
  });

  it('handles multiple hunks in one file', () => {
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,4 @@
 line1
+added-at-2
 line3
 line4
@@ -10,3 +11,4 @@
 line10
+added-at-12
 line12
 line13`;

    const map = extractDiffLineMap(diff);
    const lines = map.get('a.ts')!;
    expect(lines.has(2)).toBe(true);
    expect(lines.has(12)).toBe(true);
    expect(lines.has(1)).toBe(false);
    expect(lines.has(11)).toBe(false);
  });

  it('does not count deleted lines as added', () => {
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,2 @@
 line1
-removed line
 line3`;

    const map = extractDiffLineMap(diff);
    const lines = map.get('a.ts')!;
    expect(lines.size).toBe(0); // no added lines
  });

  it('correctly tracks line numbers with mixed add/delete/context', () => {
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,5 +1,5 @@
 line1
-old2
+new2
 line3
-old4
+new4
 line5`;

    const map = extractDiffLineMap(diff);
    const lines = map.get('a.ts')!;
    expect(lines.has(2)).toBe(true); // new2
    expect(lines.has(4)).toBe(true); // new4
    expect(lines.size).toBe(2);
  });

  it('handles diff with no hunks (binary file, etc.)', () => {
    const diff = `diff --git a/image.png b/image.png
Binary files differ`;

    const map = extractDiffLineMap(diff);
    expect(map.get('image.png')?.size ?? 0).toBe(0);
  });

  it('handles hunk header with extra context text', () => {
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -10,3 +10,4 @@ function existingFunction() {
 context line
+added line
 more context
 end`;

    const map = extractDiffLineMap(diff);
    expect(map.get('a.ts')!.has(11)).toBe(true);
  });
});
