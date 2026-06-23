import type { CommentPoster, GitHubClient, PRContext } from '@openreview/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServiceConfig } from '../../config.js';
import type { CoverageServiceClient } from '../../dispatch/coverage/client.js';
import type { PrRun, Repository } from '../../dispatch/coverage/types.js';
import type { GitHubAuth } from '../../github/auth.js';
import type { PRAuthor } from '../../github/pr-author.js';
import type { Logger } from '../../logger.js';
import type { CoverageAnalysisJob } from '../types.js';

import type { processCoverageAnalysis as ProcessCoverageAnalysisFn } from './coverage-analysis.js';

const buildPRRuntimeMock = vi.fn();

vi.mock('./context.js', () => ({
  buildPRRuntime: buildPRRuntimeMock,
}));

// Importing the SUT AFTER the vi.mock above is intentional.
let processCoverageAnalysis: typeof ProcessCoverageAnalysisFn;

beforeEach(async () => {
  buildPRRuntimeMock.mockReset();
  const mod = await import('./coverage-analysis.js');
  processCoverageAnalysis = mod.processCoverageAnalysis;
});

afterEach(() => {
  vi.resetModules();
});

/* -------------------------------------------------------------------- */
/*  Fixtures                                                              */
/* -------------------------------------------------------------------- */

const cfg = {
  coverageServiceUrl: 'http://coverage.test',
  coverageServiceApiKey: '',
  coverageServicePollIntervalMs: 10,
  coverageServicePollTimeoutMs: 60_000,
  coverageServiceBranchPrefix: 'openreview/tests',
  coverageServiceDefaultBranch: 'main',
  coverageServiceCoverageCommand: 'pnpm test --coverage',
  coverageServiceTestCommand: 'pnpm test',
  coverageServiceInstallCommand: '',
  coverageServiceEnabled: true,
} as unknown as ServiceConfig;

const job: CoverageAnalysisJob = {
  kind: 'coverage-analysis',
  deliveryId: 'd-1',
  owner: 'kenil27',
  repo: 'band',
  prNumber: 1,
  headSha: 'sha-head',
  baseSha: 'sha-base',
  baseRef: 'main',
  headRef: 'feature/foo',
  title: 'My PR',
};

const baseRepo: Repository = { id: 'repo-1', githubRepo: 'kenil27/band' };

const baseRun: PrRun = {
  id: 'run-1',
  repository: 'kenil27/band',
  prNumber: 1,
  status: 'COMPLETED',
  fileCoverage: [],
  generatedTestFiles: [],
};

function makeLogger(): Logger {
  const log = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => log),
  } as unknown as Logger;
  return log;
}

function makeRuntime() {
  const poster = {
    postAcknowledgement: vi.fn(async () => {}),
  } as unknown as CommentPoster;
  const client = {} as unknown as GitHubClient;
  const pr = {} as PRContext;
  buildPRRuntimeMock.mockResolvedValue({ client, poster, pr });
  return { poster, client };
}

const auth: GitHubAuth = { getTokenFor: async () => 'tok' };

/* -------------------------------------------------------------------- */
/*  Tests                                                                 */
/* -------------------------------------------------------------------- */

