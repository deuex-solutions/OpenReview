import { describe, expect, it } from 'vitest';

import {
  extractDiffForFiles,
  fingerprintPullRequestDiff,
  normalizeDiffForFingerprint,
} from '../../../core/src/review/diff-fingerprint.js';

const SAMPLE_DIFF = `diff --git a/src/utils/mathUtils.js b/src/utils/mathUtils.js
index 1111111..2222222 100644
--- a/src/utils/mathUtils.js
+++ b/src/utils/mathUtils.js
@@ -1,3 +1,7 @@
 export const add = (a, b) => {
   return a + b;
 };
+
+export const clamp = (val, min, max) => {
+  return Math.min(Math.max(val, min), max);
+};
`;

describe('fingerprintPullRequestDiff', () => {
  it('returns the same hash for identical diffs and files', () => {
    const files = ['src/utils/mathUtils.js'];
    const a = fingerprintPullRequestDiff(SAMPLE_DIFF, files);
    const b = fingerprintPullRequestDiff(SAMPLE_DIFF, files);
    expect(a).toBe(b);
  });

  it('returns the same hash when file list order differs', () => {
    const a = fingerprintPullRequestDiff(SAMPLE_DIFF, ['src/utils/mathUtils.js', 'src/other.js']);
    const b = fingerprintPullRequestDiff(SAMPLE_DIFF, ['src/other.js', 'src/utils/mathUtils.js']);
    expect(a).toBe(b);
  });

  it('returns different hashes for different patch content', () => {
    const other = SAMPLE_DIFF.replace('clamp', 'round');
    const a = fingerprintPullRequestDiff(SAMPLE_DIFF, ['src/utils/mathUtils.js']);
    const b = fingerprintPullRequestDiff(other, ['src/utils/mathUtils.js']);
    expect(a).not.toBe(b);
  });

  it('ignores non-reviewable files in the fingerprint', () => {
    const withLock = fingerprintPullRequestDiff(SAMPLE_DIFF, [
      'src/utils/mathUtils.js',
      'package-lock.json',
    ]);
    const withoutLock = fingerprintPullRequestDiff(SAMPLE_DIFF, ['src/utils/mathUtils.js']);
    expect(withLock).toBe(withoutLock);
  });
});

describe('normalizeDiffForFingerprint', () => {
  it('strips hunk line numbers', () => {
    const normalized = normalizeDiffForFingerprint('@@ -1,3 +1,7 @@\n+foo');
    expect(normalized).toContain('@@\n+foo');
    expect(normalized).not.toContain('+1,7');
  });
});

describe('extractDiffForFiles', () => {
  it('keeps only requested file sections', () => {
    const multi = `${SAMPLE_DIFF}\ndiff --git a/src/other.js b/src/other.js\n+++ b/src/other.js\n`;
    const extracted = extractDiffForFiles(multi, ['src/utils/mathUtils.js']);
    expect(extracted).toContain('mathUtils.js');
    expect(extracted).not.toContain('other.js');
  });
});
