import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMainLLM } from '../llm/router.js';

import { runFastReview } from './fast-review.js';
import { deduplicateFindings, runLinters } from './linters.js';
import type { PRContext, ReviewFinding } from './types.js';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock('../llm/router.js', () => ({
  createMainLLM: vi.fn(),
}));

vi.mock('./linters.js', () => ({
  runLinters: vi.fn(),
  deduplicateFindings: vi.fn(),
}));

const mockCreateMainLLM = vi.mocked(createMainLLM);
const mockRunLinters = vi.mocked(runLinters);
const mockDeduplicateFindings = vi.mocked(deduplicateFindings);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makePRContext(overrides: Partial<PRContext> = {}): PRContext {
  return {
    owner: 'test-org',
    repo: 'test-repo',
    prNumber: 1,
    diff: `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 line1
+added line
 line3
 line4`,
    files: ['src/index.ts'],
    metadata: {
      title: 'Test PR',
      body: 'Test body',
      headSha: 'abc123',
      baseSha: 'def456',
      author: 'tester',
    },
    instructions: '',
    learnings: [],
    ...overrides,
  };
}

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: 'ai-test1',
    category: 'bug',
    severity: 'severe',
    file: 'src/index.ts',
    startLine: 2,
    endLine: 2,
    title: 'Test finding',
    explanation: 'Test explanation',
    source: 'ai',
    citations: [{ file: 'src/index.ts', startLine: 2, endLine: 2 }],
    ...overrides,
  };
}

