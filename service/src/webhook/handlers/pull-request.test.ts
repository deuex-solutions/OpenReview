import { describe, expect, it, vi } from 'vitest';

import type { DownstreamDispatcher } from '../../dispatch/downstream.js';
import type { ReviewQueue } from '../../jobs/queue.js';
import type { OpenReviewJob } from '../../jobs/types.js';
import type { Logger } from '../../logger.js';

import { handlePullRequest } from './pull-request.js';
import type { PullRequestPayload } from './types.js';

function deps() {
  const enqueued: OpenReviewJob[] = [];
  const queue = {
    enqueue: vi.fn(async (job: OpenReviewJob) => {
      enqueued.push(job);
      return true;
    }),
  } as unknown as ReviewQueue;

  const forwarded: unknown[] = [];
  const downstream: DownstreamDispatcher = {
    forwardPullRequest: vi.fn(async (p) => {
      forwarded.push(p);
    }),
  };

  const logger = { info: () => {}, debug: () => {}, child: () => logger } as unknown as Logger;

  return { queue, downstream, logger, enqueued, forwarded };
}

function payload(action: string, overrides: Partial<PullRequestPayload['pull_request']> = {}): PullRequestPayload {
  return {
    action,
    repository: { name: 'band', owner: { login: 'Kenil27' } },
    pull_request: {
      number: 1,
      title: 'Test PR',
      body: '',
      draft: false,
      user: { login: 'human' },
      head: { sha: 'aaaa1111' },
      base: { sha: 'bbbb2222' },
      ...overrides,
    },
  };
}

describe('handlePullRequest', () => {
  it('enqueues a fast review for `opened`', async () => {
    const d = deps();
    const result = await handlePullRequest('d1', payload('opened'), d);
    expect(result).toEqual({ status: 'enqueued', jobKind: 'review-fast' });
    expect(d.enqueued[0]?.kind).toBe('review-fast');
  });

  it('enqueues a fast review for `synchronize`', async () => {
    const d = deps();
    const result = await handlePullRequest('d2', payload('synchronize'), d);
    expect(result.status).toBe('enqueued');
  });

  it('ignores unsupported pull_request actions', async () => {
    const d = deps();
    const result = await handlePullRequest('d3', payload('labeled'), d);
    expect(result.status).toBe('ignored');
    expect(d.enqueued).toHaveLength(0);
  });

  it('skips draft PRs', async () => {
    const d = deps();
    const result = await handlePullRequest('d4', payload('opened', { draft: true }), d);
    expect(result).toEqual({ status: 'ignored', reason: 'draft PR' });
  });

  it('honors "openreview: skip" in the PR body', async () => {
    const d = deps();
    const p = payload('opened', { body: 'WIP\n\n<!-- openreview: skip -->' });
    const result = await handlePullRequest('d5', p, d);
    expect(result.status).toBe('ignored');
    expect(d.enqueued).toHaveLength(0);
  });

  it('forwards a normalized payload to the downstream dispatcher', async () => {
    const d = deps();
    await handlePullRequest('d6', payload('opened'), d);
    expect(d.forwarded).toHaveLength(1);
    const fwd = d.forwarded[0] as { event: string; owner: string; repo: string; prNumber: number };
    expect(fwd.event).toBe('pull_request');
    expect(fwd.owner).toBe('Kenil27');
    expect(fwd.repo).toBe('band');
    expect(fwd.prNumber).toBe(1);
  });
});
