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

/**
 * Dispatched alongside review jobs when `COVERAGE_SERVICE_ENABLED=true`.
 *
 * The Coverage Service is a separate microservice that:
 *   1. Clones the repo at headSha + baseBranch.
 *   2. Runs the configured `testCommand` with coverage instrumentation.
 *   3. Asks an LLM to generate unit tests for the largest coverage gaps.
 *   4. Re-runs tests to validate the generated files.
 *
 * Our worker only orchestrates the three REST calls and authors a stacked
 * PR with the resulting test files.
 *
 * `prRunId` is populated AFTER the first successful `POST /repositories/:id/analyze`
 * and persisted back onto the job (via `job.updateData`) so BullMQ retries
 * resume polling the existing run instead of starting a brand new one.
 */
export interface CoverageAnalysisJob extends JobBase {
  kind: 'coverage-analysis';
  headSha: string;
  baseSha: string;
  /** PR base ref — used to set the run's `baseBranch` on the coverage service. */
  baseRef: string;
  /** PR head ref — also the base branch of the stacked test PR. */
  headRef: string;
  title: string;
  /** Set after the first analyze call; survives retries via job.updateData. */
  prRunId?: string;
}

export type OpenReviewJob =
  | FastReviewJob
  | RlmReviewJob
  | ChatJob
  | LearningsListJob
  | LearningsForgetJob
  | CoverageAnalysisJob;

export type OpenReviewJobKind = OpenReviewJob['kind'];

/** Single queue name; jobs are differentiated by `kind` + the BullMQ job name. */
export const QUEUE_NAME = 'openreview';
