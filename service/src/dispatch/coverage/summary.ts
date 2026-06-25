import { OPENREVIEW_SKIP_MARKER } from '../../github/stacked-test-pr.js';

import type { PrRun } from './types.js';

/**
 * Pure formatters for the markdown blobs we post to GitHub.
 *
 * Kept as standalone functions (no I/O, no logger, no axios) so they can be
 * snapshot-tested cheaply and reused for both the original-PR comment and
 * the stacked test-PR body.
 */

/* -------------------------------------------------------------------- */
/*  Public API                                                           */
/* -------------------------------------------------------------------- */

export interface SummaryInput {
  run: PrRun;
  /** PR title — used for context when the description is empty. */
  prTitle?: string;
  /** URL of the stacked test PR — omitted when no tests were generated. */
  testPrUrl?: string | null;
  /** Number of files included in the stacked PR (may be 0). */
  testPrFileCount?: number;
}

/**
 * Markdown comment posted on the ORIGINAL pull request.
 *
 * Layout (rendered):
 *   [INFO] **OpenReview — Coverage**
 *
 *   | Metric | Before | After |
 *   |---|---|---|
 *   | Diff coverage | 0.0% | 73.5% |
 *
 *   <details>per-file table</details>
 *
 *   Stacked test PR: <url>
 */
export function buildOriginalPRComment(input: SummaryInput): string {
  const { run } = input;
  const lines: string[] = [
    '[INFO] **OpenReview — Coverage**',
    '',
    `Coverage analysis ${describeStatus(run.status)} for PR #${run.prNumber}.`,
    '',
  ];

  const headline = buildCoverageHeadline(run);
  if (headline) {
    lines.push(headline, '');
  }

  if (input.prTitle?.trim()) {
    lines.push(`**${input.prTitle.trim()}**`, '');
  }

  const diffRow = buildDiffCoverageTable(run);
  if (diffRow) {
    lines.push(diffRow, '');
  }

  const filesBlock = buildFileCoverageDetails(run);
  if (filesBlock) {
    lines.push(filesBlock, '');
  }

  if (input.testPrUrl && (input.testPrFileCount ?? 0) > 0) {
    const n = input.testPrFileCount ?? 0;
    lines.push(
      `Generated **${n} test file${n === 1 ? '' : 's'}** \u2192 ${input.testPrUrl}`,
      '',
      '> Merge the stacked PR into this PR\'s feature branch (not into the default branch) to keep the tests with the change they cover.',
    );
  } else if (run.status === 'COMPLETED') {
    lines.push('No new test files were generated for this PR.');
  } else if (run.status === 'FAILED') {
    lines.push('Coverage analysis failed before tests could be generated.');
  }

  lines.push('', '<!-- openreview:coverage -->');
  return lines.join('\n');
}

/** Markdown body for the stacked test PR. */
export function buildTestPRBody(input: SummaryInput & { headRef: string }): string {
  const { run } = input;
  const lines: string[] = [
    `Auto-generated unit tests for **#${run.prNumber}**, produced by the coverage service.`,
    '',
    `**Target branch:** \`${input.headRef}\``,
    '',
  ];

  const diff = buildDiffCoverageTable(run);
  if (diff) lines.push(diff, '');

  const passed = run.generatedTestFiles.filter((t) => t.passed === true).length;
  const failed = run.generatedTestFiles.filter((t) => t.passed === false).length;
  const untested = run.generatedTestFiles.length - passed - failed;
  lines.push(
    `**Generated:** ${run.generatedTestFiles.length} file${
      run.generatedTestFiles.length === 1 ? '' : 's'
    } (passed: ${passed}, failed: ${failed}, untested: ${untested}).`,
    '',
  );

  const fileTable = buildGeneratedFilesTable(run);
  if (fileTable) lines.push(fileTable, '');

  lines.push(
    'Files marked ❌ ran but failed during verification — included so you can inspect and either fix or delete them. Files marked — were never executed (test runner skipped them).',
    '',
    '> Merge this PR *into the feature branch* (not into the default branch).',
    '',
    `<!-- ${OPENREVIEW_SKIP_MARKER} -->`,
    '<!-- openreview:coverage:test-pr -->',
  );
  return lines.join('\n');
}

