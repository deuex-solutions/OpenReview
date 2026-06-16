import type { GitHubClient } from '@openreview/core';
import type { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { PRAuthor } from './pr-author.js';

function makeClient(api: Partial<AxiosInstance>) {
  return {
    owner: 'kenil27',
    repo: 'band',
    api: api as AxiosInstance,
  } as unknown as GitHubClient;
}

describe('PRAuthor.commitFiles', () => {
  it('returns null for an empty file list (no API calls)', async () => {
    const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
    const author = new PRAuthor(makeClient(api));

    const result = await author.commitFiles({
      branch: 'feature/x',
      baseSha: 'sha-base',
      files: [],
      commitMessage: 'noop',
    });

    expect(result).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('creates blob -> tree -> commit -> branch ref for a fresh branch', async () => {
    const api = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
    };

    // 1. baseSha tree resolution
    api.get.mockImplementationOnce(async (url: string) => {
      expect(url).toBe('/repos/kenil27/band/git/commits/sha-base');
      return { data: { tree: { sha: 'tree-base' } } };
    });

    // refExists: branch lookup returns 404
    api.get.mockImplementationOnce(async (url: string) => {
      expect(url).toBe('/repos/kenil27/band/git/ref/heads/openreview/tests/pr-1');
      const err = Object.assign(new Error('not found'), {
        response: { status: 404 },
      });
      throw err;
    });

    api.post
      .mockResolvedValueOnce({ data: { sha: 'blob-a' } }) // create blob
      .mockResolvedValueOnce({ data: { sha: 'tree-new' } }) // create tree
      .mockResolvedValueOnce({ data: { sha: 'commit-new' } }) // create commit
      .mockResolvedValueOnce({ data: {} }); // create ref

    const author = new PRAuthor(makeClient(api));

    const result = await author.commitFiles({
      branch: 'openreview/tests/pr-1',
      baseSha: 'sha-base',
      files: [{ path: 'tests/a.test.ts', content: 'test("x", () => {});' }],
      commitMessage: 'test: add a',
    });

    expect(result).toEqual({
      branchRef: 'refs/heads/openreview/tests/pr-1',
      commitSha: 'commit-new',
    });

    // Check create-tree call carried base_tree and entry shape
    const treeCall = api.post.mock.calls[1];
    expect(treeCall[0]).toBe('/repos/kenil27/band/git/trees');
    expect(treeCall[1]).toEqual({
      base_tree: 'tree-base',
      tree: [
        {
          path: 'tests/a.test.ts',
          mode: '100644',
          type: 'blob',
          sha: 'blob-a',
        },
      ],
    });

    // Check ref creation used the fully qualified ref string and POST (not PATCH)
    const refCall = api.post.mock.calls[3];
    expect(refCall[0]).toBe('/repos/kenil27/band/git/refs');
    expect(refCall[1]).toEqual({
      ref: 'refs/heads/openreview/tests/pr-1',
      sha: 'commit-new',
    });
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('force-updates an existing branch with PATCH', async () => {
    const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };

    api.get
      .mockResolvedValueOnce({ data: { tree: { sha: 'tree-base' } } })
      .mockResolvedValueOnce({ data: { ref: 'refs/heads/x' } }); // ref exists

    api.post
      .mockResolvedValueOnce({ data: { sha: 'blob-1' } })
      .mockResolvedValueOnce({ data: { sha: 'tree-1' } })
      .mockResolvedValueOnce({ data: { sha: 'commit-1' } });

    api.patch.mockResolvedValueOnce({ data: {} });

    const author = new PRAuthor(makeClient(api));
    await author.commitFiles({
      branch: 'openreview/tests/pr-42',
      baseSha: 'sha-base',
      files: [{ path: 'tests/a.test.ts', content: 'noop' }],
      commitMessage: 'msg',
    });

    expect(api.patch).toHaveBeenCalledWith(
      '/repos/kenil27/band/git/refs/heads/openreview/tests/pr-42',
      { sha: 'commit-1', force: true },
    );
  });
});

describe('PRAuthor.openOrUpdatePR', () => {
  it('creates a new PR when none is open', async () => {
    const api = { get: vi.fn(), post: vi.fn() };
    api.get.mockResolvedValueOnce({ data: [] });
    api.post.mockResolvedValueOnce({
      data: { number: 99, html_url: 'https://github.com/kenil27/band/pull/99' },
    });

    const author = new PRAuthor(makeClient(api));
    const res = await author.openOrUpdatePR({
      base: 'feature/foo',
      head: 'openreview/tests/pr-1',
      title: 't',
      body: 'b',
    });

    expect(res).toEqual({
      url: 'https://github.com/kenil27/band/pull/99',
      number: 99,
      created: true,
    });

    expect(api.get).toHaveBeenCalledWith(
      '/repos/kenil27/band/pulls',
      expect.objectContaining({
        params: expect.objectContaining({
          head: 'kenil27:openreview/tests/pr-1',
          base: 'feature/foo',
          state: 'open',
        }),
      }),
    );
    expect(api.post).toHaveBeenCalledWith(
      '/repos/kenil27/band/pulls',
      expect.objectContaining({
        title: 't',
        head: 'openreview/tests/pr-1',
        base: 'feature/foo',
        body: 'b',
        maintainer_can_modify: true,
      }),
    );
  });

  it('returns the existing PR without creating a new one', async () => {
    const api = { get: vi.fn(), post: vi.fn() };
    api.get.mockResolvedValueOnce({
      data: [{ number: 7, html_url: 'https://github.com/kenil27/band/pull/7' }],
    });

    const author = new PRAuthor(makeClient(api));
    const res = await author.openOrUpdatePR({
      base: 'feature/foo',
      head: 'openreview/tests/pr-1',
      title: 't',
      body: 'b',
    });

    expect(res).toEqual({
      url: 'https://github.com/kenil27/band/pull/7',
      number: 7,
      created: false,
    });
    expect(api.post).not.toHaveBeenCalled();
  });
});
