import type { FindingSeverity, ReviewFinding, ReviewSummary } from './types.js';

/* ------------------------------------------------------------------ */
/*  Severity badges                                                    */
/* ------------------------------------------------------------------ */

const SEVERITY_BADGES: Record<FindingSeverity, string> = {
  severe: '🔴 **Bug — Severe**',
  'non-severe': '🟠 **Bug — Non-severe**',
  investigate: '🔍 **Flag — Investigate**',
  informational: 'ℹ️ **Flag — Informational**',
};

const SUMMARY_MARKER = '<!-- openreview-summary -->';

/* ------------------------------------------------------------------ */
/*  Summary Comment (§5.4)                                             */
/* ------------------------------------------------------------------ */

export function formatSummaryComment(summary: ReviewSummary): string {
  let md = `${SUMMARY_MARKER}\n## OpenReview Summary\n\n`;
  md += `**Files reviewed:** ${summary.filesReviewed} | **Duration:** ${summary.duration} | **Mode:** ${summary.mode}\n\n`;

  if (summary.totalFindings === 0) {
    md += '✅ No issues found.\n';
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

  if (summary.impactSummary && summary.impactSummary.totalImpacted > 0) {
    md += '\n## 🌳 Impact Analysis\n\n';
    md += `- **Total impacted files:** ${summary.impactSummary.totalImpacted}\n`;
    md += `- **Direct dependents:** ${summary.impactSummary.directDependents}\n`;
    md += `- **Transitive dependents:** ${summary.impactSummary.transitiveDependents}\n`;
    
    if (summary.impactSummary.affectedPageCount > 0 && summary.impactSummary.affectedPages) {
      md += `\n**Affected UI Pages/Routes (${summary.impactSummary.affectedPageCount}):**\n`;
      for (const page of summary.impactSummary.affectedPages) {
        md += `- 🌐 \`${page}\`\n`;
      }
    }
    md += '\n';
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
  let body = `${badge}: ${finding.title}\n\n`;

  if (finding.impactScope && finding.impactScope.affectedFiles > 0) {
    const pagesText = finding.impactScope.affectedPages > 0 ? ` across ${finding.impactScope.affectedPages} pages` : '';
    body += `⚡ **High impact** — affects ${finding.impactScope.affectedFiles} files${pagesText}\n\n`;
  }

  body += `${finding.explanation}`;

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
