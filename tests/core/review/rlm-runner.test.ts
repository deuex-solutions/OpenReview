import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SnapshotBuilder } from '../../../core/src/review/snapshot.js';
import type { PRContext } from '../../../core/src/review/types.js';

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

// Track LLM invocations
let llmCallCount = 0;
let llmResponses: string[] = [];

vi.mock('../../../core/src/llm/router.js', () => ({
  createMainLLM: () => ({
    invoke: vi.fn(async () => {
      const response = llmResponses[llmCallCount] ?? '[]';
      llmCallCount++;
      return { content: response };
    }),
  }),
}));

vi.mock('../../../core/src/sandbox/deno-runner.js', () => ({
  executeSandboxed: vi.fn(async () => ({
    stdout: 'analysis output\n',
    stderr: '',
    exitCode: 0,
    duration: 50,
  })),
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createMockPR(): PRContext {
  return {
    owner: 'test-org',
    repo: 'test-repo',
    prNumber: 42,
    diff: 'diff --git a/src/index.ts b/src/index.ts\n@@ -1,3 +1,5 @@\n+const x = 1;\n',
    files: ['src/index.ts'],
    metadata: {
      title: 'Add feature X',
      body: 'Description of the feature',
      headSha: 'abc123',
      baseSha: 'def456',
      author: 'testuser',
    },
    instructions: '',
    learnings: [],
  };
}

function createMockSnapshot(files: Record<string, string> = {}): SnapshotBuilder {
  return {
    getFile: vi.fn(async (path: string) => files[path] ?? ''),
    listFiles: vi.fn(async () => Object.keys(files)),
    getCachedPaths: vi.fn(() => Object.keys(files)),
    getTotalBytes: vi.fn(() => 0),
  } as unknown as SnapshotBuilder;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('RLM Runner', () => {
  beforeEach(() => {
    llmCallCount = 0;
    llmResponses = [];
    vi.clearAllMocks();
  });

  it('finishes when LLM outputs finish_review', async () => {
    llmResponses = [
      'I have analyzed the code. finish_review',
      // Finalization response
      JSON.stringify([
        {
          category: 'bug',
          severity: 'severe',
          file: 'src/index.ts',
          startLine: 1,
          endLine: 1,
          title: 'Unused variable',
          explanation: 'Variable x is declared but never used',
        },
      ]),
    ];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot({ 'src/index.ts': 'const x = 1;\n' });

    const findings = await runRLM(pr, snapshot);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('Unused variable');
    expect(findings[0].source).toBe('ai');
    expect(findings[0].id).toMatch(/^rlm-/);
  });

  it('stops after reaching max iterations', async () => {
    // Provide responses for 3 reasoning iterations + finalize
    llmResponses = [
      '```typescript\nconsole.log("check 1");\n```',
      '```typescript\nconsole.log("check 2");\n```',
      '```typescript\nconsole.log("check 3");\n```',
      // Finalization — empty findings
      '[]',
    ];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot({ 'src/index.ts': 'const x = 1;\n' });

    const findings = await runRLM(pr, snapshot);
    expect(findings).toHaveLength(0);
    // Should have called LLM for each iteration + finalize
    expect(llmCallCount).toBeLessThanOrEqual(5);
  });

  it('returns empty findings when LLM returns empty array', async () => {
    llmResponses = ['finish_review', '[]'];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot();

    const findings = await runRLM(pr, snapshot);
    expect(findings).toEqual([]);
  });

  it('streams events to the handler when provided', async () => {
    llmResponses = ['finish_review', '[]'];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot();
    const events: Array<{ type: string; iteration: number }> = [];

    await runRLM(pr, snapshot, (event) => {
      events.push({ type: event.type, iteration: event.iteration });
    });

    expect(events.some((e) => e.type === 'iteration')).toBe(true);
    expect(events.some((e) => e.type === 'finalize')).toBe(true);
  });

  it('parses findings with citations from finalization response', async () => {
    llmResponses = [
      'finish_review',
      JSON.stringify([
        {
          category: 'flag',
          severity: 'investigate',
          file: 'src/utils.ts',
          startLine: 5,
          endLine: 10,
          title: 'Possible race condition',
          explanation: 'Concurrent access without locking',
          citations: [
            { file: 'src/utils.ts', startLine: 5, endLine: 10 },
            { file: 'src/utils.ts', startLine: 15, endLine: 20 },
          ],
        },
      ]),
    ];

    const { runRLM } = await import('../../../core/src/review/rlm-runner.js');
    const pr = createMockPR();
    const snapshot = createMockSnapshot();

    const findings = await runRLM(pr, snapshot);
    expect(findings).toHaveLength(1);
    expect(findings[0].citations).toHaveLength(2);
    expect(findings[0].severity).toBe('investigate');
  });
});
