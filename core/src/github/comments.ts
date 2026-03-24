import { formatInlineComment, formatSummaryComment } from '../review/formatter.js';
import type { ReviewFinding, ReviewSummary } from '../review/types.js';

import type { GitHubClient } from './client.js';

// Re-export types and formatters so existing consumers don't break
export type { ReviewFinding, ReviewSummary };
export type { FindingCategory, FindingSeverity, FindingSource, Citation } from '../review/types.js';
export { formatInlineComment, formatSummaryComment };

const SUMMARY_MARKER = '<!-- openreview-summary -->';

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
   * Post or update the summary comment.
   * Uses replace-not-duplicate strategy via the HTML marker tag.
   */
  async postSummaryComment(prNumber: number, summary: ReviewSummary): Promise<void> {
    const body = formatSummaryComment(summary);
    const existingId = await this.findSummaryComment(prNumber);

    if (existingId) {
      await this.client['api'].patch(
        `/repos/${this.client.owner}/${this.client.repo}/issues/comments/${existingId}`,
        { body },
      );
    } else {
      await this.client['api'].post(
        `/repos/${this.client.owner}/${this.client.repo}/issues/${prNumber}/comments`,
        { body },
      );
    }
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

  private async findSummaryComment(prNumber: number): Promise<number | null> {
    let page = 1;
    const perPage = 100;

    while (true) {
      const { data } = await this.client['api'].get(
        `/repos/${this.client.owner}/${this.client.repo}/issues/${prNumber}/comments`,
        { params: { per_page: perPage, page } },
      );

      for (const comment of data) {
        if (typeof comment.body === 'string' && comment.body.includes(SUMMARY_MARKER)) {
          return comment.id;
        }
      }

      if (data.length < perPage) break;
      page++;
    }

    return null;
  }
}
