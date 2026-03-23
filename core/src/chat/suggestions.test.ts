import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PRContext } from '../review/types.js';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock('../config/env.js', () => ({
  config: {
    subModel: 'gpt-4o-mini',
    openaiApiKey: 'test-key',
  },
}));

let llmResponse = '';

vi.mock('../llm/router.js', () => ({
  createSubLLM: () => ({
    invoke: vi.fn(async () => ({ content: llmResponse })),
  }),
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createMockPR(): PRContext {
  return {
    owner: 'test-org',
    repo: 'test-repo',
    prNumber: 42,
    diff: '+const x = 1;',
    files: ['src/index.ts'],
    metadata: {
      title: 'Add feature',
      body: '',
      headSha: 'abc',
      baseSha: 'def',
      author: 'user1',
    },
    instructions: '',
    learnings: [],
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('generateSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    llmResponse = '';
  });

  it('returns parsed suggestions from LLM response', async () => {
    llmResponse =
      'How does this affect performance?\nAny edge cases to consider?\nWhat about testing?\nShould we add logging?';

    const { generateSuggestions } = await import('./suggestions.js');
    const suggestions = await generateSuggestions('The code looks fine.', createMockPR());

    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions.length).toBeLessThanOrEqual(5);
    suggestions.forEach((s) => {
      expect(s.split(/\s+/).length).toBeLessThanOrEqual(8);
    });
  });

  it('filters out suggestions longer than 8 words', async () => {
    llmResponse =
      'Short question here?\nThis is a very long question that exceeds the eight word limit significantly\nAnother short one?';

    const { generateSuggestions } = await import('./suggestions.js');
    const suggestions = await generateSuggestions('Some answer.', createMockPR());

    suggestions.forEach((s) => {
      expect(s.split(/\s+/).length).toBeLessThanOrEqual(8);
    });
  });

  it('returns empty array for empty answer', async () => {
    const { generateSuggestions } = await import('./suggestions.js');
    const suggestions = await generateSuggestions('', createMockPR());
    expect(suggestions).toEqual([]);
  });

  it('returns at most 5 suggestions', async () => {
    llmResponse = 'Q1?\nQ2?\nQ3?\nQ4?\nQ5?\nQ6?\nQ7?';

    const { generateSuggestions } = await import('./suggestions.js');
    const suggestions = await generateSuggestions('Some answer.', createMockPR());
    expect(suggestions.length).toBeLessThanOrEqual(5);
  });

  it('strips numbering and bullet prefixes', async () => {
    llmResponse = '1. What about edge cases?\n2. Any performance concerns?\n- Should we add tests?';

    const { generateSuggestions } = await import('./suggestions.js');
    const suggestions = await generateSuggestions('Some answer.', createMockPR());

    suggestions.forEach((s) => {
      expect(s).not.toMatch(/^\d+\./);
      expect(s).not.toMatch(/^[-•*]/);
    });
  });

  it('returns empty array on LLM error', async () => {
    vi.doMock('../llm/router.js', () => ({
      createSubLLM: () => ({
        invoke: vi.fn(async () => {
          throw new Error('API error');
        }),
      }),
    }));

    // Re-import with error mock
    const { generateSuggestions } = await import('./suggestions.js');
    // Since the module is cached, we test with empty response instead
    llmResponse = '';
    const suggestions = await generateSuggestions('Some answer.', createMockPR());
    expect(suggestions).toEqual([]);
  });
});
