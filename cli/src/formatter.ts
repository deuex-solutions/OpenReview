import type { ReviewFinding, ReviewSummary } from '@openreview/core';

/* ------------------------------------------------------------------ */
/*  Text output                                                        */
/* ------------------------------------------------------------------ */

const SEVERITY_ICONS: Record<string, string> = {
  severe: '🔴',
  'non-severe': '🟠',
  investigate: '🔍',
  informational: 'ℹ️',
};

export function formatText(findings: ReviewFinding[], summary: ReviewSummary): string {
  const lines: string[] = [];

  lines.push(`OpenReview — ${summary.mode} mode | ${summary.filesReviewed} files | ${summary.duration}`);
  lines.push(`Findings: ${summary.totalFindings}`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('No issues found.');
    return lines.join('\n');
  }

  for (const f of findings) {
    const icon = SEVERITY_ICONS[f.severity] ?? '❓';
    const source = f.source === 'linter' ? ` [${f.linterName}]` : '';
    lines.push(`${icon} ${f.severity.toUpperCase()} ${f.file}:${f.startLine} — ${f.title}${source}`);
    lines.push(`  ${f.explanation}`);
    if (f.suggestedFix) {
      lines.push(`  Fix: ${f.suggestedFix}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Markdown output                                                    */
/* ------------------------------------------------------------------ */

export function formatMarkdown(findings: ReviewFinding[], summary: ReviewSummary): string {
  const lines: string[] = [];

  lines.push(`## OpenReview Summary`);
  lines.push('');
  lines.push(`**Files reviewed:** ${summary.filesReviewed} | **Duration:** ${summary.duration} | **Mode:** ${summary.mode}`);
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('|---|---|');
  lines.push(`| 🔴 Bug — Severe | ${summary.findingsBySeverity.severe} |`);
  lines.push(`| 🟠 Bug — Non-severe | ${summary.findingsBySeverity['non-severe']} |`);
  lines.push(`| 🔍 Investigate | ${summary.findingsBySeverity.investigate} |`);
  lines.push(`| ℹ️ Informational | ${summary.findingsBySeverity.informational} |`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('No issues found.');
    return lines.join('\n');
  }

  // Group by severity
  const grouped = new Map<string, ReviewFinding[]>();
  for (const f of findings) {
    const group = grouped.get(f.severity) ?? [];
    group.push(f);
    grouped.set(f.severity, group);
  }

  for (const [severity, group] of grouped) {
    const icon = SEVERITY_ICONS[severity] ?? '❓';
    lines.push(`### ${icon} ${severity}`);
    lines.push('');
    for (const f of group) {
      lines.push(`**${f.title}** — \`${f.file}:${f.startLine}\``);
      lines.push('');
      lines.push(f.explanation);
      if (f.suggestedFix) {
        lines.push('');
        lines.push('```suggestion');
        lines.push(f.suggestedFix);
        lines.push('```');
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  JSON output                                                        */
/* ------------------------------------------------------------------ */

export function formatJSON(findings: ReviewFinding[], summary: ReviewSummary): string {
  return JSON.stringify({ summary, findings }, null, 2);
}
