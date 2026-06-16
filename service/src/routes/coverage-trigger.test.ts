import { describe, expect, it, vi } from 'vitest';

import type { ServiceConfig } from '../config.js';
import type { GitHubAuth } from '../github/auth.js';
import type { CoverageAnalysisJob } from '../jobs/types.js';

import { handleCoverageTrigger } from './coverage-trigger.js';

function baseCfg(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    coverageServiceEnabled: true,
    coverageServiceUrl: 'http://coverage.local',
    coverageServiceApiKey: '',
    coverageServicePollIntervalMs: 1,
    coverageServicePollTimeoutMs: 1,
    coverageServiceBranchPrefix: 'openreview/tests',
    coverageServiceDefaultBranch: 'main',
    coverageServiceCoverageCommand: '',
    coverageServiceTestCommand: '',
    coverageServiceInstallCommand: '',
    ...overrides,
  } as unknown as ServiceConfig;
}

const silentLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => silentLogger,
} as unknown as Parameters<typeof handleCoverageTrigger>[1]['logger'];

const fakeAuth: GitHubAuth = {
  async getTokenFor() {
    return 'ghp_fake_token';
  },
};

const fakeRun = {
  id: 'run-1',
  repository: 'NiharDoshi99/sample-javascript',
  prNumber: 1,
  status: 'COMPLETED' as const,
  fileCoverage: [],
  generatedTestFiles: [],
};

const fakePr = {
  number: 1,
  title: 'feat: support stdio',
  body: '',
  state: 'open' as const,
  draft: false,
  user: { login: 'NiharDoshi99' },
  head: { sha: 'aaa111', ref: 'feat/support-stdio' },
  base: { sha: 'bbb222', ref: 'main' },
};

describe('handleCoverageTrigger', () => {
  it('returns 503 when COVERAGE_SERVICE_ENABLED is false', async () => {
    const out = await handleCoverageTrigger(
      { prRunId: 'r1' },
      {
        cfg: baseCfg({ coverageServiceEnabled: false }),
        logger: silentLogger,
        queue: { enqueue: vi.fn() },
        auth: fakeAuth,
      },
    );
    expect(out.status).toBe(503);
  });

  it('returns 400 when prRunId is missing', async () => {
    const out = await handleCoverageTrigger(
      {},
      {
        cfg: baseCfg(),
        logger: silentLogger,
        queue: { enqueue: vi.fn() },
        auth: fakeAuth,
      },
    );
    expect(out.status).toBe(400);
    expect((out.body.issues as unknown[]).length).toBeGreaterThan(0);
  });

  it('returns 404 when the coverage service has no such run', async () => {
    const out = await handleCoverageTrigger(
      { prRunId: 'missing' },
      {
        cfg: baseCfg(),
        logger: silentLogger,
        queue: { enqueue: vi.fn() },
        auth: fakeAuth,
        coverageClientFactory: () => ({
          getPrRun: async () => {
            const err: Error & { response?: { status: number } } = new Error(
              'Not found',
            );
            err.response = { status: 404 };
            throw err;
          },
        }),
      },
    );
    expect(out.status).toBe(404);
  });

  it('enqueues a coverage-analysis job with prRunId pre-populated', async () => {
    const enqueue = vi.fn().mockResolvedValue(true);
    const getPR = vi.fn().mockResolvedValue(fakePr);

    const out = await handleCoverageTrigger(
      { prRunId: 'run-1' },
      {
        cfg: baseCfg(),
        logger: silentLogger,
        queue: { enqueue },
        auth: fakeAuth,
        coverageClientFactory: () => ({ getPrRun: async () => fakeRun }),
        githubClientFactory: () => ({ getPR }),
      },
    );

    expect(out.status).toBe(202);
    expect(out.body.status).toBe('accepted');
    expect(getPR).toHaveBeenCalledWith(1);
    expect(enqueue).toHaveBeenCalledTimes(1);

    const job = enqueue.mock.calls[0][0] as CoverageAnalysisJob;
    expect(job.kind).toBe('coverage-analysis');
    expect(job.prRunId).toBe('run-1');
    expect(job.owner).toBe('NiharDoshi99');
    expect(job.repo).toBe('sample-javascript');
    expect(job.prNumber).toBe(1);
    expect(job.headSha).toBe('aaa111');
    expect(job.headRef).toBe('feat/support-stdio');
    expect(job.baseSha).toBe('bbb222');
    expect(job.baseRef).toBe('main');
    expect(job.title).toBe('feat: support stdio');
    expect(job.deliveryId.startsWith('manual-')).toBe(true);
  });

  it('reports duplicate when the same head SHA is already in flight', async () => {
    const enqueue = vi.fn().mockResolvedValue(false);
    const out = await handleCoverageTrigger(
      { prRunId: 'run-1' },
      {
        cfg: baseCfg(),
        logger: silentLogger,
        queue: { enqueue },
        auth: fakeAuth,
        coverageClientFactory: () => ({ getPrRun: async () => fakeRun }),
        githubClientFactory: () => ({ getPR: async () => fakePr }),
      },
    );

    expect(out.status).toBe(202);
    expect(out.body.status).toBe('duplicate');
  });

  it('returns 422 when the coverage service returns a malformed repository field', async () => {
    const out = await handleCoverageTrigger(
      { prRunId: 'run-1' },
      {
        cfg: baseCfg(),
        logger: silentLogger,
        queue: { enqueue: vi.fn() },
        auth: fakeAuth,
        coverageClientFactory: () => ({
          getPrRun: async () => ({ ...fakeRun, repository: 'malformed' }),
        }),
        githubClientFactory: () => ({ getPR: async () => fakePr }),
      },
    );
    expect(out.status).toBe(422);
  });

  it('returns 404 when the PR cannot be found on GitHub', async () => {
    const out = await handleCoverageTrigger(
      { prRunId: 'run-1' },
      {
        cfg: baseCfg(),
        logger: silentLogger,
        queue: { enqueue: vi.fn() },
        auth: fakeAuth,
        coverageClientFactory: () => ({ getPrRun: async () => fakeRun }),
        githubClientFactory: () => ({
          getPR: async () => {
            const err: Error & { response?: { status: number } } = new Error(
              'Not Found',
            );
            err.response = { status: 404 };
            throw err;
          },
        }),
      },
    );
    expect(out.status).toBe(404);
  });
});
