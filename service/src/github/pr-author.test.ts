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

    // refExists: branch lookup returns 404
    api.get.mockImplementationOnce(async (url: string) => {
      expect(url).toBe('/repos/kenil27/band/git/ref/heads/openreview/tests/pr-1');
      const err = Object.assign(new Error('not found'), {
        response: { status: 404 },
      });
      throw err;
    });

    // baseSha tree resolution
    api.get.mockImplementationOnce(async (url: string) => {
      expect(url).toBe('/repos/kenil27/band/git/commits/sha-base');
      return { data: { tree: { sha: 'tree-base' } } };
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

    // Check commit parents on the feature tip for a brand-new branch
    const commitCall = api.post.mock.calls[2];
    expect(commitCall[0]).toBe('/repos/kenil27/band/git/commits');
    expect(commitCall[1]).toEqual(
      expect.objectContaining({
        message: 'test: add a',
        parents: ['sha-base'],
      }),
    );

    // Check ref creation used the fully qualified ref string and POST (not PATCH)
    const refCall = api.post.mock.calls[3];
    expect(refCall[0]).toBe('/repos/kenil27/band/git/refs');
    expect(refCall[1]).toEqual({
      ref: 'refs/heads/openreview/tests/pr-1',
      sha: 'commit-new',
    });
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('appends a commit when the feature branch has not advanced', async () => {
    const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };

    api.get
      .mockResolvedValueOnce({ data: { object: { sha: 'tip-old' } } }) // refExists
      .mockResolvedValueOnce({ data: { object: { sha: 'tip-old' } } }) // getRefSha
      .mockResolvedValueOnce({
        data: { merge_base_commit: { sha: 'sha-base' } },
      }) // isAncestor
      .mockResolvedValueOnce({ data: { tree: { sha: 'tree-head' } } }); // headSha tree

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

    const treeCall = api.post.mock.calls[1];
    expect(treeCall[1]).toEqual({
      base_tree: 'tree-head',
      tree: [
        {
          path: 'tests/a.test.ts',
          mode: '100644',
          type: 'blob',
          sha: 'blob-1',
        },
      ],
    });

    const commitCall = api.post.mock.calls[2];
    expect(commitCall[1]).toEqual(
      expect.objectContaining({
        parents: ['tip-old'],
      }),
    );

    expect(api.patch).toHaveBeenCalledWith(
      '/repos/kenil27/band/git/refs/heads/openreview/tests/pr-42',
      { sha: 'commit-1' },
    );
    expect(api.patch.mock.calls[0][1]).not.toHaveProperty('force');
  });

  it('creates a merge commit when the feature branch has advanced', async () => {
    const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };

    api.get
      .mockResolvedValueOnce({ data: { object: { sha: 'tip-old' } } }) // refExists
      .mockResolvedValueOnce({ data: { object: { sha: 'tip-old' } } }) // getRefSha
      .mockResolvedValueOnce({
        data: { merge_base_commit: { sha: 'merge-old' } },
      }) // isAncestor — feature tip is NOT merged
      .mockResolvedValueOnce({ data: { tree: { sha: 'tree-head' } } }); // headSha tree

    api.post
      .mockResolvedValueOnce({ data: { sha: 'blob-1' } })
      .mockResolvedValueOnce({ data: { sha: 'tree-1' } })
      .mockResolvedValueOnce({ data: { sha: 'commit-1' } });

    api.patch.mockResolvedValueOnce({ data: {} });

    const author = new PRAuthor(makeClient(api));
    await author.commitFiles({
      branch: 'openreview/tests/pr-42',
      baseSha: 'sha-head',
      files: [{ path: 'tests/a.test.ts', content: 'noop' }],
      commitMessage: 'msg',
    });

    const commitCall = api.post.mock.calls[2];
    expect(commitCall[1]).toEqual(
      expect.objectContaining({
        parents: ['tip-old', 'sha-head'],
      }),
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
      updated: false,
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

  it('PATCHes title and body on an existing open PR', async () => {
    const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
    api.get.mockResolvedValueOnce({
      data: [{ number: 7, html_url: 'https://github.com/kenil27/band/pull/7' }],
    });
    api.patch.mockResolvedValueOnce({ data: {} });

    const author = new PRAuthor(makeClient(api));
    const res = await author.openOrUpdatePR({
      base: 'feature/foo',
      head: 'openreview/tests/pr-1',
      title: 'updated title',
      body: 'updated body',
    });

    expect(res).toEqual({
      url: 'https://github.com/kenil27/band/pull/7',
      number: 7,
      created: false,
      updated: true,
    });
    expect(api.patch).toHaveBeenCalledWith('/repos/kenil27/band/pulls/7', {
      title: 'updated title',
      body: 'updated body',
    });
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('PRAuthor.branchExists', () => {
  it('returns true when the branch ref is present', async () => {
    const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
    api.get.mockResolvedValueOnce({ data: { ref: 'refs/heads/openreview/tests/pr-1' } });

    const author = new PRAuthor(makeClient(api));
    await expect(author.branchExists('openreview/tests/pr-1')).resolves.toBe(true);
    expect(api.get).toHaveBeenCalledWith(
      '/repos/kenil27/band/git/ref/heads/openreview/tests/pr-1',
    );
  });

  it('returns false when the branch ref is missing', async () => {
    const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
    api.get.mockRejectedValueOnce(
      Object.assign(new Error('not found'), { response: { status: 404 } }),
    );

    const author = new PRAuthor(makeClient(api));
    await expect(author.branchExists('openreview/tests/pr-99')).resolves.toBe(false);
  });
});
