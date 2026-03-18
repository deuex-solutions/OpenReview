import type { GitHubClient } from './client.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ReviewFinding {
  file: string;
  line: number;
  side?: 'LEFT' | 'RIGHT';
  severity: Severity;
  title: string;
  explanation: string;
  suggestedFix?: string;
}

export interface ReviewSummary {
  totalFindings: number;
  bySeverity: Record<Severity, number>;
  filesReviewed: number;
  duration: string;
  mode: 'fast' | 'rlm';
  highlights?: string[];
}

const SUMMARY_MARKER = '<!-- openreview-summary -->';

const SEVERITY_BADGES: Record<Severity, string> = {
  critical: '🔴 **Critical**',
  high: '🟠 **High**',
  medium: '🟡 **Medium**',
  low: '🔵 **Low**',
  info: 'ℹ️ **Info**',
};

/* ------------------------------------------------------------------ */
/*  Markdown formatters                                                */
/* ------------------------------------------------------------------ */

export function formatInlineComment(finding: ReviewFinding): string {
  const badge = SEVERITY_BADGES[finding.severity];
  let body = `${badge}: ${finding.title}\n\n${finding.explanation}`;

  if (finding.suggestedFix) {
    body += `\n\n**Suggested fix:**\n\`\`\`suggestion\n${finding.suggestedFix}\n\`\`\``;
  }

  return body;
}

export function formatSummaryComment(summary: ReviewSummary): string {
  const rows = (Object.keys(summary.bySeverity) as Severity[])
    .filter((sev) => summary.bySeverity[sev] > 0)
    .map((sev) => `| ${SEVERITY_BADGES[sev]} | ${summary.bySeverity[sev]} |`)
    .join('\n');

  let md = `${SUMMARY_MARKER}\n## OpenReview Summary\n\n`;
  md += `**Mode:** ${summary.mode} | **Files:** ${summary.filesReviewed} | **Duration:** ${summary.duration}\n\n`;

  if (summary.totalFindings === 0) {
    md += '✅ No issues found.\n';
  } else {
    md += `| Severity | Count |\n|---|---|\n${rows}\n\n`;
    md += `**Total:** ${summary.totalFindings} finding${summary.totalFindings === 1 ? '' : 's'}\n`;
  }

  if (summary.highlights && summary.highlights.length > 0) {
    md += '\n### Highlights\n\n';
    md += summary.highlights.map((h) => `- ${h}`).join('\n');
    md += '\n';
  }

  md += '\n---\n*Powered by [OpenReview](https://github.com/openreview)*\n';
  return md;
}

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
      line: f.line,
      side: f.side ?? 'RIGHT',
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

  /** Reply to a specific review comment. */
  async postChatReply(commentId: number, reply: string): Promise<void> {
    await this.client['api'].post(
      `/repos/${this.client.owner}/${this.client.repo}/issues/comments/${commentId}`,
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
