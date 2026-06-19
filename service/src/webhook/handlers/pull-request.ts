import type { DownstreamDispatcher } from '../../dispatch/downstream.js';
import {
  isStackedTestBranch,
  OPENREVIEW_SKIP_MARKER,
} from '../../github/stacked-test-pr.js';
import type { ReviewQueue } from '../../jobs/queue.js';
import type { Logger } from '../../logger.js';

import type { PullRequestPayload, HandlerResult } from './types.js';

const VALID_ACTIONS = new Set([
  'opened',
  'synchronize',
  'reopened',
  'ready_for_review',
]);

export interface PullRequestHandlerOptions {
  /** Toggle from config — when false, no coverage-analysis job is enqueued. */
  coverageServiceEnabled: boolean;
  /** Branch prefix for stacked test PRs — used to skip review on those PRs. */
  coverageServiceBranchPrefix?: string;
}

/**
 * Handle pull_request events.
 *
 * Always enqueues a fast review. When `coverageServiceEnabled` is on, ALSO
 * enqueues a coverage-analysis job — the two run independently so coverage
 * latency (clone + install + run + LLM) never blocks the review path.
 */
export async function handlePullRequest(
  deliveryId: string,
  payload: PullRequestPayload,
  deps: {
    queue: ReviewQueue;
    downstream: DownstreamDispatcher;
    logger: Logger;
    options: PullRequestHandlerOptions;
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

  if (typeof pr.body === 'string' && pr.body.includes(OPENREVIEW_SKIP_MARKER)) {
    return {
      status: 'ignored',
      reason: `PR body contains "${OPENREVIEW_SKIP_MARKER}"`,
    };
  }

  const headRef = pr.head.ref;
  if (isStackedTestBranch(headRef, deps.options.coverageServiceBranchPrefix)) {
    return {
      status: 'ignored',
      reason: 'OpenReview stacked test PR (auto-generated tests)',
    };
  }

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const prNumber = pr.number;
  const headSha = pr.head.sha;
  const baseSha = pr.base.sha;
  const baseRef = pr.base.ref;

  await deps.downstream.forwardPullRequest({
    deliveryId,
    event: 'pull_request',
    action,
    owner,
    repo,
    prNumber,
    headSha,
    baseSha,
    author: pr.user.login,
    isDraft: pr.draft,
    title: pr.title,
  });

  const reviewEnqueued = await deps.queue.enqueue({
    kind: 'review-fast',
    deliveryId,
    owner,
    repo,
    prNumber,
    headSha,
  });

  const alsoEnqueued: string[] = [];
  if (deps.options.coverageServiceEnabled) {
    const coverageEnqueued = await deps.queue.enqueue({
      kind: 'coverage-analysis',
      deliveryId,
      owner,
      repo,
      prNumber,
      headSha,
      baseSha,
      baseRef,
      headRef,
      title: pr.title,
    });
    if (coverageEnqueued) alsoEnqueued.push('coverage-analysis');
  }

  if (!reviewEnqueued) {
    return alsoEnqueued.length > 0
      ? { status: 'enqueued', jobKind: 'coverage-analysis' }
      : { status: 'duplicate', reason: 'same (repo, pr, headSha) already queued' };
  }

  return alsoEnqueued.length > 0
    ? { status: 'enqueued', jobKind: 'review-fast', alsoEnqueued }
    : { status: 'enqueued', jobKind: 'review-fast' };
}
