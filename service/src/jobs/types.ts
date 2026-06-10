/**
 * Discriminated union of jobs the OpenReview service can process.
 * The webhook layer is the ONLY producer; processors are the only consumers.
 *
 * Keep payloads small — every byte travels through Redis. Pass identifiers,
 * never large diffs or file contents; processors re-fetch from GitHub.
 */

export interface JobBase {
  /** GitHub delivery UUID — useful for traceability across logs. */
  deliveryId: string;
  owner: string;
  repo: string;
  prNumber: number;
}

export interface FastReviewJob extends JobBase {
  kind: 'review-fast';
  /** Head SHA at delivery time — used as part of the dedup key. */
  headSha: string;
}

export interface RlmReviewJob extends JobBase {
  kind: 'review-rlm';
  headSha: string;
}

export interface ChatJob extends JobBase {
  kind: 'chat';
  question: string;
  commentId: number;
  user: string;
}

export interface LearningsListJob extends JobBase {
  kind: 'learnings-list';
  commentId: number;
}

export interface LearningsForgetJob extends JobBase {
  kind: 'learnings-forget';
  description: string;
  commentId: number;
}

export type OpenReviewJob =
  | FastReviewJob
  | RlmReviewJob
  | ChatJob
  | LearningsListJob
  | LearningsForgetJob;

export type OpenReviewJobKind = OpenReviewJob['kind'];

/** Single queue name; jobs are differentiated by `kind` + the BullMQ job name. */
export const QUEUE_NAME = 'openreview';