describe('processCoverageAnalysis', () => {
  it('happy path: register → trigger → poll → commit → comment', async () => {
    const { poster } = makeRuntime();

    const coverageClient = {
      findOrCreateRepository: vi.fn(async () => baseRepo),
      triggerAnalysis: vi.fn(async () => ({ prRunId: 'run-1', status: 'enqueued' })),
      waitForPrRun: vi.fn(
        async (): Promise<PrRun> => ({
          ...baseRun,
          diffCoverageBefore: 0,
          diffCoverageAfter: 80,
          generatedTestFiles: [
            {
              id: 't1',
              filePath: 'tests/a.test.ts',
              targetFile: 'src/a.ts',
              passed: true,
              fileContent: 'test("x", () => {});',
            },
          ],
        }),
      ),
    };

    const prAuthor = {
      branchExists: vi.fn(async () => false),
      commitFiles: vi.fn(async () => ({
        branchRef: 'refs/heads/openreview/tests/pr-1',
        commitSha: 'commit-new',
      })),
      openOrUpdatePR: vi.fn(async () => ({
        url: 'https://github.com/kenil27/band/pull/99',
        number: 99,
        created: true,
        updated: false,
      })),
    };

    const persistJobData = vi.fn(async () => {});

    await processCoverageAnalysis(job, {
      auth,
      logger: makeLogger(),
      cfg,
      persistJobData,
      coverageClientFactory: () =>
        coverageClient as unknown as Pick<
          CoverageServiceClient,
          'findOrCreateRepository' | 'triggerAnalysis' | 'waitForPrRun'
        >,
      prAuthorFactory: () =>
        prAuthor as unknown as Pick<
          PRAuthor,
          'branchExists' | 'commitFiles' | 'openOrUpdatePR'
        >,
    });

    expect(coverageClient.findOrCreateRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        githubRepo: 'kenil27/band',
        defaultBranch: 'main',
        coverageCommand: 'pnpm test --coverage',
        testCommand: 'pnpm test',
      }),
    );
    expect(coverageClient.triggerAnalysis).toHaveBeenCalledWith('repo-1', 1);
    expect(persistJobData).toHaveBeenCalledWith(
      expect.objectContaining({ prRunId: 'run-1' }),
    );
    expect(coverageClient.waitForPrRun).toHaveBeenCalledWith('run-1');
    expect(prAuthor.commitFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: 'openreview/tests/pr-1',
        baseSha: 'sha-head',
        files: [{ path: 'tests/a.test.ts', content: 'test("x", () => {});' }],
      }),
    );
    expect(prAuthor.openOrUpdatePR).toHaveBeenCalledWith(
      expect.objectContaining({
        base: 'feature/foo',
        head: 'openreview/tests/pr-1',
      }),
    );

    // 1 ack + 1 summary
    expect(poster.postAcknowledgement).toHaveBeenCalledTimes(2);
    const summary = (poster.postAcknowledgement as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1] as string;
    expect(summary).toContain('Diff coverage');
    expect(summary).toContain('https://github.com/kenil27/band/pull/99');
  });

  it('uses a refresh commit message when the stacked branch already exists', async () => {
    makeRuntime();

    const coverageClient = {
      findOrCreateRepository: vi.fn(async () => baseRepo),
      triggerAnalysis: vi.fn(async () => ({ prRunId: 'run-1', status: 'enqueued' })),
      waitForPrRun: vi.fn(
        async (): Promise<PrRun> => ({
          ...baseRun,
          generatedTestFiles: [
            {
              id: 't1',
              filePath: 'tests/a.test.ts',
              targetFile: 'src/a.ts',
              passed: true,
              fileContent: 'test("x", () => {});',
            },
          ],
        }),
      ),
    };

    const prAuthor = {
      branchExists: vi.fn(async () => true),
      commitFiles: vi.fn(async () => ({
        branchRef: 'refs/heads/openreview/tests/pr-1',
        commitSha: 'commit-refresh',
      })),
      openOrUpdatePR: vi.fn(async () => ({
        url: 'https://github.com/kenil27/band/pull/7',
        number: 7,
        created: false,
        updated: true,
      })),
    };

    await processCoverageAnalysis(job, {
      auth,
      logger: makeLogger(),
      cfg,
      coverageClientFactory: () =>
        coverageClient as unknown as Pick<
          CoverageServiceClient,
          'findOrCreateRepository' | 'triggerAnalysis' | 'waitForPrRun'
        >,
      prAuthorFactory: () =>
        prAuthor as unknown as Pick<
          PRAuthor,
          'branchExists' | 'commitFiles' | 'openOrUpdatePR'
        >,
    });

    expect(prAuthor.commitFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        commitMessage: expect.stringContaining('refresh tests for PR #1 @ sha-hea'),
      }),
    );
    expect(prAuthor.openOrUpdatePR).toHaveBeenCalled();
  });

  it('skips triggerAnalysis on retry when prRunId is already persisted', async () => {
    makeRuntime();

    const coverageClient = {
      findOrCreateRepository: vi.fn(async () => baseRepo),
      triggerAnalysis: vi.fn(),
      waitForPrRun: vi.fn(async (): Promise<PrRun> => baseRun),
    };

    await processCoverageAnalysis(
      { ...job, prRunId: 'run-existing' },
      {
        auth,
        logger: makeLogger(),
        cfg,
        coverageClientFactory: () =>
          coverageClient as unknown as Pick<
            CoverageServiceClient,
            'findOrCreateRepository' | 'triggerAnalysis' | 'waitForPrRun'
          >,
      },
    );

    expect(coverageClient.triggerAnalysis).not.toHaveBeenCalled();
    expect(coverageClient.waitForPrRun).toHaveBeenCalledWith('run-existing');
  });

  it('skips PR creation when the run completed with zero tests', async () => {
    makeRuntime();

    const coverageClient = {
      findOrCreateRepository: vi.fn(async () => baseRepo),
      triggerAnalysis: vi.fn(async () => ({ prRunId: 'run-1' })),
      waitForPrRun: vi.fn(async (): Promise<PrRun> => baseRun),
    };
    const prAuthor = { branchExists: vi.fn(), commitFiles: vi.fn(), openOrUpdatePR: vi.fn() };

    await processCoverageAnalysis(job, {
      auth,
      logger: makeLogger(),
      cfg,
      coverageClientFactory: () =>
        coverageClient as unknown as Pick<
          CoverageServiceClient,
          'findOrCreateRepository' | 'triggerAnalysis' | 'waitForPrRun'
        >,
      prAuthorFactory: () =>
        prAuthor as unknown as Pick<
          PRAuthor,
          'branchExists' | 'commitFiles' | 'openOrUpdatePR'
        >,
    });

    expect(prAuthor.commitFiles).not.toHaveBeenCalled();
    expect(prAuthor.openOrUpdatePR).not.toHaveBeenCalled();
  });

  it('does not open a stacked PR when generated tests failed validation', async () => {
    makeRuntime();

    const coverageClient = {
      findOrCreateRepository: vi.fn(async () => baseRepo),
      triggerAnalysis: vi.fn(async () => ({ prRunId: 'run-1', status: 'enqueued' })),
      waitForPrRun: vi.fn(
        async (): Promise<PrRun> => ({
          ...baseRun,
          generatedTestFiles: [
            {
              id: 't1',
              filePath: 'tests/match.service.test.ts',
              targetFile: 'src/match.service.ts',
              passed: false,
              fileContent: 'broken test content',
            },
          ],
        }),
      ),
    };
    const prAuthor = {
      branchExists: vi.fn(),
      commitFiles: vi.fn(),
      openOrUpdatePR: vi.fn(),
    };

    await processCoverageAnalysis(job, {
      auth,
      logger: makeLogger(),
      cfg,
      coverageClientFactory: () =>
        coverageClient as unknown as Pick<
          CoverageServiceClient,
          'findOrCreateRepository' | 'triggerAnalysis' | 'waitForPrRun'
        >,
      prAuthorFactory: () =>
        prAuthor as unknown as Pick<
          PRAuthor,
          'branchExists' | 'commitFiles' | 'openOrUpdatePR'
        >,
    });

    expect(prAuthor.commitFiles).not.toHaveBeenCalled();
    expect(prAuthor.openOrUpdatePR).not.toHaveBeenCalled();
  });

  it('throws when the coverage run terminates with FAILED', async () => {
    makeRuntime();
    const coverageClient = {
      findOrCreateRepository: vi.fn(async () => baseRepo),
      triggerAnalysis: vi.fn(async () => ({ prRunId: 'run-1' })),
      waitForPrRun: vi.fn(async (): Promise<PrRun> => ({ ...baseRun, status: 'FAILED' })),
    };

    await expect(
      processCoverageAnalysis(job, {
        auth,
        logger: makeLogger(),
        cfg,
        coverageClientFactory: () =>
          coverageClient as unknown as Pick<
            CoverageServiceClient,
            'findOrCreateRepository' | 'triggerAnalysis' | 'waitForPrRun'
          >,
      }),
    ).rejects.toThrow(/FAILED/);
  });
});
