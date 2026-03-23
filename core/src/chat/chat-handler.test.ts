import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitHubClient } from '../github/client.js';
import type { SnapshotBuilder } from '../review/snapshot.js';
import type { PRContext } from '../review/types.js';

import type { ChatContext, CommentEvent } from './chat-handler.js';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock('../config/env.js', () => ({
  config: {
    mainModel: 'gpt-4o',
    subModel: 'gpt-4o-mini',
    openaiApiKey: 'test-key',
  },
}));

let streamChunks: string[] = [];

vi.mock('../llm/router.js', () => ({
  createMainLLM: () => ({
    invoke: vi.fn(async () => ({ content: 'mocked response' })),
    stream: vi.fn(),
  }),
  createSubLLM: () => ({
    invoke: vi.fn(async () => ({ content: 'How does this affect performance?\nAny edge cases?' })),
  }),
  streamChat: vi.fn(async function* () {
    for (const chunk of streamChunks) {
      yield chunk;
    }
  }),
}));

let postedReplies: Array<{ prNumber: number; body: string }> = [];

vi.mock('../github/comments.js', () => ({
  CommentPoster: class {
    async postChatReply(prNumber: number, body: string) {
      postedReplies.push({ prNumber, body });
    }
  },
}));

vi.mock('./suggestions.js', () => ({
  generateSuggestions: vi.fn(async () => ['What about edge cases?', 'Any performance concerns?']),
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

function createMockClient(): GitHubClient {
  return {
    owner: 'test-org',
    repo: 'test-repo',
    getIssueComments: vi.fn(async () => []),
  } as unknown as GitHubClient;
}

function createMockSnapshot(): SnapshotBuilder {
  return {
    getFile: vi.fn(async () => ''),
    listFiles: vi.fn(async () => ['src/index.ts']),
    getCachedPaths: vi.fn(() => ['src/index.ts']),
    getTotalBytes: vi.fn(() => 0),
  } as unknown as SnapshotBuilder;
}

function createChatContext(overrides?: Partial<ChatContext>): ChatContext {
  return {
    pr: createMockPR(),
    client: createMockClient(),
    snapshot: createMockSnapshot(),
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('handleChatMention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postedReplies = [];
    streamChunks = ['This is ', 'a test ', 'answer.'];
  });

  it('extracts question and posts a reply using prNumber', async () => {
    const { handleChatMention } = await import('./chat-handler.js');

    const event: CommentEvent = {
      commentId: 123,
      body: '@openreview What does this function do?',
      user: 'developer1',
      prNumber: 42,
    };

    await handleChatMention(event, createChatContext());

    expect(postedReplies).toHaveLength(1);
    expect(postedReplies[0].prNumber).toBe(42);
    expect(postedReplies[0].body).toContain('This is a test answer.');
  });

  it('appends follow-up suggestions to the reply', async () => {
    const { handleChatMention } = await import('./chat-handler.js');

    const event: CommentEvent = {
      commentId: 123,
      body: '@openreview explain this code',
      user: 'developer1',
      prNumber: 42,
    };

    await handleChatMention(event, createChatContext());

    expect(postedReplies).toHaveLength(1);
    expect(postedReplies[0].body).toContain('Suggested follow-ups');
    expect(postedReplies[0].body).toContain('What about edge cases?');
  });

  it('ignores comments from the bot itself to prevent loops', async () => {
    const { handleChatMention } = await import('./chat-handler.js');

    const event: CommentEvent = {
      commentId: 123,
      body: '@openreview testing',
      user: 'openreview[bot]',
      prNumber: 42,
    };

    await handleChatMention(event, createChatContext());

    expect(postedReplies).toHaveLength(0);
  });

  it('ignores comments with custom bot username', async () => {
    const { handleChatMention } = await import('./chat-handler.js');

    const event: CommentEvent = {
      commentId: 123,
      body: '@openreview testing',
      user: 'MyBot',
      prNumber: 42,
    };

    await handleChatMention(event, createChatContext({ botUsername: 'MyBot' }));

    expect(postedReplies).toHaveLength(0);
  });

  it('ignores comments without @openreview mention content', async () => {
    const { handleChatMention } = await import('./chat-handler.js');

    const event: CommentEvent = {
      commentId: 123,
      body: '@openreview',
      user: 'developer1',
      prNumber: 42,
    };

    await handleChatMention(event, createChatContext());

    expect(postedReplies).toHaveLength(0);
  });

  it('loads thread history via public getIssueComments method', async () => {
    const { handleChatMention } = await import('./chat-handler.js');
    const client = createMockClient();

    const event: CommentEvent = {
      commentId: 123,
      body: '@openreview question?',
      user: 'developer1',
      prNumber: 42,
    };

    await handleChatMention(event, createChatContext({ client }));

    expect(client.getIssueComments).toHaveBeenCalledWith(42);
  });

  it('does not post empty reply when LLM returns no chunks', async () => {
    streamChunks = []; // LLM yields nothing

    const { handleChatMention } = await import('./chat-handler.js');

    const event: CommentEvent = {
      commentId: 123,
      body: '@openreview explain this',
      user: 'developer1',
      prNumber: 42,
    };

    await handleChatMention(event, createChatContext());

    expect(postedReplies).toHaveLength(0);
  });
});
