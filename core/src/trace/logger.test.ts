import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewFinding } from '../review/types.js';

import { TraceLogger } from './logger.js';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock('../config/env.js', () => ({
  config: {
    openreviewHome: '/tmp/openreview-test',
  },
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockWriteFileSync = vi.mocked(writeFileSync);
const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createLogger() {
  return new TraceLogger({
    owner: 'test-org',
    repo: 'test-repo',
    prNumber: 42,
    startedAt: '2026-03-23T00:00:00.000Z',
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('TraceLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates traces directory if it does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    createLogger();
    expect(mockMkdirSync).toHaveBeenCalledWith(
      join('/tmp/openreview-test', 'traces'),
      { recursive: true },
    );
  });

  it('generates a trace file with correct naming convention', () => {
    const logger = createLogger();
    const path = logger.getFilePath();
    expect(path).toContain('test-org-test-repo-42');
    expect(path).toContain('/tmp/openreview-test/traces/');
    expect(path.endsWith('.json')).toBe(true);
  });

  it('writes valid JSON on close()', () => {
    const logger = createLogger();
    logger.close(3);

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const [, content] = mockWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed.version).toBe(1);
    expect(parsed.meta.owner).toBe('test-org');
    expect(parsed.meta.prNumber).toBe(42);
    expect(parsed.entries).toBeInstanceOf(Array);
  });

  it('logs fast review entries', () => {
    const logger = createLogger();
    logger.logFastReview(
      { diff: 'some diff', files: ['a.ts', 'b.ts'] },
      { findingsCount: 3, summary: 'Found 3 issues' },
      1500,
    );
    logger.close();

    const [, content] = mockWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    const fastEntry = parsed.entries.find((e: { type: string }) => e.type === 'fast_review');
    expect(fastEntry).toBeDefined();
    expect(fastEntry.data.input.fileCount).toBe(2);
    expect(fastEntry.data.output.findingsCount).toBe(3);
    expect(fastEntry.data.duration).toBe(1500);
  });

  it('logs RLM iteration entries', () => {
    const logger = createLogger();
    logger.logRLMIteration(1, 'Analyzing code...', 'console.log("test")', 'test output');
    logger.close();

    const [, content] = mockWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    const iterEntry = parsed.entries.find((e: { type: string }) => e.type === 'rlm_iteration');
    expect(iterEntry).toBeDefined();
    expect(iterEntry.data.iteration).toBe(1);
    expect(iterEntry.data.reasoning).toBe('Analyzing code...');
    expect(iterEntry.data.code).toBe('console.log("test")');
  });

  it('logs findings entries', () => {
    const logger = createLogger();
    const findings: ReviewFinding[] = [
      {
        id: 'test-1',
        category: 'bug',
        severity: 'severe',
        file: 'src/a.ts',
        startLine: 10,
        endLine: 15,
        title: 'Null dereference',
        explanation: 'x could be null',
        source: 'ai',
        citations: [{ file: 'src/a.ts', startLine: 10, endLine: 15 }],
      },
    ];
    logger.logFindings(findings);
    logger.close();

    const [, content] = mockWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    const findingsEntry = parsed.entries.find((e: { type: string }) => e.type === 'findings');
    expect(findingsEntry).toBeDefined();
    expect(findingsEntry.data.count).toBe(1);
    expect(findingsEntry.data.findings[0].title).toBe('Null dereference');
  });

  it('scrubs secrets from trace content', () => {
    const logger = createLogger();
    logger.logRLMIteration(
      1,
      'Using api_key: sk-abc123456789012345678901234567890',
      'const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"',
      'GITHUB_TOKEN=ghs_abcdefghijklmnopqrstuvwxyz0123456789',
    );
    logger.close();

    const [, content] = mockWriteFileSync.mock.calls[0];
    const text = content as string;
    expect(text).not.toContain('sk-abc');
    expect(text).not.toContain('ghp_abc');
    expect(text).not.toContain('ghs_abc');
    expect(text).toContain('[REDACTED]');
  });

  it('includes metadata entry with total duration and LLM call count', () => {
    const logger = createLogger();
    logger.close(5);

    const [, content] = mockWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    const metaEntry = parsed.entries.find((e: { type: string }) => e.type === 'metadata');
    expect(metaEntry).toBeDefined();
    expect(metaEntry.data.llmCallCount).toBe(5);
    expect(metaEntry.data.totalDuration).toBeGreaterThanOrEqual(0);
  });
});
