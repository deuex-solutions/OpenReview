import type { DownstreamDispatcher } from '../dispatch/downstream.js';
import type { ReviewQueue } from '../jobs/queue.js';
import type { Logger } from '../logger.js';

import { handleComment } from './handlers/issue-comment.js';
import { handlePullRequest } from './handlers/pull-request.js';
import type {
  CommentPayload,
  HandlerResult,
  PullRequestPayload,
} from './handlers/types.js';

export interface WebhookRouterDeps {
  queue: ReviewQueue;
  downstream: DownstreamDispatcher;
  logger: Logger;
}

/**
 * Top-level webhook dispatcher.
 *
 * Routes by the `X-GitHub-Event` header to per-event handlers. Each handler
 * is fully responsible for deciding whether to enqueue, ignore, or treat
 * the event as a duplicate; the router only does the dispatch.
 *
 * Unknown events return `ignored` rather than failing — this lets you safely
 * subscribe to more events on the GitHub side without redeploying.
 */
export async function routeWebhook(
  event: string,
  deliveryId: string,
  payload: unknown,
  deps: WebhookRouterDeps,
): Promise<HandlerResult> {
  switch (event) {
    case 'pull_request':
      return handlePullRequest(deliveryId, payload as PullRequestPayload, deps);

    case 'pull_request_review_comment':
    case 'issue_comment':
      return handleComment(deliveryId, payload as CommentPayload, {
        queue: deps.queue,
        logger: deps.logger,
      });

    case 'ping':
      return { status: 'ignored', reason: 'GitHub ping event' };

    default:
      return { status: 'ignored', reason: `unsupported event: ${event}` };
  }
}
