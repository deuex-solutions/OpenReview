import { describe, expect, it } from 'vitest';

import { buildOriginalPRComment, buildTestPRBody } from './summary.js';
import type { PrRun } from './types.js';

const baseRun: PrRun = {
  id: 'run-1',
  repository: 'kenil27/band',
  prNumber: 42,
  status: 'COMPLETED',
  diffCoverageBefore: 0,
  diffCoverageAfter: 73.5,
  coverageBefore: 60,
  coverageAfter: 65.2,
  fileCoverage: [
    {
      file: 'src/a.ts',
      before: { lineCoveragePercent: 50, diffCoveragePercent: null, uncoveredLines: [] },
      after: { lineCoveragePercent: 80, diffCoveragePercent: null, uncoveredLines: [] },
    },
  ],
  generatedTestFiles: [],
};

describe('buildOriginalPRComment', () => {
  it('renders diff coverage table when both numbers are present', () => {
    const out = buildOriginalPRComment({ run: baseRun });
    expect(out).toContain('Diff coverage');
    expect(out).toContain('0.0%');
    expect(out).toContain('73.5%');
    expect(out).toContain('+73.5%'); // delta
  });

  it('includes the test PR link when files were generated', () => {
    const out = buildOriginalPRComment({
      run: baseRun,
      testPrUrl: 'https://github.com/kenil27/band/pull/99',
      testPrFileCount: 3,
    });
    expect(out).toContain('Generated **3 test files**');
    expect(out).toContain('https://github.com/kenil27/band/pull/99');
  });

  it('says "no tests" when run completed without files', () => {
    const out = buildOriginalPRComment({
      run: baseRun,
      testPrUrl: null,
      testPrFileCount: 0,
    });
    expect(out).toContain('No new test files were generated');
  });

  it('shows a failure message when status is FAILED', () => {
    const out = buildOriginalPRComment({
      run: { ...baseRun, status: 'FAILED' },
    });
    expect(out).toContain('Coverage analysis failed');
  });

  it('renders a per-file details block', () => {
    const out = buildOriginalPRComment({ run: baseRun });
    expect(out).toContain('<details>');
    expect(out).toContain('`src/a.ts`');
    expect(out).toContain('+30.0%');
  });

  it('omits diff coverage table when both fields are null', () => {
    const out = buildOriginalPRComment({
      run: { ...baseRun, diffCoverageBefore: null, diffCoverageAfter: null, coverageBefore: null, coverageAfter: null },
    });
    expect(out).not.toContain('Diff coverage');
  });
});

describe('buildTestPRBody', () => {
  it('summarises passed/failed/untested file counts', () => {
    const run: PrRun = {
      ...baseRun,
      generatedTestFiles: [
        { id: '1', filePath: 'a.test.ts', targetFile: 'a.ts', passed: true, fileContent: '' },
        { id: '2', filePath: 'b.test.ts', targetFile: 'b.ts', passed: false, fileContent: '' },
        { id: '3', filePath: 'c.test.ts', targetFile: 'c.ts', passed: null, fileContent: '' },
      ],
    };
    const out = buildTestPRBody({ run, headRef: 'feature/foo', testPrFileCount: 3 });
    expect(out).toContain('passed: 1');
    expect(out).toContain('failed: 1');
    expect(out).toContain('untested: 1');
    expect(out).toContain('feature/foo');
  });

  it('renders a per-file table mapping test file → target file → status', () => {
    const run: PrRun = {
      ...baseRun,
      generatedTestFiles: [
        {
          id: '1',
          filePath: 'tests/cli.test.js',
          targetFile: 'src/cli.js',
          passed: false,
          fileContent: '// content',
        },
        {
          id: '2',
          filePath: 'tests/index.test.js',
          targetFile: 'src/index.js',
          passed: true,
          fileContent: '// content',
        },
        {
          id: '3',
          filePath: 'tests/unknown.test.js',
          targetFile: 'src/unknown.js',
          passed: null,
          fileContent: '// content',
        },
      ],
    };
    const out = buildTestPRBody({ run, headRef: 'feat/foo', testPrFileCount: 3 });
    expect(out).toContain('| Test file | Covers | Status |');
    expect(out).toContain('`tests/cli.test.js`');
    expect(out).toContain('`src/cli.js`');
    expect(out).toContain('❌');
    expect(out).toContain('✅');
    expect(out).toContain('—');
  });

  it('includes the openreview: skip marker so webhooks ignore this PR', () => {
    const out = buildTestPRBody({ run: baseRun, headRef: 'feat/foo', testPrFileCount: 0 });
    expect(out).toContain('<!-- openreview: skip -->');
  });
});