/* -------------------------------------------------------------------- */
/*  Private helpers                                                      */
/* -------------------------------------------------------------------- */

function describeStatus(status: PrRun['status']): string {
  switch (status) {
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    default:
      return 'finished';
  }
}

function buildCoverageHeadline(run: PrRun): string | null {
  const diffAfter = run.diffCoverageAfter;
  if (diffAfter == null) return null;

  const workflow = run.workflowSummary as
    | { thresholdReached?: boolean; targetCoverage?: number }
    | null
    | undefined;
  const thresholdMet = workflow?.thresholdReached === true;
  const target = workflow?.targetCoverage;

  if (thresholdMet) {
    return `✅ **${diffAfter.toFixed(1)}% diff coverage** · threshold met${target != null ? ` (${target}%)` : ''}`;
  }

  if (target != null && diffAfter < target) {
    return `⚠️ **${diffAfter.toFixed(1)}% diff coverage** · below ${target}% target`;
  }

  return `**${diffAfter.toFixed(1)}% diff coverage**`;
}

function buildDiffCoverageTable(run: PrRun): string | null {
  if (run.diffCoverageBefore == null && run.diffCoverageAfter == null) return null;

  const before = formatPercent(run.diffCoverageBefore);
  const after = formatPercent(run.diffCoverageAfter);
  const delta = formatDelta(run.diffCoverageBefore, run.diffCoverageAfter);

  return [
    '| Metric | Before | After | Delta |',
    '|---|---|---|---|',
    `| Diff coverage | ${before} | ${after} | ${delta} |`,
    ...(run.coverageBefore != null || run.coverageAfter != null
      ? [
          `| Overall coverage | ${formatPercent(run.coverageBefore)} | ${formatPercent(run.coverageAfter)} | ${formatDelta(run.coverageBefore, run.coverageAfter)} |`,
        ]
      : []),
  ].join('\n');
}

function buildGeneratedFilesTable(run: PrRun): string | null {
  if (!run.generatedTestFiles || run.generatedTestFiles.length === 0) return null;

  const rows = run.generatedTestFiles.slice(0, 50).map((t) => {
    const status = t.passed === true ? '✅' : t.passed === false ? '❌' : '—';
    return `| \`${t.filePath}\` | \`${t.targetFile}\` | ${status} |`;
  });
  const more =
    run.generatedTestFiles.length > 50
      ? `\n_+ ${run.generatedTestFiles.length - 50} more files omitted._`
      : '';

  return [
    '| Test file | Covers | Status |',
    '|---|---|---|',
    ...rows,
    more,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function buildFileCoverageDetails(run: PrRun): string | null {
  if (!run.fileCoverage || run.fileCoverage.length === 0) return null;

  const rows = run.fileCoverage
    .slice(0, 50) // bound the comment size
    .map((entry) => {
      const beforeLine = formatPercent(entry.before?.lineCoveragePercent ?? null);
      const afterLine = formatPercent(entry.after?.lineCoveragePercent ?? null);
      const delta = formatDelta(
        entry.before?.lineCoveragePercent ?? null,
        entry.after?.lineCoveragePercent ?? null,
      );
      return `| \`${entry.file}\` | ${beforeLine} | ${afterLine} | ${delta} |`;
    });

  const more =
    run.fileCoverage.length > 50
      ? `\n_+ ${run.fileCoverage.length - 50} more files omitted._`
      : '';

  return [
    '<details><summary>Per-file coverage</summary>',
    '',
    '| File | Before | After | Delta |',
    '|---|---|---|---|',
    ...rows,
    '',
    `${more}</details>`,
  ].join('\n');
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}%`;
}

function formatDelta(
  before: number | null | undefined,
  after: number | null | undefined,
): string {
  if (before == null || after == null || Number.isNaN(before) || Number.isNaN(after)) {
    return '—';
  }
  const delta = after - before;
  if (Math.abs(delta) < 0.05) return '0.0%';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}
