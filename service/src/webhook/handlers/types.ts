/**
 * Minimal payload shapes we care about — extracted from the very large
 * GitHub webhook event schemas so we only import what we actually use.
 *
 * Each interface deliberately uses `unknown` for fields we don't touch so
 * unrelated schema drift on GitHub's side never breaks us at compile time.
 */

interface RepoRef {
  name: string;
  owner: { login: string };
}

interface UserRef {
  login: string;
}

export interface PullRequestPayload {
  action: string;
  repository: RepoRef;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    draft: boolean;
    user: UserRef;
    head: { sha: string };
    base: { sha: string };
  };
}

export interface CommentPayload {
  action: string;
  repository: RepoRef;
  comment: {
    id: number;
    body: string | null;
    user: UserRef | null;
  };
  // issue_comment payload
  issue?: {
    number: number;
    pull_request?: { url: string };
  };
  // pull_request_review_comment payload
  pull_request?: {
    number: number;
  };
}

export type HandlerResult =
  | { status: 'enqueued'; jobKind: string }
  | { status: 'ignored'; reason: string }
  | { status: 'duplicate'; reason: string };
