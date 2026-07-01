import { formatInlineComment, formatSummaryComment } from '../review/formatter.js';
import {
  buildReviewState,
  enrichReviewSummary,
  parseReviewState,
  type ReviewState,
} from '../review/review-state.js';
import type { PRContext, ReviewFinding, ReviewSummary } from '../review/types.js';

import type { GitHubClient } from './client.js';

// Re-export types and formatters so existing consumers don't break
export type { ReviewFinding, ReviewSummary };
export type { FindingCategory, FindingSeverity, FindingSource, Citation } from '../review/types.js';
export { formatInlineComment, formatSummaryComment };
export { parseReviewState, enrichReviewSummary, buildReviewState };
export type { ReviewState };

export const REVIEW_SUMMARY_MARKER = '<!-- openreview-summary -->';
export const COVERAGE_SUMMARY_MARKER = '<!-- openreview:coverage -->';

/* ------------------------------------------------------------------ */
/*  Comment Poster                                                     */
/* ------------------------------------------------------------------ */

export class CommentPoster {
  constructor(private client: GitHubClient) {}

  /**
   * Post all findings as a single batch review.
   * Review state is always COMMENT — never auto-approve or request changes.
   */
  async postReview(prNumber: number, findings: ReviewFinding[]): Promise<void> {
    if (findings.length === 0) return;

    const comments = findings.map((f) => ({
      path: f.file,
      line: f.startLine,
      side: 'RIGHT' as const,
      body: formatInlineComment(f),
    }));

    await this.client['api'].post(
      `/repos/${this.client.owner}/${this.client.repo}/pulls/${prNumber}/reviews`,
      {
        event: 'COMMENT',
        comments,
      },
    );
  }

  /**
   * Incremental review post: only new inline comments, summary updated with
   * resolved/open tracking across commits (gitar-bot style).
   */
  async postReviewResults(
    prNumber: number,
    pr: PRContext,
    findings: ReviewFinding[],
    baseSummary: ReviewSummary,
  ): Promise<ReviewSummary> {
    const previousState = await this.fetchReviewState(prNumber);
    const summary = enrichReviewSummary(pr, findings, baseSummary, previousState);
    const state = buildReviewState(pr, findings);

    const newFindings = summary.newFindings ?? findings;
    if (newFindings.length > 0) {
      await this.postReview(prNumber, newFindings);
    }

    await this.postSummaryComment(prNumber, summary, state);
    return summary;
  }

  /**
   * Post or update the summary comment.
   * Uses replace-not-duplicate strategy via the HTML marker tag.
   */
  async postSummaryComment(
    prNumber: number,
    summary: ReviewSummary,
    state?: ReviewState,
  ): Promise<void> {
    const body = formatSummaryComment(summary, state);
    await this.postOrUpdateMarkedComment(prNumber, REVIEW_SUMMARY_MARKER, body);
  }

  /**
   * Post or update the coverage summary on the original PR.
   * Replaces the previous coverage comment instead of posting a new one each push.
   */
  async postCoverageComment(prNumber: number, body: string): Promise<void> {
    const content = body.includes(COVERAGE_SUMMARY_MARKER)
      ? body
      : `${COVERAGE_SUMMARY_MARKER}\n${body}`;
    await this.postOrUpdateMarkedComment(prNumber, COVERAGE_SUMMARY_MARKER, content);
  }

  /** Load persisted review state from the existing summary comment, if any. */
  async fetchReviewState(prNumber: number): Promise<ReviewState | null> {
    const body = await this.fetchMarkedCommentBody(prNumber, REVIEW_SUMMARY_MARKER);
    return body ? parseReviewState(body) : null;
  }

  /** Reply in a PR thread by posting a new issue comment. */
  async postChatReply(prNumber: number, reply: string): Promise<void> {
    await this.client['api'].post(
      `/repos/${this.client.owner}/${this.client.repo}/issues/${prNumber}/comments`,
      { body: reply },
    );
  }

  /** Post a standalone acknowledgement comment on the PR. */
  async postAcknowledgement(prNumber: number, message: string): Promise<void> {
    await this.client['api'].post(
      `/repos/${this.client.owner}/${this.client.repo}/issues/${prNumber}/comments`,
      { body: message },
    );
  }

  /* ---- Internal helpers ---- */

  private async postOrUpdateMarkedComment(
    prNumber: number,
    marker: string,
    body: string,
  ): Promise<void> {
    const latestIssue = await this.fetchLatestIssueComment(prNumber);
    const marked = await this.findMarkedCommentRecord(prNumber, marker);

    // Update in place only when our summary is already the newest timeline comment.
    // Otherwise append a fresh comment so results are visible at the bottom.
    if (marked && latestIssue && marked.id === latestIssue.id) {
      await this.client['api'].patch(
        `/repos/${this.client.owner}/${this.client.repo}/issues/comments/${marked.id}`,
        { body },
      );
      return;
    }

    await this.client['api'].post(
      `/repos/${this.client.owner}/${this.client.repo}/issues/${prNumber}/comments`,
      { body },
    );
  }

  private async fetchLatestIssueComment(
    prNumber: number,
  ): Promise<{ id: number; body: string } | null> {
    const { data } = await this.client['api'].get(
      `/repos/${this.client.owner}/${this.client.repo}/issues/${prNumber}/comments`,
      { params: { per_page: 1, page: 1, sort: 'created', direction: 'desc' } },
    );

    const comment = data[0];
    if (!comment || typeof comment.body !== 'string') return null;
    return { id: comment.id, body: comment.body };
  }

  private async fetchMarkedCommentBody(
    prNumber: number,
    marker: string,
  ): Promise<string | null> {
    const comment = await this.findMarkedCommentRecord(prNumber, marker);
    return typeof comment?.body === 'string' ? comment.body : null;
  }

  private async findMarkedComment(prNumber: number, marker: string): Promise<number | null> {
    const comment = await this.findMarkedCommentRecord(prNumber, marker);
    return comment?.id ?? null;
  }

  /**
   * Return the newest issue comment containing `marker`.
   * Older duplicates are left untouched — we always refresh the latest one so
   * updates appear near the bottom of busy PR threads.
   */
  private async findMarkedCommentRecord(
    prNumber: number,
    marker: string,
  ): Promise<{ id: number; body: string } | null> {
    let page = 1;
    const perPage = 100;

    while (true) {
      const { data } = await this.client['api'].get(
        `/repos/${this.client.owner}/${this.client.repo}/issues/${prNumber}/comments`,
        { params: { per_page: perPage, page, sort: 'created', direction: 'desc' } },
      );

      for (const comment of data) {
        if (typeof comment.body === 'string' && comment.body.includes(marker)) {
          return { id: comment.id, body: comment.body };
        }
      }

      if (data.length < perPage) break;
      page++;
    }

    return null;
  }
}
