import { createHash } from 'node:crypto';

import { filterReviewableFiles } from './reviewable-files.js';

/**
 * Stable SHA-256 fingerprint for a PR's reviewable patch.
 * Same diff on different PR numbers/commits yields the same hash.
 */
export function fingerprintPullRequestDiff(diff: string, files: string[]): string {
  const reviewableFiles = filterReviewableFiles(files);
  const filteredDiff = extractDiffForFiles(diff, reviewableFiles);
  const normalized = normalizeDiffForFingerprint(filteredDiff);
  const payload = `${reviewableFiles.join('\n')}\n---\n${normalized}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function extractDiffForFiles(rawDiff: string, files: string[]): string {
  if (files.length === 0) return '';

  const want = new Set(files);
  const parts = rawDiff.split(/^(?=diff --git )/m);
  const kept: string[] = [];

  for (const part of parts) {
    if (!part.trim()) continue;
    const match = /^diff --git a\/(.+?) b\/(.+?)$/m.exec(part);
    if (match && want.has(match[2])) {
      kept.push(part);
    }
  }

  return kept.join('');
}

/** Normalize diff text so equivalent patches fingerprint the same. */
export function normalizeDiffForFingerprint(diff: string): string {
  return diff
    .replace(/\r\n/g, '\n')
    .replace(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/gm, '@@')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}
