/* eslint-disable no-console -- CLI writes review output to stdout */
import {
  formatInlineComment,
  formatSummaryComment,
  sortFindings,
} from '@openreview/core';
import type { ReviewFinding, ReviewSummary } from '@openreview/core';

function buildSummary(
  findings: ReviewFinding[],
  fileCount: number,
  durationMs: number,
  mode: 'fast' | 'rlm',
): ReviewSummary {
  const bySeverity: ReviewSummary['findingsBySeverity'] = {
    severe: 0,
    'non-severe': 0,
    investigate: 0,
    informational: 0,
  };

  for (const f of findings) {
    bySeverity[f.severity]++;
  }

  const seconds = Math.round(durationMs / 1000);
  const duration = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;

  return {
    filesReviewed: fileCount,
    duration,
    mode,
    findingsBySeverity: bySeverity,
    totalFindings: findings.length,
  };
}

export function printReviewResult(
  findings: ReviewFinding[],
  fileCount: number,
  durationMs: number,
  mode: 'fast' | 'rlm',
  format: 'text' | 'markdown' | 'json',
): void {
  const sorted = sortFindings(findings);
  const summary = buildSummary(sorted, fileCount, durationMs, mode);

  if (format === 'json') {
    console.log(JSON.stringify({ findings: sorted, summary }, null, 2));
    return;
  }

  if (format === 'markdown') {
    console.log(formatSummaryComment(summary));
    for (const f of sorted) {
      console.log('\n---\n');
      console.log(formatInlineComment(f));
    }
    return;
  }

  console.log(formatSummaryComment(summary));
  for (const f of sorted) {
    console.log('\n—\n');
    console.log(`${f.file}:${f.startLine}-${f.endLine} [${f.severity}] ${f.title}\n`);
    console.log(f.explanation);
    if (f.suggestedFix) {
      console.log(`\nSuggested fix:\n${f.suggestedFix}`);
    }
  }
}
