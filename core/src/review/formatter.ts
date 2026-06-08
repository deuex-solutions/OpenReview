import type { FindingSeverity, ReviewFinding, ReviewSummary } from './types.js';

/* ------------------------------------------------------------------ */
/*  Severity badges                                                    */
/* ------------------------------------------------------------------ */

const SEVERITY_BADGES: Record<FindingSeverity, string> = {
  severe: '[CRITICAL] **Bug — Severe**',
  'non-severe': '[MODERATE] **Bug — Non-severe**',
  investigate: '[FLAG] **Investigate**',
  informational: '[INFO] **Informational**',
};

const SUMMARY_MARKER = '<!-- openreview-summary -->';

/* ------------------------------------------------------------------ */
/*  Summary Comment (§5.4)                                             */
/* ------------------------------------------------------------------ */

export function formatSummaryComment(summary: ReviewSummary): string {
  let md = `${SUMMARY_MARKER}\n## OpenReview Summary\n\n`;
  md += `**Files reviewed:** ${summary.filesReviewed} | **Duration:** ${summary.duration} | **Mode:** ${summary.mode}\n\n`;

  if (summary.totalFindings === 0) {
    md += '[SUCCESS] No issues found.\n';
  } else {
    md += '| Severity | Count |\n|---|---|\n';

    const order: FindingSeverity[] = ['severe', 'non-severe', 'investigate', 'informational'];
    for (const sev of order) {
      const count = summary.findingsBySeverity[sev];
      if (count > 0) {
        md += `| ${SEVERITY_BADGES[sev]} | ${count} |\n`;
      }
    }

    md += `\n**Total:** ${summary.totalFindings} finding${summary.totalFindings === 1 ? '' : 's'}\n`;
  }

  md += '\n---\n';
  md +=
    '*Trigger deep review: `@openreview rlm` | Ask a question: `@openreview <your question>`*\n';

  return md;
}

/* ------------------------------------------------------------------ */
/*  Inline Comment (§5.5)                                              */
/* ------------------------------------------------------------------ */

export function formatInlineComment(finding: ReviewFinding): string {
  const badge = SEVERITY_BADGES[finding.severity];
  let body = `${badge}: ${finding.title}\n\n${finding.explanation}`;

  if (finding.suggestedFix) {
    body += `\n\n**Suggested fix:**\n\`\`\`suggestion\n${finding.suggestedFix}\n\`\`\``;
  }

  if (finding.source === 'linter' || finding.source === 'both') {
    const linter = finding.linterName ?? 'linter';
    const label = finding.source === 'both' ? `AI + ${linter}` : linter;
    body += `\n\n> Source: ${label}`;
  }

  return body;
}
