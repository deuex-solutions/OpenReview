import type { AxiosInstance } from 'axios';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubClient, parsePRUrl } from '../../../core/src/github/client.js';

/* ------------------------------------------------------------------ */
/*  PR URL parsing                                                     */
/* ------------------------------------------------------------------ */

describe('parsePRUrl', () => {
  it('parses a standard GitHub PR URL', () => {
    const result = parsePRUrl('https://github.com/acme/widget/pull/42');
    expect(result).toEqual({ owner: 'acme', repo: 'widget', prNumber: 42 });
  });

  it('parses a URL with trailing path segments', () => {
    const result = parsePRUrl('https://github.com/org/repo/pull/123/files');
    expect(result).toEqual({ owner: 'org', repo: 'repo', prNumber: 123 });
  });

  it('throws on an invalid URL', () => {
    expect(() => parsePRUrl('https://github.com/acme/widget/issues/42')).toThrow(
      'Invalid GitHub PR URL',
    );
  });

  it('throws on a non-GitHub URL', () => {
    expect(() => parsePRUrl('https://example.com/pull/1')).toThrow('Invalid GitHub PR URL');
  });
});

/* ------------------------------------------------------------------ */
/*  GitHubClient with mocked axios                                     */
/* ------------------------------------------------------------------ */

