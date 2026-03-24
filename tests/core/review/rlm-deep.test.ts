import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SnapshotBuilder } from '../../../core/src/review/snapshot.js';
import type { PRContext } from '../../../core/src/review/types.js';
import { executeSandboxed } from '../../../core/src/sandbox/deno-runner.js';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock('../../../core/src/config/env.js', () => ({
  config: {
    maxIterations: 3,
    maxLlmCalls: 5,
    mainModel: 'gpt-4o',
    openaiApiKey: 'test-key',
  },
}));

let llmCallCount = 0;
let llmResponses: Array<string | Array<{ type: string; text: string }>> = [];
let capturedInvokeArgs: Array<Array<{ role: string; content: string }>> = [];

vi.mock('../../../core/src/llm/router.js', () => ({
  createMainLLM: () => ({
    invoke: vi.fn(async (messages: Array<{ role: string; content: string }>) => {
      capturedInvokeArgs.push([...messages]);
      const response = llmResponses[llmCallCount] ?? '[]';
      llmCallCount++;
      return { content: response };
    }),
  }),
}));

vi.mock('../../../core/src/sandbox/deno-runner.js', () => ({
  executeSandboxed: vi.fn(async () => ({
    stdout: 'sandbox output\n',
    stderr: '',
    exitCode: 0,
    duration: 42,
  })),
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createMockPR(overrides: Partial<PRContext> = {}): PRContext {
  return {
    owner: 'test-org',
    repo: 'test-repo',
    prNumber: 99,
    diff: 'diff --git a/src/app.ts b/src/app.ts\n@@ -1,2 +1,4 @@\n+const y = 2;\n',
    files: ['src/app.ts'],
    metadata: {
      title: 'Test PR',
      body: 'A test pull request',
      headSha: 'aaa111',
      baseSha: 'bbb222',
      author: 'dev',
    },
    instructions: '',
    learnings: [],
    ...overrides,
  };
}

function createMockSnapshot(files: Record<string, string> = {}): SnapshotBuilder {
  return {
    getFile: vi.fn(async (path: string) => files[path] ?? null),
    listFiles: vi.fn(async () => Object.keys(files)),
    getCachedPaths: vi.fn(() => Object.keys(files)),
    getTotalBytes: vi.fn(() => 0),
  } as unknown as SnapshotBuilder;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('RLM Deep — extractCodeBlock behavior', () => {
  beforeEach(() => {
    llmCallCount = 0;
    llmResponses = [];
    capturedInvokeArgs = [];
    vi.clearAllMocks();
  });

  it('calls sandbox when LLM returns a code block', async () => {
    llmResponses = [
      '```typescript\nconsole.log("hello");\n```',
      // After sandbox + observe, hits max iterations → finalize
      'finish_review',
      '[]',
    ];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot({ 'src/app.ts': 'const y = 2;\n' });

    await runRLM(pr, snapshot);
    expect(executeSandboxed).toHaveBeenCalled();
  });

  it('skips sandbox when LLM returns no code block', async () => {
    llmResponses = ['I see no issues. finish_review', '[]'];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot();

    await runRLM(pr, snapshot);
    expect(executeSandboxed).not.toHaveBeenCalled();
  });
});

describe('RLM Deep — extractFetchRequests behavior', () => {
  beforeEach(() => {
    llmCallCount = 0;
    llmResponses = [];
    capturedInvokeArgs = [];
    vi.clearAllMocks();
  });

  it('fetches files when LLM outputs FETCH_FILE directives', async () => {
    llmResponses = [
      'I need more context.\nFETCH_FILE: src/utils.ts\nFETCH_FILE: src/helpers.ts\nfinish_review',
      '[]',
    ];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot({
      'src/app.ts': 'const y = 2;\n',
      'src/utils.ts': 'export const util = true;\n',
      'src/helpers.ts': 'export function help() {}\n',
    });

    await runRLM(pr, snapshot);
    expect(snapshot.getFile).toHaveBeenCalledWith('src/utils.ts');
    expect(snapshot.getFile).toHaveBeenCalledWith('src/helpers.ts');
  });

  it('does not re-fetch files already in the snapshot', async () => {
    llmResponses = ['FETCH_FILE: src/app.ts\nfinish_review', '[]'];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot({ 'src/app.ts': 'const y = 2;\n' });

    await runRLM(pr, snapshot);
    // getFile is called once during initial file loading (getCachedPaths),
    // but not a second time for the FETCH_FILE since it's already loaded
    const getFileMock = snapshot.getFile as ReturnType<typeof vi.fn>;
    const fetchCalls = getFileMock.mock.calls.filter((call: string[]) => call[0] === 'src/app.ts');
    // Only the initial pre-load call, not a duplicate from FETCH_FILE
    expect(fetchCalls).toHaveLength(1);
  });
});

describe('RLM Deep — parseRLMFindings behavior', () => {
  beforeEach(() => {
    llmCallCount = 0;
    llmResponses = [];
    capturedInvokeArgs = [];
    vi.clearAllMocks();
  });

  it('handles malformed JSON in finalization gracefully', async () => {
    llmResponses = ['finish_review', 'This is not valid JSON at all { broken ['];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot();

    const findings = await runRLM(pr, snapshot);
    expect(findings).toEqual([]);
  });

  it('handles findings missing required fields', async () => {
    llmResponses = [
      'finish_review',
      JSON.stringify([
        { category: 'bug', severity: 'severe' },
        { file: 'a.ts', startLine: 1 },
        { file: 'b.ts', startLine: 2, title: 'Good', explanation: 'Valid finding' },
      ]),
    ];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot();

    const findings = await runRLM(pr, snapshot);
    // Only the third item has all required fields (file, startLine, title, explanation)
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('b.ts');
  });

  it('parses valid findings with citations', async () => {
    llmResponses = [
      'finish_review',
      JSON.stringify([
        {
          category: 'bug',
          severity: 'severe',
          file: 'src/app.ts',
          startLine: 1,
          endLine: 3,
          title: 'Memory leak',
          explanation: 'Interval is never cleared',
          suggestedFix: 'clearInterval(id);',
          citations: [{ file: 'src/app.ts', startLine: 1, endLine: 3 }],
        },
      ]),
    ];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot();

    const findings = await runRLM(pr, snapshot);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('bug');
    expect(findings[0].severity).toBe('severe');
    expect(findings[0].suggestedFix).toBe('clearInterval(id);');
    expect(findings[0].citations).toEqual([{ file: 'src/app.ts', startLine: 1, endLine: 3 }]);
  });

  it('creates default citation from file/startLine when no citations provided', async () => {
    llmResponses = [
      'finish_review',
      JSON.stringify([
        {
          category: 'flag',
          severity: 'informational',
          file: 'src/app.ts',
          startLine: 5,
          title: 'Style issue',
          explanation: 'Consider using const',
        },
      ]),
    ];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot();

    const findings = await runRLM(pr, snapshot);
    expect(findings).toHaveLength(1);
    expect(findings[0].citations).toEqual([{ file: 'src/app.ts', startLine: 5, endLine: 5 }]);
  });

  it('defaults endLine to startLine when endLine is omitted', async () => {
    llmResponses = [
      'finish_review',
      JSON.stringify([
        {
          category: 'bug',
          severity: 'non-severe',
          file: 'src/app.ts',
          startLine: 7,
          title: 'Off-by-one',
          explanation: 'Index should be length - 1',
        },
      ]),
    ];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot();

    const findings = await runRLM(pr, snapshot);
    expect(findings[0].endLine).toBe(7);
  });

  it('defaults invalid severity to investigate', async () => {
    llmResponses = [
      'finish_review',
      JSON.stringify([
        {
          category: 'bug',
          severity: 'critical',
          file: 'src/app.ts',
          startLine: 1,
          title: 'Issue',
          explanation: 'Some issue',
        },
      ]),
    ];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot();

    const findings = await runRLM(pr, snapshot);
    expect(findings[0].severity).toBe('investigate');
  });

  it('defaults unrecognized category to flag', async () => {
    llmResponses = [
      'finish_review',
      JSON.stringify([
        {
          category: 'warning',
          severity: 'severe',
          file: 'src/app.ts',
          startLine: 1,
          title: 'Issue',
          explanation: 'Some issue',
        },
      ]),
    ];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot();

    const findings = await runRLM(pr, snapshot);
    expect(findings[0].category).toBe('flag');
  });

  it('extracts JSON array embedded in surrounding text', async () => {
    llmResponses = [
      'finish_review',
      'Here are my findings:\n```json\n' +
        JSON.stringify([
          {
            category: 'bug',
            severity: 'severe',
            file: 'src/app.ts',
            startLine: 1,
            title: 'Bug',
            explanation: 'A bug found',
          },
        ]) +
        '\n```\nThat is all.',
    ];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot();

    const findings = await runRLM(pr, snapshot);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('Bug');
  });
});

describe('RLM Deep — edge conditions', () => {
  beforeEach(() => {
    llmCallCount = 0;
    llmResponses = [];
    capturedInvokeArgs = [];
    vi.clearAllMocks();
  });

  it('handles LLM returning non-string content (array)', async () => {
    llmResponses = [
      // Non-string content — will be JSON.stringified by the runner
      [{ type: 'text', text: 'finish_review' }] as unknown as string,
      '[]',
    ];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot();

    // Should not throw — runner handles non-string via JSON.stringify
    const findings = await runRLM(pr, snapshot);
    expect(Array.isArray(findings)).toBe(true);
  });

  it('handles empty diff', async () => {
    llmResponses = ['finish_review', '[]'];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR({ diff: '' });
    const snapshot = createMockSnapshot();

    const findings = await runRLM(pr, snapshot);
    expect(findings).toEqual([]);
  });

  it('injects learnings into the system prompt', async () => {
    llmResponses = ['finish_review', '[]'];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR({
      learnings: ['Always check for null returns', 'Prefer immutable data'],
    });
    const snapshot = createMockSnapshot();

    await runRLM(pr, snapshot);

    // The first LLM call should have the system prompt with learnings
    const firstCall = capturedInvokeArgs[0];
    const systemMsg = firstCall?.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('Always check for null returns');
    expect(systemMsg?.content).toContain('Prefer immutable data');
    expect(systemMsg?.content).toContain('Team Learnings');
  });

  it('injects instructions into the system prompt', async () => {
    llmResponses = ['finish_review', '[]'];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR({
      instructions: 'Focus on security vulnerabilities only.',
    });
    const snapshot = createMockSnapshot();

    await runRLM(pr, snapshot);

    const firstCall = capturedInvokeArgs[0];
    const systemMsg = firstCall?.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('Focus on security vulnerabilities only.');
    expect(systemMsg?.content).toContain('Project Review Instructions');
  });

  it('findings have rlm- prefixed IDs', async () => {
    llmResponses = [
      'finish_review',
      JSON.stringify([
        {
          category: 'bug',
          severity: 'severe',
          file: 'src/app.ts',
          startLine: 1,
          title: 'Issue A',
          explanation: 'Explanation A',
        },
        {
          category: 'flag',
          severity: 'informational',
          file: 'src/app.ts',
          startLine: 5,
          title: 'Issue B',
          explanation: 'Explanation B',
        },
      ]),
    ];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot();

    const findings = await runRLM(pr, snapshot);
    expect(findings).toHaveLength(2);
    for (const f of findings) {
      expect(f.id).toMatch(/^rlm-[a-f0-9]{8}$/);
      expect(f.source).toBe('ai');
    }
  });
});
