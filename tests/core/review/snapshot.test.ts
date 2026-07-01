import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitHubClient } from '../../../core/src/github/client.js';
import type { ParsedDiff } from '../../../core/src/github/diff.js';
import { SnapshotBuilder } from '../../../core/src/review/snapshot.js';

/* ------------------------------------------------------------------ */
/*  Mock config                                                        */
/* ------------------------------------------------------------------ */

vi.mock('../../../core/src/config/env.js', () => ({
  config: {
    maxFileBytes: 200_000,
    maxTotalBytes: 5_000_000,
  },
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createMockClient(files: Record<string, string> = {}, tree: string[] = []): GitHubClient {
  return {
    getFileContent: vi.fn(async (path: string) => {
      if (path in files) return files[path];
      throw new Error(`File not found: ${path}`);
    }),
    getFileTree: vi.fn(async () => tree),
  } as unknown as GitHubClient;
}

function makeDiff(filePath: string): ParsedDiff {
  return {
    file: filePath,
    status: 'modified',
    hunks: [],
    addedLines: [],
    deletedLines: [],
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('SnapshotBuilder', () => {
  let client: GitHubClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getFile', () => {
    it('fetches file from GitHub and caches the result', async () => {
      client = createMockClient({ 'src/index.ts': 'export const x = 1;' });
      const snap = new SnapshotBuilder({
        client,
        headRef: 'abc123',
        diffs: [makeDiff('src/index.ts')],
      });

      const content = await snap.getFile('src/index.ts');
      expect(content).toBe('export const x = 1;');

      // Second call should use cache, not fetch again
      const content2 = await snap.getFile('src/index.ts');
      expect(content2).toBe('export const x = 1;');
      expect(client.getFileContent).toHaveBeenCalledTimes(1);
    });

    it('fetches files not in diff when requested', async () => {
      client = createMockClient({ 'lib/utils.ts': 'export function util() {}' });
      const snap = new SnapshotBuilder({
        client,
        headRef: 'abc123',
        diffs: [],
      });

      const content = await snap.getFile('lib/utils.ts');
      expect(content).toBe('export function util() {}');
    });

    it('returns empty string for binary files', async () => {
      client = createMockClient({ 'image.png': 'PNG\0binary\0data' });
      const snap = new SnapshotBuilder({
        client,
        headRef: 'abc123',
        diffs: [],
      });

      const content = await snap.getFile('image.png');
      expect(content).toBe('');
    });

    it('returns empty string for files exceeding per-file byte limit', async () => {
      const largeContent = 'x'.repeat(300_000); // exceeds 200KB default
      client = createMockClient({ 'big-file.ts': largeContent });
      const snap = new SnapshotBuilder({
        client,
        headRef: 'abc123',
        diffs: [],
        maxFileBytes: 200_000,
      });

      const content = await snap.getFile('big-file.ts');
      expect(content).toBe('');
    });

    it('respects total byte cap across multiple files', async () => {
      const fileA = 'a'.repeat(3_000_000);
      const fileB = 'b'.repeat(3_000_000);
      client = createMockClient({
        'a.ts': fileA,
        'b.ts': fileB,
      });
      const snap = new SnapshotBuilder({
        client,
        headRef: 'abc123',
        diffs: [],
        maxFileBytes: 5_000_000,
        maxTotalBytes: 5_000_000,
      });

      const contentA = await snap.getFile('a.ts');
      expect(contentA).toBe(fileA);

      // Second file should be rejected — would exceed total cap
      const contentB = await snap.getFile('b.ts');
      expect(contentB).toBe('');
    });

    it('returns empty string when file fetch fails', async () => {
      client = createMockClient({}); // no files available
      const snap = new SnapshotBuilder({
        client,
        headRef: 'abc123',
        diffs: [],
      });

      const content = await snap.getFile('nonexistent.ts');
      expect(content).toBe('');
    });
  });

  describe('listFiles', () => {
    it('fetches file tree from GitHub on first call', async () => {
      const tree = ['src/a.ts', 'src/b.ts', 'README.md'];
      client = createMockClient({}, tree);
      const snap = new SnapshotBuilder({
        client,
        headRef: 'abc123',
        diffs: [],
      });

      const files = await snap.listFiles();
      expect(files).toEqual(tree);
      expect(client.getFileTree).toHaveBeenCalledWith('abc123');
    });

    it('caches file tree after first fetch', async () => {
      client = createMockClient({}, ['a.ts']);
      const snap = new SnapshotBuilder({
        client,
        headRef: 'abc123',
        diffs: [],
      });

      await snap.listFiles();
      await snap.listFiles();
      expect(client.getFileTree).toHaveBeenCalledTimes(1);
    });

    it('returns empty array when tree fetch fails', async () => {
      client = {
        getFileContent: vi.fn(),
        getFileTree: vi.fn(async () => {
          throw new Error('API error');
        }),
      } as unknown as GitHubClient;

      const snap = new SnapshotBuilder({
        client,
        headRef: 'abc123',
        diffs: [],
      });

      const files = await snap.listFiles();
      expect(files).toEqual([]);
    });
  });

  describe('constructor', () => {
    it('pre-loads diff file paths into cache', () => {
      client = createMockClient();
      const snap = new SnapshotBuilder({
        client,
        headRef: 'abc123',
        diffs: [makeDiff('src/a.ts'), makeDiff('src/b.ts')],
      });

      const paths = snap.getCachedPaths();
      expect(paths).toContain('src/a.ts');
      expect(paths).toContain('src/b.ts');
    });
  });

  describe('getTotalBytes', () => {
    it('tracks total bytes across fetched files', async () => {
      client = createMockClient({
        'a.ts': 'hello', // 5 bytes
        'b.ts': 'world!', // 6 bytes
      });
      const snap = new SnapshotBuilder({
        client,
        headRef: 'abc123',
        diffs: [],
      });

      await snap.getFile('a.ts');
      expect(snap.getTotalBytes()).toBe(5);

      await snap.getFile('b.ts');
      expect(snap.getTotalBytes()).toBe(11);
    });
  });

  describe('concurrent access', () => {
    it('does not double-fetch when getFile is called concurrently for the same path', async () => {
      client = createMockClient({ 'src/index.ts': 'const x = 1;' });
      const snap = new SnapshotBuilder({
        client,
        headRef: 'abc123',
        diffs: [makeDiff('src/index.ts')],
      });

      // Call getFile concurrently for the same path
      const [result1, result2] = await Promise.all([
        snap.getFile('src/index.ts'),
        snap.getFile('src/index.ts'),
      ]);

      expect(result1).toBe('const x = 1;');
      expect(result2).toBe('const x = 1;');
      // Should only fetch once despite concurrent calls
      expect(client.getFileContent).toHaveBeenCalledTimes(1);
      // Should not double-count bytes
      expect(snap.getTotalBytes()).toBe(Buffer.byteLength('const x = 1;', 'utf-8'));
    });
  });
});
