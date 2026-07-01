import { containsTrigger } from '@openreview/core';

import type { ReviewQueue } from '../../jobs/queue.js';
import type { OpenReviewJob } from '../../jobs/types.js';
import type { Logger } from '../../logger.js';

import type { CommentPayload, HandlerResult } from './types.js';

const MENTION_RE = /@openreview\s*/i;

/**
 * Handle `issue_comment` and `pull_request_review_comment` events.
 *
 * Routes by the literal text following `@openreview`:
 *   - `review`            -> enqueue review-fast
 *   - `rlm`               -> enqueue review-rlm
 *   - `list learnings`    -> enqueue learnings-list
 *   - `forget: <desc>`    -> enqueue learnings-forget
 *   - anything else       -> enqueue chat (free-form question)
 *
 * Comments without `@openreview` are inspected for learnings trigger phrases
 * ("false positive", "ignore this", etc.) and stored as feedback.
 */
export async function handleComment(
  deliveryId: string,
  payload: CommentPayload,
  deps: { queue: ReviewQueue; logger: Logger },
): Promise<HandlerResult> {
  if (payload.action !== 'created') {
    return { status: 'ignored', reason: `comment action not handled: ${payload.action}` };
  }

  const comment = payload.comment;
  const author = comment.user?.login ?? '';
  const body = comment.body ?? '';
  const commentId = comment.id;

  // Bot loop prevention.
  if (author.endsWith('[bot]')) {
    return { status: 'ignored', reason: 'comment from a bot' };
  }

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const prNumber = payload.pull_request?.number ?? payload.issue?.number;
  if (typeof prNumber !== 'number') {
    return { status: 'ignored', reason: 'comment not associated with a PR' };
  }

  // issue_comment fires on every issue too — only act on PR comments.
  // For pull_request_review_comment the payload always has pull_request.
  if (!payload.pull_request && !payload.issue?.pull_request) {
    return { status: 'ignored', reason: 'comment is on an issue, not a PR' };
  }

  // No @openreview mention: maybe it's implicit feedback for the learnings store.
  if (!MENTION_RE.test(body)) {
    if (containsTrigger(body)) {
      // Future: enqueue a learnings-add job. For v1 we just acknowledge.
      deps.logger.info({ repo: `${owner}/${repo}`, prNumber }, 'learnings trigger detected');
    }
    return { status: 'ignored', reason: 'no @openreview mention' };
  }

  const mentionText = body.replace(MENTION_RE, '').trim();
  const job = buildJob({ mentionText, owner, repo, prNumber, deliveryId, author, commentId });

  if (!job) {
    return { status: 'ignored', reason: 'empty @openreview mention' };
  }

  const enqueued = await deps.queue.enqueue(job);
  return enqueued
    ? { status: 'enqueued', jobKind: job.kind }
    : { status: 'duplicate', reason: 'same comment already queued' };
}

/* ------------------------------------------------------------------ */
/*  Routing                                                            */
/* ------------------------------------------------------------------ */

function buildJob(args: {
  mentionText: string;
  owner: string;
  repo: string;
  prNumber: number;
  deliveryId: string;
  author: string;
  commentId: number;
}): OpenReviewJob | null {
  const { mentionText, owner, repo, prNumber, deliveryId, author, commentId } = args;
  const base = { deliveryId, owner, repo, prNumber } as const;
  const lower = mentionText.toLowerCase();

  if (lower === '') return null;

  if (lower === 'rlm') {
    // headSha is filled in by the processor when it fetches the PR.
    return { kind: 'review-rlm', ...base, headSha: `comment:${commentId}` };
  }
  if (lower === 'review') {
    return { kind: 'review-fast', ...base, headSha: `comment:${commentId}` };
  }
  if (lower === 'list learnings') {
    return { kind: 'learnings-list', ...base, commentId };
  }
  if (lower.startsWith('forget:')) {
    const description = mentionText.slice('forget:'.length).trim();
    if (!description) return null;
    return { kind: 'learnings-forget', ...base, commentId, description };
  }

  return {
    kind: 'chat',
    ...base,
    question: mentionText,
    commentId,
    user: author,
  };
}
