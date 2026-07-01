import { describe, expect, it, vi } from 'vitest';

import type { ReviewQueue } from '../../jobs/queue.js';
import type { OpenReviewJob } from '../../jobs/types.js';
import type { Logger } from '../../logger.js';

import { handleComment } from './issue-comment.js';
import type { CommentPayload } from './types.js';

function makeQueue() {
  const enqueued: OpenReviewJob[] = [];
  const queue = {
    enqueue: vi.fn(async (job: OpenReviewJob) => {
      enqueued.push(job);
      return true;
    }),
  };
  return { queue: queue as unknown as ReviewQueue, enqueued };
}

const logger = {
  info: () => {},
  debug: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => logger,
} as unknown as Logger;

function payload(body: string, overrides: Partial<CommentPayload> = {}): CommentPayload {
  return {
    action: 'created',
    repository: { name: 'band', owner: { login: 'Kenil27' } },
    comment: { id: 42, body, user: { login: 'human' } },
    pull_request: { number: 1 },
    ...overrides,
  };
}

describe('handleComment routing', () => {
  it('routes `@openreview review` to a fast-review job', async () => {
    const { queue, enqueued } = makeQueue();
    const result = await handleComment('d1', payload('@openreview review'), { queue, logger });
    expect(result).toEqual({ status: 'enqueued', jobKind: 'review-fast' });
    expect(enqueued[0]?.kind).toBe('review-fast');
  });

  it('routes `@openreview rlm` to an RLM job', async () => {
    const { queue, enqueued } = makeQueue();
    const result = await handleComment('d2', payload('@openreview rlm'), { queue, logger });
    expect(result).toEqual({ status: 'enqueued', jobKind: 'review-rlm' });
    expect(enqueued[0]?.kind).toBe('review-rlm');
  });

  it('routes `@openreview list learnings` to learnings-list', async () => {
    const { queue, enqueued } = makeQueue();
    const result = await handleComment('d3', payload('@openreview list learnings'), {
      queue,
      logger,
    });
    expect(result).toEqual({ status: 'enqueued', jobKind: 'learnings-list' });
    expect(enqueued[0]?.kind).toBe('learnings-list');
  });

  it('routes `@openreview forget: foo` to learnings-forget with the description', async () => {
    const { queue, enqueued } = makeQueue();
    const result = await handleComment('d4', payload('@openreview forget: stale rule'), {
      queue,
      logger,
    });
    expect(result).toEqual({ status: 'enqueued', jobKind: 'learnings-forget' });
    const job = enqueued[0];
    expect(job?.kind).toBe('learnings-forget');
    if (job?.kind === 'learnings-forget') {
      expect(job.description).toBe('stale rule');
    }
  });

  it('routes a free-form question to a chat job', async () => {
    const { queue, enqueued } = makeQueue();
    const result = await handleComment(
      'd5',
      payload('@openreview why is this safe?'),
      { queue, logger },
    );
    expect(result).toEqual({ status: 'enqueued', jobKind: 'chat' });
    const job = enqueued[0];
    expect(job?.kind).toBe('chat');
    if (job?.kind === 'chat') {
      expect(job.question).toBe('why is this safe?');
    }
  });

  it('ignores bot comments to prevent reply loops', async () => {
    const { queue } = makeQueue();
    const p = payload('@openreview review', {
      comment: { id: 1, body: '@openreview review', user: { login: 'github-actions[bot]' } },
    });
    const result = await handleComment('d6', p, { queue, logger });
    expect(result).toEqual({ status: 'ignored', reason: 'comment from a bot' });
  });

  it('ignores comments without @openreview mention', async () => {
    const { queue } = makeQueue();
    const result = await handleComment('d7', payload('looks good to me'), { queue, logger });
    expect(result.status).toBe('ignored');
  });

  it('ignores empty @openreview mentions', async () => {
    const { queue } = makeQueue();
    const result = await handleComment('d8', payload('@openreview '), { queue, logger });
    expect(result).toEqual({ status: 'ignored', reason: 'empty @openreview mention' });
  });

  it('ignores comments on plain issues (not PRs)', async () => {
    const { queue } = makeQueue();
    const p: CommentPayload = {
      action: 'created',
      repository: { name: 'band', owner: { login: 'Kenil27' } },
      comment: { id: 7, body: '@openreview review', user: { login: 'human' } },
      issue: { number: 99 },
    };
    const result = await handleComment('d9', p, { queue, logger });
    expect(result.status).toBe('ignored');
  });
});
