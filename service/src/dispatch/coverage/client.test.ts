import type { AxiosInstance } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '../../logger.js';

import { CoverageServiceClient } from './client.js';
import type { PrRun } from './types.js';

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis() as Logger['child'],
  } as unknown as Logger;
}

function mockHttp(): AxiosInstance & {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn(),
    post: vi.fn(),
  } as unknown as AxiosInstance & {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
  };
}

function makeClient(
  http: AxiosInstance,
  overrides: Partial<{
    pollIntervalMs: number;
    pollTimeoutMs: number;
    sleep: (ms: number) => Promise<void>;
  }> = {},
): CoverageServiceClient {
  return new CoverageServiceClient({
    baseUrl: 'http://coverage.test',
    apiKey: 'k',
    pollIntervalMs: 10,
    pollTimeoutMs: 60_000,
    logger: makeLogger(),
    http,
    sleep: async () => {},
    ...overrides,
  });
}

const minimalCompletedRun: PrRun = {
  id: 'run-1',
  repository: 'kenil27/band',
  prNumber: 1,
  status: 'COMPLETED',
  fileCoverage: [],
  generatedTestFiles: [],
};

describe('CoverageServiceClient.findOrCreateRepository', () => {
  it('returns an existing repo without POSTing', async () => {
    const http = mockHttp();
    http.get.mockResolvedValueOnce({
      data: [
        { id: 'repo-1', githubRepo: 'someone/else' },
        { id: 'repo-2', githubRepo: 'kenil27/band' },
      ],
    });

    const client = makeClient(http);
    const repo = await client.findOrCreateRepository({ githubRepo: 'kenil27/band' });

    expect(repo.id).toBe('repo-2');
    expect(http.post).not.toHaveBeenCalled();
    expect(http.get).toHaveBeenCalledWith('/repositories');
  });

  it('POSTs to /repositories when the repo is not yet registered', async () => {
    const http = mockHttp();
    http.get.mockResolvedValueOnce({ data: [] });
    http.post.mockResolvedValueOnce({
      data: { id: 'new-id', githubRepo: 'kenil27/band' },
    });

    const client = makeClient(http);
    const repo = await client.findOrCreateRepository({
      githubRepo: 'kenil27/band',
      defaultBranch: 'main',
      coverageCommand: 'pnpm test --coverage',
    });

    expect(repo.id).toBe('new-id');
    expect(http.post).toHaveBeenCalledWith('/repositories', {
      githubRepo: 'kenil27/band',
      defaultBranch: 'main',
      coverageCommand: 'pnpm test --coverage',
    });
  });

  it('recovers from a unique-constraint race by re-fetching', async () => {
    const http = mockHttp();
    // first list: empty (race window)
    http.get.mockResolvedValueOnce({ data: [] });
    // POST fails with 409
    http.post.mockRejectedValueOnce(
      Object.assign(new Error('conflict'), {
        response: { status: 409, data: { message: 'unique constraint failed' } },
      }),
    );
    // second list: the racing winner is now visible
    http.get.mockResolvedValueOnce({
      data: [{ id: 'winner', githubRepo: 'kenil27/band' }],
    });

    const client = makeClient(http);
    const repo = await client.findOrCreateRepository({ githubRepo: 'kenil27/band' });
    expect(repo.id).toBe('winner');
  });
});

describe('CoverageServiceClient.triggerAnalysis', () => {
  it('POSTs to /repositories/:id/analyze with the PR number', async () => {
    const http = mockHttp();
    http.post.mockResolvedValueOnce({
      data: { prRunId: 'run-1', status: 'enqueued' },
    });

    const client = makeClient(http);
    const res = await client.triggerAnalysis('repo-2', 7);

    expect(res.prRunId).toBe('run-1');
    expect(http.post).toHaveBeenCalledWith(
      '/repositories/repo-2/analyze',
      { prNumber: 7 },
    );
  });
});

describe('CoverageServiceClient.waitForPrRun', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('resolves on first poll when status is already terminal', async () => {
    const http = mockHttp();
    http.get.mockResolvedValueOnce({ data: minimalCompletedRun });

    const client = makeClient(http);
    const run = await client.waitForPrRun('run-1');

    expect(run.status).toBe('COMPLETED');
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('polls until terminal then returns', async () => {
    const http = mockHttp();
    http.get
      .mockResolvedValueOnce({
        data: { ...minimalCompletedRun, status: 'RUNNING_COVERAGE' },
      })
      .mockResolvedValueOnce({
        data: { ...minimalCompletedRun, status: 'GENERATING_TESTS' },
      })
      .mockResolvedValueOnce({ data: minimalCompletedRun });

    const client = makeClient(http);
    const run = await client.waitForPrRun('run-1');
    expect(run.status).toBe('COMPLETED');
    expect(http.get).toHaveBeenCalledTimes(3);
  });

  it('throws when the deadline is exceeded', async () => {
    const http = mockHttp();
    http.get.mockResolvedValue({
      data: { ...minimalCompletedRun, status: 'RUNNING_COVERAGE' },
    });

    let elapsed = 0;
    const client = makeClient(http, {
      pollTimeoutMs: 100,
      sleep: async (ms) => {
        elapsed += ms;
      },
    });
    // Patch Date.now via the sleep stub so the deadline check trips.
    const realNow = Date.now;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + elapsed);

    await expect(client.waitForPrRun('run-1')).rejects.toThrow(
      /did not finish within 100ms/,
    );

    vi.restoreAllMocks();
  });
});
