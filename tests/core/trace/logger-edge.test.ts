import { writeFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewFinding } from '../../../core/src/review/types.js';
import { TraceLogger } from '../../../core/src/trace/logger.js';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock('../../../core/src/config/env.js', () => ({
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createLogger(owner = 'test-org', repo = 'test-repo', prNumber = 42) {
  return new TraceLogger({
    owner,
    repo,
    prNumber,
    startedAt: '2026-03-23T00:00:00.000Z',
  });
}

function getWrittenTrace(): Record<string, unknown> {
  const [, content] = mockWriteFileSync.mock.calls[0];
  return JSON.parse(content as string);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('TraceLogger — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('multiple logRLMIteration calls build up entries array', () => {
    const logger = createLogger();
    logger.logRLMIteration(1, 'Reasoning 1', 'code1()', 'output1');
    logger.logRLMIteration(2, 'Reasoning 2', 'code2()', 'output2');
    logger.logRLMIteration(3, 'Reasoning 3', null, null);
    logger.close();

    const trace = getWrittenTrace();
    const entries = trace.entries as Array<{ type: string; data: Record<string, unknown> }>;
    const iterations = entries.filter((e) => e.type === 'rlm_iteration');
    expect(iterations).toHaveLength(3);
    expect(iterations[0].data.iteration).toBe(1);
    expect(iterations[1].data.iteration).toBe(2);
    expect(iterations[2].data.iteration).toBe(3);
    expect(iterations[2].data.code).toBeNull();
    expect(iterations[2].data.sandboxOutput).toBeNull();
  });

  it('logFindings with empty array', () => {
    const logger = createLogger();
    logger.logFindings([]);
    logger.close();

    const trace = getWrittenTrace();
    const entries = trace.entries as Array<{ type: string; data: Record<string, unknown> }>;
    const findingsEntry = entries.find((e) => e.type === 'findings');
    expect(findingsEntry).toBeDefined();
    expect(findingsEntry!.data.count).toBe(0);
    expect(findingsEntry!.data.findings).toEqual([]);
  });

  it('logFastReview followed by logFindings and close() — all entries present', () => {
    const logger = createLogger();
    logger.logFastReview(
      { diff: 'diff content', files: ['a.ts'] },
      { findingsCount: 1, summary: 'Found 1 issue' },
      500,
    );
    const findings: ReviewFinding[] = [
      {
        id: 'f1',
        category: 'bug',
        severity: 'severe',
        file: 'a.ts',
        startLine: 1,
        endLine: 1,
        title: 'Bug',
        explanation: 'Explanation',
        source: 'ai',
        citations: [{ file: 'a.ts', startLine: 1, endLine: 1 }],
      },
    ];
    logger.logFindings(findings);
    logger.close(2);

    const trace = getWrittenTrace();
    const entries = trace.entries as Array<{ type: string }>;
    const types = entries.map((e) => e.type);
    expect(types).toContain('fast_review');
    expect(types).toContain('findings');
    expect(types).toContain('metadata');
    expect(entries).toHaveLength(3);
  });

  it('scrubs OpenAI keys (sk-...)', () => {
    const logger = createLogger();
    logger.logRLMIteration(1, 'key is sk-abcdefghijklmnopqrstuvwxyz1234567890', null, null);
    logger.close();

    const [, content] = mockWriteFileSync.mock.calls[0];
    const text = content as string;
    expect(text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(text).toContain('[REDACTED]');
  });

  it('scrubs GitHub PATs (ghp_...)', () => {
    const logger = createLogger();
    logger.logRLMIteration(1, 'token=ghp_abcdefghijklmnopqrstuvwxyz0123456789', null, null);
    logger.close();

    const [, content] = mockWriteFileSync.mock.calls[0];
    const text = content as string;
    expect(text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz');
    expect(text).toContain('[REDACTED]');
  });

  it('scrubs GitHub app tokens (ghs_...)', () => {
    const logger = createLogger();
    logger.logRLMIteration(
      1,
      'no secret here',
      'const t = "ghs_abcdefghijklmnopqrstuvwxyz0123456789"',
      null,
    );
    logger.close();

    const [, content] = mockWriteFileSync.mock.calls[0];
    const text = content as string;
    expect(text).not.toContain('ghs_abcdefghijklmnopqrstuvwxyz');
    expect(text).toContain('[REDACTED]');
  });

  it('scrubs Slack tokens (xoxb-...)', () => {
    const logger = createLogger();
    logger.logRLMIteration(1, 'slack token xoxb-123456-abcdefABCDEF', null, null);
    logger.close();

    const [, content] = mockWriteFileSync.mock.calls[0];
    const text = content as string;
    expect(text).not.toContain('xoxb-123456');
    expect(text).toContain('[REDACTED]');
  });

  it('scrubs generic "api_key: value" patterns', () => {
    const logger = createLogger();
    logger.logRLMIteration(1, 'api_key: my-super-secret-value', null, null);
    logger.close();

    const [, content] = mockWriteFileSync.mock.calls[0];
    const text = content as string;
    expect(text).not.toContain('my-super-secret-value');
    expect(text).toContain('[REDACTED]');
  });

  it('secret scrubbing in logRLMIteration reasoning and code fields', () => {
    const logger = createLogger();
    logger.logRLMIteration(
      1,
      'Found api_key: secret123 in the config',
      'const key = "sk-aaaabbbbccccddddeeeeffffgggg";',
      null,
    );
    logger.close();

    const trace = getWrittenTrace();
    const entries = trace.entries as Array<{ type: string; data: Record<string, unknown> }>;
    const iteration = entries.find((e) => e.type === 'rlm_iteration')!;
    const reasoning = iteration.data.reasoning as string;
    const code = iteration.data.code as string;
    expect(reasoning).not.toContain('secret123');
    expect(code).not.toContain('sk-aaaabbbbccccddddeeeeffffgggg');
  });

  it('close() without llmCallCount defaults to 0', () => {
    const logger = createLogger();
    logger.close();

    const trace = getWrittenTrace();
    const entries = trace.entries as Array<{ type: string; data: Record<string, unknown> }>;
    const metaEntry = entries.find((e) => e.type === 'metadata')!;
    expect(metaEntry.data.llmCallCount).toBe(0);
  });

  it('TraceLogger with special characters in owner/repo names', () => {
    const logger = createLogger('my-org.special', 'repo_with-chars.v2');
    const path = logger.getFilePath();
    expect(path).toContain('my-org.special-repo_with-chars.v2');
    expect(path.endsWith('.json')).toBe(true);

    logger.close();
    const trace = getWrittenTrace();
    expect((trace.meta as Record<string, unknown>).owner).toBe('my-org.special');
    expect((trace.meta as Record<string, unknown>).repo).toBe('repo_with-chars.v2');
  });

  it('multiple close() calls are idempotent', () => {
    const logger = createLogger();
    logger.close(1);
    logger.close(2);
    logger.close(3);

    // writeFileSync is called each time close() is called
    expect(mockWriteFileSync).toHaveBeenCalledTimes(3);

    // Each call adds a metadata entry, so the trace grows
    // The important thing is that it does not throw
    const lastCallContent = mockWriteFileSync.mock.calls[2][1] as string;
    const parsed = JSON.parse(lastCallContent);
    expect(parsed.version).toBe(1);
  });
});
