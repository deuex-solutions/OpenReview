import type { DownstreamDispatcher } from '../../dispatch/downstream.js';
import type { ReviewQueue } from '../../jobs/queue.js';
import type { Logger } from '../../logger.js';

import type { PullRequestPayload, HandlerResult } from './types.js';

const VALID_ACTIONS = new Set([
  'opened',
  'synchronize',
  'reopened',
  'ready_for_review',
]);

const SKIP_MARKER = 'openreview: skip';

/**
 * Handle pull_request events. Enqueues a fast review job and forwards a
 * normalized payload to any registered downstream dispatcher.
 */
export async function handlePullRequest(
  deliveryId: string,
  payload: PullRequestPayload,
  deps: {
    queue: ReviewQueue;
    downstream: DownstreamDispatcher;
    logger: Logger;
  },
): Promise<HandlerResult> {
  const action = payload.action;
  if (!VALID_ACTIONS.has(action)) {
    return { status: 'ignored', reason: `pull_request action not handled: ${action}` };
  }

  const pr = payload.pull_request;
  if (pr.draft) {
    return { status: 'ignored', reason: 'draft PR' };
  }

  if (typeof pr.body === 'string' && pr.body.includes(SKIP_MARKER)) {
    return { status: 'ignored', reason: `PR body contains "${SKIP_MARKER}"` };
  }

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const prNumber = pr.number;
  const headSha = pr.head.sha;

  await deps.downstream.forwardPullRequest({
    deliveryId,
    event: 'pull_request',
    action,
    owner,
    repo,
    prNumber,
    headSha,
    baseSha: pr.base.sha,
    author: pr.user.login,
    isDraft: pr.draft,
    title: pr.title,
  });

  const enqueued = await deps.queue.enqueue({
    kind: 'review-fast',
    deliveryId,
    owner,
    repo,
    prNumber,
    headSha,
  });

  return enqueued
    ? { status: 'enqueued', jobKind: 'review-fast' }
    : { status: 'duplicate', reason: 'same (repo, pr, headSha) already queued' };
}
