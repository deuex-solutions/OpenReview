import { describe, expect, it } from 'vitest';

import { detectMovesAndCopies, filterDiffs, parseDiff } from '../../../core/src/github/diff.js';

/* ------------------------------------------------------------------ */
/*  parseDiff                                                          */
/* ------------------------------------------------------------------ */

describe('parseDiff', () => {
  it('parses a standard unified diff with one modified file', () => {
    const raw = `diff --git a/src/index.ts b/src/index.ts
index abc1234..def5678 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
-const bar = 1;
+const bar = 2;
+const baz = 3;
 export { foo };`;

    const diffs = parseDiff(raw);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].file).toBe('src/index.ts');
    expect(diffs[0].status).toBe('modified');
    expect(diffs[0].hunks).toHaveLength(1);
    expect(diffs[0].addedLines).toHaveLength(2);
    expect(diffs[0].deletedLines).toHaveLength(1);
    expect(diffs[0].deletedLines[0].content).toBe('const bar = 1;');
    expect(diffs[0].addedLines[0].content).toBe('const bar = 2;');
  });

  it('parses a new file', () => {
    const raw = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const hello = 'world';
+export const num = 42;`;

    const diffs = parseDiff(raw);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('added');
    expect(diffs[0].addedLines).toHaveLength(2);
  });

  it('parses a deleted file', () => {
    const raw = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index abc1234..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const hello = 'world';
-export const num = 42;`;

    const diffs = parseDiff(raw);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('deleted');
    expect(diffs[0].deletedLines).toHaveLength(2);
  });

  it('parses a renamed file', () => {
    const raw = `diff --git a/src/old.ts b/src/new.ts
similarity index 95%
rename from src/old.ts
rename to src/new.ts
index abc1234..def5678 100644
--- a/src/old.ts
+++ b/src/new.ts
@@ -1,2 +1,2 @@
 export const hello = 'world';
-export const num = 42;
+export const num = 43;`;

    const diffs = parseDiff(raw);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('renamed');
    expect(diffs[0].file).toBe('src/new.ts');
    expect(diffs[0].previousFile).toBe('src/old.ts');
  });

  it('parses multiple files in a single diff', () => {
    const raw = `diff --git a/a.ts b/a.ts
index 1111..2222 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old line
+new line
diff --git a/b.ts b/b.ts
new file mode 100644
index 0000..3333
--- /dev/null
+++ b/b.ts
@@ -0,0 +1 @@
+brand new`;

    const diffs = parseDiff(raw);
    expect(diffs).toHaveLength(2);
    expect(diffs[0].file).toBe('a.ts');
    expect(diffs[1].file).toBe('b.ts');
    expect(diffs[1].status).toBe('added');
  });

  it('handles empty diff', () => {
    expect(parseDiff('')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  detectMovesAndCopies                                               */
/* ------------------------------------------------------------------ */

describe('detectMovesAndCopies', () => {
  it('detects a move when code is deleted from one file and added to another', () => {
    const diffs = parseDiff(`diff --git a/src/old.ts b/src/old.ts
index 111..222 100644
--- a/src/old.ts
+++ b/src/old.ts
@@ -1,5 +1,1 @@
-function calculateTotal(items) {
-  return items.reduce((sum, item) => sum + item.price, 0);
-}
-function formatCurrency(amount) { return '$' + amount.toFixed(2); }
-export { calculateTotal, formatCurrency };
+export {};
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 000..333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,5 @@
+function calculateTotal(items) {
+  return items.reduce((sum, item) => sum + item.price, 0);
+}
+function formatCurrency(amount) { return '$' + amount.toFixed(2); }
+export { calculateTotal, formatCurrency };`);

    const events = detectMovesAndCopies(diffs, 0.7);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe('move');
    expect(events[0].sourceFile).toBe('src/old.ts');
    expect(events[0].targetFile).toBe('src/new.ts');
    expect(events[0].similarity).toBeGreaterThan(0.7);
  });

  it('returns empty array when no moves or copies detected', () => {
    const diffs = parseDiff(`diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-const x = 1;
+const x = 2;`);

    const events = detectMovesAndCopies(diffs, 0.8);
    expect(events).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  filterDiffs                                                        */
/* ------------------------------------------------------------------ */

describe('filterDiffs', () => {
  const diffs = parseDiff(`diff --git a/src/index.ts b/src/index.ts
index 111..222 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1 @@
-a
+b
diff --git a/tests/foo.test.ts b/tests/foo.test.ts
index 111..222 100644
--- a/tests/foo.test.ts
+++ b/tests/foo.test.ts
@@ -1 +1 @@
-c
+d
diff --git a/docs/readme.md b/docs/readme.md
index 111..222 100644
--- a/docs/readme.md
+++ b/docs/readme.md
@@ -1 +1 @@
-e
+f`);

  it('filters by include globs', () => {
    const filtered = filterDiffs(diffs, ['src/**/*.ts'], []);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].file).toBe('src/index.ts');
  });

  it('filters by exclude globs', () => {
    const filtered = filterDiffs(diffs, [], ['docs/**']);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((d) => d.file)).toEqual(['src/index.ts', 'tests/foo.test.ts']);
  });

  it('applies both include and exclude together', () => {
    const filtered = filterDiffs(diffs, ['**/*.ts'], ['tests/**']);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].file).toBe('src/index.ts');
  });

  it('returns all diffs when no globs specified', () => {
    const filtered = filterDiffs(diffs, [], []);
    expect(filtered).toHaveLength(3);
  });
});
