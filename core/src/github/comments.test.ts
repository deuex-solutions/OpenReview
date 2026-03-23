import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewFinding, ReviewSummary } from '../review/types.js';

import type { GitHubClient } from './client.js';
import { CommentPoster } from './comments.js';

vi.mock('../review/formatter.js', () => ({
  formatInlineComment: vi.fn((f: ReviewFinding) => `inline:${f.id}`),
  formatSummaryComment: vi.fn(
    (s: ReviewSummary) => `<!-- openreview-summary -->\nsummary:${s.totalFindings}`,
  ),
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeMockClient() {
  const api = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  };

  const client = {
    owner: 'test-owner',
    repo: 'test-repo',
    api,
  } as unknown as GitHubClient;

  return { client, api };
}

function makeFinding(id: string, file = 'src/index.ts', line = 10): ReviewFinding {
  return {
    id,
    category: 'bug',
    severity: 'severe',
    file,
    startLine: line,
    endLine: line,
    title: `Finding ${id}`,
    explanation: 'Test explanation',
    source: 'ai',
    citations: [],
  };
}

function makeSummary(totalFindings = 3): ReviewSummary {
  return {
    filesReviewed: 5,
    duration: '10s',
    mode: 'fast',
    findingsBySeverity: { severe: 1, 'non-severe': 1, investigate: 1, informational: 0 },
    totalFindings,
  };
}

/* ------------------------------------------------------------------ */
/*  postReview                                                         */
/* ------------------------------------------------------------------ */

describe('postReview', () => {
  let poster: CommentPoster;
  let api: ReturnType<typeof makeMockClient>['api'];

  beforeEach(() => {
    vi.clearAllMocks();
    ({ client: poster, api } = (() => {
      const m = makeMockClient();
      return { client: new CommentPoster(m.client), api: m.api };
    })());
  });

  it('posts batch review with correct endpoint and body', async () => {
    const findings = [makeFinding('f1', 'a.ts', 5), makeFinding('f2', 'b.ts', 12)];
    api.post.mockResolvedValue({ data: {} });

    await poster.postReview(42, findings);

    expect(api.post).toHaveBeenCalledOnce();
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/repos/test-owner/test-repo/pulls/42/reviews');
    expect(body.event).toBe('COMMENT');
    expect(body.comments).toHaveLength(2);
    expect(body.comments[0]).toEqual({
      path: 'a.ts',
      line: 5,
      side: 'RIGHT',
      body: 'inline:f1',
    });
    expect(body.comments[1]).toEqual({
      path: 'b.ts',
      line: 12,
      side: 'RIGHT',
      body: 'inline:f2',
    });
  });

  it('skips when findings is empty', async () => {
    await poster.postReview(42, []);

    expect(api.post).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  postSummaryComment                                                 */
/* ------------------------------------------------------------------ */

describe('postSummaryComment', () => {
  let poster: CommentPoster;
  let api: ReturnType<typeof makeMockClient>['api'];

  beforeEach(() => {
    vi.clearAllMocks();
    const m = makeMockClient();
    poster = new CommentPoster(m.client);
    api = m.api;
  });

  it('creates new comment when no existing summary', async () => {
    // findSummaryComment returns null (no marker found, single page with < 100 results)
    api.get.mockResolvedValue({ data: [] });
    api.post.mockResolvedValue({ data: {} });

    await poster.postSummaryComment(7, makeSummary());

    expect(api.post).toHaveBeenCalledOnce();
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/repos/test-owner/test-repo/issues/7/comments');
    expect(body.body).toContain('<!-- openreview-summary -->');
  });

  it('updates existing comment when marker found', async () => {
    api.get.mockResolvedValue({
      data: [
        { id: 100, body: 'unrelated comment' },
        { id: 200, body: '<!-- openreview-summary -->\nold summary' },
      ],
    });
    api.patch.mockResolvedValue({ data: {} });

    await poster.postSummaryComment(7, makeSummary(5));

    expect(api.patch).toHaveBeenCalledOnce();
    const [url, body] = api.patch.mock.calls[0];
    expect(url).toBe('/repos/test-owner/test-repo/issues/comments/200');
    expect(body.body).toContain('<!-- openreview-summary -->');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('paginates to find existing marker comment', async () => {
    // First page: 100 comments, none with marker
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      body: `comment ${i}`,
    }));
    // Second page: fewer than 100, one has the marker
    const page2 = [
      { id: 201, body: 'another comment' },
      { id: 202, body: '<!-- openreview-summary -->\nold' },
    ];

    api.get.mockResolvedValueOnce({ data: page1 }).mockResolvedValueOnce({ data: page2 });
    api.patch.mockResolvedValue({ data: {} });

    await poster.postSummaryComment(7, makeSummary());

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get.mock.calls[0][1]).toEqual({ params: { per_page: 100, page: 1 } });
    expect(api.get.mock.calls[1][1]).toEqual({ params: { per_page: 100, page: 2 } });
    expect(api.patch).toHaveBeenCalledWith(
      '/repos/test-owner/test-repo/issues/comments/202',
      expect.objectContaining({ body: expect.stringContaining('<!-- openreview-summary -->') }),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  postChatReply                                                      */
/* ------------------------------------------------------------------ */

describe('postChatReply', () => {
  it('posts to correct /issues/{prNumber}/comments endpoint', async () => {
    const { client, api } = makeMockClient();
    const poster = new CommentPoster(client);
    api.post.mockResolvedValue({ data: {} });

    await poster.postChatReply(99, 'Here is my reply');

    expect(api.post).toHaveBeenCalledOnce();
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/repos/test-owner/test-repo/issues/99/comments');
    expect(body).toEqual({ body: 'Here is my reply' });
  });
});

/* ------------------------------------------------------------------ */
/*  postAcknowledgement                                                */
/* ------------------------------------------------------------------ */

describe('postAcknowledgement', () => {
  it('posts standalone comment', async () => {
    const { client, api } = makeMockClient();
    const poster = new CommentPoster(client);
    api.post.mockResolvedValue({ data: {} });

    await poster.postAcknowledgement(15, 'Got it, reviewing now...');

    expect(api.post).toHaveBeenCalledOnce();
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/repos/test-owner/test-repo/issues/15/comments');
    expect(body).toEqual({ body: 'Got it, reviewing now...' });
  });
});