describe('GitHubClient', () => {
  let client: GitHubClient;
  let mockApi: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockApi = { get: vi.fn(), post: vi.fn() };

    // Spy on axios.create to return our mock
    vi.spyOn(axios, 'create').mockReturnValue({
      ...mockApi,
      interceptors: {
        response: { use: vi.fn() },
        request: { use: vi.fn() },
      },
    } as unknown as AxiosInstance);

    client = new GitHubClient({ token: 'test-token', owner: 'acme', repo: 'widget' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getPR', () => {
    it('returns normalized PR metadata', async () => {
      mockApi.get.mockResolvedValue({
        data: {
          number: 42,
          title: 'Fix bug',
          body: 'Details here',
          state: 'open',
          draft: false,
          head: { sha: 'abc', ref: 'fix-bug' },
          base: { sha: 'def', ref: 'main' },
          user: { login: 'alice' },
        },
      });

      const pr = await client.getPR(42);
      expect(pr.number).toBe(42);
      expect(pr.title).toBe('Fix bug');
      expect(pr.head.ref).toBe('fix-bug');
      expect(pr.user.login).toBe('alice');
      expect(mockApi.get).toHaveBeenCalledWith('/repos/acme/widget/pulls/42');
    });
  });

  describe('getPRFiles', () => {
    it('paginates until a page has fewer than 100 items', async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => ({
        filename: `file${i}.ts`,
        status: 'modified',
        additions: 1,
        deletions: 0,
        changes: 1,
      }));
      const page2 = [
        {
          filename: 'last.ts',
          status: 'added',
          additions: 10,
          deletions: 0,
          changes: 10,
        },
      ];

      mockApi.get.mockResolvedValueOnce({ data: page1 }).mockResolvedValueOnce({ data: page2 });

      const files = await client.getPRFiles(1);
      expect(files).toHaveLength(101);
      expect(mockApi.get).toHaveBeenCalledTimes(2);
      expect(mockApi.get).toHaveBeenCalledWith('/repos/acme/widget/pulls/1/files', {
        params: { per_page: 100, page: 1 },
      });
      expect(mockApi.get).toHaveBeenCalledWith('/repos/acme/widget/pulls/1/files', {
        params: { per_page: 100, page: 2 },
      });
    });

    it('returns empty array when PR has no files', async () => {
      mockApi.get.mockResolvedValue({ data: [] });
      const files = await client.getPRFiles(1);
      expect(files).toHaveLength(0);
    });
  });

  describe('getPRDiff', () => {
    it('requests raw diff format', async () => {
      mockApi.get.mockResolvedValue({ data: 'diff --git a/f b/f\n...' });
      const diff = await client.getPRDiff(5);
      expect(diff).toContain('diff --git');
      expect(mockApi.get).toHaveBeenCalledWith('/repos/acme/widget/pulls/5', {
        headers: { Accept: 'application/vnd.github.v3.diff' },
      });
    });
  });

  describe('getFileContent', () => {
    it('fetches raw file content at a ref', async () => {
      mockApi.get.mockResolvedValue({ data: 'const x = 1;' });
      const content = await client.getFileContent('src/index.ts', 'abc123');
      expect(content).toBe('const x = 1;');
      expect(mockApi.get).toHaveBeenCalledWith('/repos/acme/widget/contents/src/index.ts', {
        params: { ref: 'abc123' },
        headers: { Accept: 'application/vnd.github.v3.raw' },
      });
    });
  });

  describe('getIssueComments', () => {
    it('returns normalized comments filtering out deleted users', async () => {
      mockApi.get.mockResolvedValue({
        data: [
          { id: 1, user: { login: 'alice' }, body: 'Looks good' },
          { id: 2, user: null, body: 'Ghost comment' },
          { id: 3, user: { login: 'bob' }, body: null },
        ],
      });

      const comments = await client.getIssueComments(42);
      // Should filter out the null-user comment
      expect(comments).toHaveLength(2);
      expect(comments[0]).toEqual({ id: 1, user: { login: 'alice' }, body: 'Looks good' });
      // Should normalize null body to empty string
      expect(comments[1]).toEqual({ id: 3, user: { login: 'bob' }, body: '' });
      expect(mockApi.get).toHaveBeenCalledWith('/repos/acme/widget/issues/42/comments', {
        params: { per_page: 50 },
      });
    });

    it('passes custom perPage parameter', async () => {
      mockApi.get.mockResolvedValue({ data: [] });
      await client.getIssueComments(10, 25);
      expect(mockApi.get).toHaveBeenCalledWith('/repos/acme/widget/issues/10/comments', {
        params: { per_page: 25 },
      });
    });
  });

  describe('getFileTree', () => {
    it('returns blob paths from recursive tree', async () => {
      mockApi.get.mockResolvedValue({
        data: {
          tree: [
            { path: 'src', type: 'tree' },
            { path: 'src/index.ts', type: 'blob' },
            { path: 'src/utils.ts', type: 'blob' },
          ],
        },
      });
      const paths = await client.getFileTree('main');
      expect(paths).toEqual(['src/index.ts', 'src/utils.ts']);
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Auth scheme detection                                              */
/* ------------------------------------------------------------------ */

describe('Auth scheme detection', () => {
  it('uses token scheme for classic PATs (ghp_)', () => {
    const spy = vi.spyOn(axios, 'create').mockReturnValue({
      interceptors: { response: { use: vi.fn() }, request: { use: vi.fn() } },
    } as unknown as AxiosInstance);

    new GitHubClient({ token: 'ghp_abc123', owner: 'o', repo: 'r' });

    const callArgs = spy.mock.calls[0][0];
    expect(callArgs?.headers?.Authorization).toBe('token ghp_abc123');

    vi.restoreAllMocks();
  });

  it('uses Bearer scheme for fine-grained PATs (github_pat_)', () => {
    const spy = vi.spyOn(axios, 'create').mockReturnValue({
      interceptors: { response: { use: vi.fn() }, request: { use: vi.fn() } },
    } as unknown as AxiosInstance);

    new GitHubClient({ token: 'github_pat_abc123', owner: 'o', repo: 'r' });

    const callArgs = spy.mock.calls[0][0];
    expect(callArgs?.headers?.Authorization).toBe('Bearer github_pat_abc123');

    vi.restoreAllMocks();
  });

  it('uses Bearer scheme for OAuth tokens (gho_)', () => {
    const spy = vi.spyOn(axios, 'create').mockReturnValue({
      interceptors: { response: { use: vi.fn() }, request: { use: vi.fn() } },
    } as unknown as AxiosInstance);

    new GitHubClient({ token: 'gho_abc123', owner: 'o', repo: 'r' });

    const callArgs = spy.mock.calls[0][0];
    expect(callArgs?.headers?.Authorization).toBe('Bearer gho_abc123');

    vi.restoreAllMocks();
  });
});

/* ------------------------------------------------------------------ */
/*  Rate limit detection                                               */
/* ------------------------------------------------------------------ */

describe('Rate limit interceptor', () => {
  it('client is constructed with interceptors attached', () => {
    const createSpy = vi.spyOn(axios, 'create').mockReturnValue({
      interceptors: {
        response: { use: vi.fn() },
        request: { use: vi.fn() },
      },
    } as unknown as AxiosInstance);

    new GitHubClient({ token: 'tok', owner: 'o', repo: 'r' });

    const mockInstance = createSpy.mock.results[0].value as AxiosInstance;
    // Three interceptors should be registered (auth error + rate limit + retry)
    expect(mockInstance.interceptors.response.use).toHaveBeenCalledTimes(3);

    vi.restoreAllMocks();
  });
});

/* ------------------------------------------------------------------ */
/*  Static factory methods                                             */
/* ------------------------------------------------------------------ */

describe('Factory methods', () => {
  it('fromPRUrl creates client from a valid PR URL', () => {
    const { client, prNumber } = GitHubClient.fromPRUrl(
      'https://github.com/acme/widget/pull/42',
      'test-token',
    );
    expect(client.owner).toBe('acme');
    expect(client.repo).toBe('widget');
    expect(prNumber).toBe(42);
  });

  it('fromPRUrl throws on invalid URL', () => {
    expect(() => GitHubClient.fromPRUrl('https://github.com/bad', 'tok')).toThrow(
      'Invalid GitHub PR URL',
    );
  });
});
