import type { Logger } from '../logger.js';

/**
 * Normalized PR payload forwarded to downstream services.
 *
 * Today this service ALSO performs the review itself. As the architecture
 * grows (linters / AI reviewer / learnings indexer as separate workers),
 * the webhook handler will additionally call `forwardPullRequest` so those
 * services receive a sanitized payload without ever talking to GitHub.
 */
export interface DownstreamPRPayload {
  deliveryId: string;
  event: 'pull_request' | 'pull_request_review_comment' | 'issue_comment';
  action: string;
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  author: string;
  isDraft: boolean;
  title: string;
}

export interface DownstreamDispatcher {
  forwardPullRequest(payload: DownstreamPRPayload): Promise<void>;
}

/**
 * Stub dispatcher — logs and discards. Replace with an HTTP forwarder,
 * Pub/Sub publisher, or a second BullMQ queue when downstream consumers exist.
 */
export function createNoopDispatcher(logger: Logger): DownstreamDispatcher {
  return {
    async forwardPullRequest(payload: DownstreamPRPayload): Promise<void> {
      logger.debug({ payload }, 'downstream dispatch (no-op)');
    },
  };
}