function setupLLMResponse(content: string): void {
  const mockLLM = { invoke: vi.fn().mockResolvedValue({ content }) };
  mockCreateMainLLM.mockReturnValue(mockLLM as never);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('runFastReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunLinters.mockResolvedValue([]);
    mockDeduplicateFindings.mockImplementation((aiFindings) => aiFindings);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns findings and summary when LLM returns valid JSON', async () => {
    const llmFindings = [
      {
        category: 'bug',
        severity: 'severe',
        file: 'src/index.ts',
        startLine: 2,
        endLine: 2,
        title: 'Null check missing',
        explanation: 'Variable may be null.',
      },
    ];
    setupLLMResponse(JSON.stringify(llmFindings));

    const { findings, summary } = await runFastReview(makePRContext());

    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('Null check missing');
    expect(findings[0].source).toBe('ai');
    expect(summary).toBeDefined();
    expect(summary.mode).toBe('fast');
  });

  it('runs linters when repoPath is provided', async () => {
    setupLLMResponse('[]');

    await runFastReview(makePRContext(), '/tmp/repo');

    expect(mockRunLinters).toHaveBeenCalledWith(['src/index.ts'], '/tmp/repo');
  });

  it('skips linters when repoPath is not provided', async () => {
    setupLLMResponse('[]');

    await runFastReview(makePRContext());

    expect(mockRunLinters).not.toHaveBeenCalled();
  });

  it('validates citations — filters out findings that do not cite visible diff lines', async () => {
    const llmFindings = [
      {
        category: 'bug',
        severity: 'severe',
        file: 'src/index.ts',
        startLine: 2,
        endLine: 2,
        title: 'Valid — line 2 is added',
        explanation: 'E',
      },
      {
        category: 'bug',
        severity: 'severe',
        file: 'src/index.ts',
        startLine: 100,
        endLine: 100,
        title: 'Invalid — line 100 is not in diff',
        explanation: 'E',
      },
      {
        category: 'bug',
        severity: 'severe',
        file: 'nonexistent.ts',
        startLine: 1,
        endLine: 1,
        title: 'Invalid — file not in diff',
        explanation: 'E',
      },
    ];
    setupLLMResponse(JSON.stringify(llmFindings));

    const { findings } = await runFastReview(makePRContext());

    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('Valid — line 2 is added');
  });

  it('deduplicates with linter findings', async () => {
    const linterFinding = makeFinding({
      id: 'lint-1',
      source: 'linter',
      linterName: 'eslint',
      title: 'Linter finding',
    });
    mockRunLinters.mockResolvedValue([linterFinding]);

    const llmFindings = [
      {
        category: 'bug',
        severity: 'severe',
        file: 'src/index.ts',
        startLine: 2,
        endLine: 2,
        title: 'AI finding',
        explanation: 'E',
      },
    ];
    setupLLMResponse(JSON.stringify(llmFindings));

    await runFastReview(makePRContext(), '/tmp/repo');

    expect(mockDeduplicateFindings).toHaveBeenCalledTimes(1);
    const [aiArg, linterArg] = mockDeduplicateFindings.mock.calls[0];
    expect(aiArg).toHaveLength(1);
    expect(linterArg).toHaveLength(1);
    expect(linterArg[0].linterName).toBe('eslint');
  });

  it('sorts findings by severity', async () => {
    const llmFindings = [
      {
        category: 'flag',
        severity: 'informational',
        file: 'src/index.ts',
        startLine: 2,
        title: 'Info',
        explanation: 'E',
      },
      {
        category: 'bug',
        severity: 'severe',
        file: 'src/index.ts',
        startLine: 2,
        title: 'Severe',
        explanation: 'E',
      },
      {
        category: 'flag',
        severity: 'investigate',
        file: 'src/index.ts',
        startLine: 2,
        title: 'Investigate',
        explanation: 'E',
      },
    ];
    setupLLMResponse(JSON.stringify(llmFindings));

    const { findings } = await runFastReview(makePRContext());

    expect(findings[0].severity).toBe('severe');
    expect(findings[1].severity).toBe('investigate');
    expect(findings[2].severity).toBe('informational');
  });

  it('builds correct summary (filesReviewed, duration, mode, findingsBySeverity)', async () => {
    const llmFindings = [
      {
        category: 'bug',
        severity: 'severe',
        file: 'src/index.ts',
        startLine: 2,
        title: 'A',
        explanation: 'E',
      },
      {
        category: 'flag',
        severity: 'informational',
        file: 'src/index.ts',
        startLine: 2,
        title: 'B',
        explanation: 'E',
      },
    ];
    setupLLMResponse(JSON.stringify(llmFindings));

    const pr = makePRContext({ files: ['src/index.ts', 'src/other.ts'] });
    const { summary } = await runFastReview(pr);

    expect(summary.filesReviewed).toBe(2);
    expect(summary.mode).toBe('fast');
    expect(summary.totalFindings).toBe(2);
    expect(summary.findingsBySeverity.severe).toBe(1);
    expect(summary.findingsBySeverity.informational).toBe(1);
    expect(summary.findingsBySeverity['non-severe']).toBe(0);
    expect(summary.findingsBySeverity.investigate).toBe(0);
    expect(summary.duration).toMatch(/^\d+s$|^\d+m \d+s$/);
  });

  it('returns empty findings when LLM returns []', async () => {
    setupLLMResponse('[]');

    const { findings, summary } = await runFastReview(makePRContext());

    expect(findings).toEqual([]);
    expect(summary.totalFindings).toBe(0);
  });

  it('handles LLM returning non-JSON gracefully', async () => {
    setupLLMResponse('I found no issues in this pull request. Everything looks good!');

    const { findings, summary } = await runFastReview(makePRContext());

    expect(findings).toEqual([]);
    expect(summary.totalFindings).toBe(0);
  });

  it('includes instructions and learnings in prompt when present', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({ content: '[]' });
    mockCreateMainLLM.mockReturnValue({ invoke: mockInvoke } as never);

    const pr = makePRContext({
      instructions: 'Always check for null safety.',
      learnings: ['Avoid using any type', 'Prefer const over let'],
    });

    await runFastReview(pr);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const prompt = mockInvoke.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const systemContent = prompt.find((m) => m.role === 'system')!.content;
    expect(systemContent).toContain('Always check for null safety.');
    expect(systemContent).toContain('Avoid using any type');
    expect(systemContent).toContain('Prefer const over let');
    expect(systemContent).toContain('Team Learnings');
  });
});
