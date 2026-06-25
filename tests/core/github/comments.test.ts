import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitHubClient } from '../../../core/src/github/client.js';
import { CommentPoster } from '../../../core/src/github/comments.js';
import type { PRContext, ReviewFinding, ReviewSummary } from '../../../core/src/review/types.js';

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

function makeFinding(id: string, file = 'src/index.ts', line = 10, title = `Finding ${id}`): ReviewFinding {
  return {
    id,
    category: 'bug',
    severity: 'severe',
    file,
    startLine: line,
    endLine: line,
    title,
    explanation: 'Test explanation',
    source: 'ai',
    citations: [],
  };
}

function makeSummary(totalFindings = 1): ReviewSummary {
  return {
    filesReviewed: 5,
    duration: '10s',
    mode: 'fast',
    findingsBySeverity: { severe: totalFindings, 'non-severe': 0, investigate: 0, informational: 0 },
    totalFindings,
  };
}

function makePr(): PRContext {
  return {
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 7,
    diff: '',
    files: ['src/index.ts'],
    metadata: {
      title: 'Test PR',
      body: 'Test body',
      headSha: 'head-sha-2',
      baseSha: 'base-sha',
      author: 'dev',
    },
    instructions: '',
    learnings: [],
  };
}

function encodedState(findings: ReviewFinding[]) {
  const state = {
    version: 1,
    headSha: 'head-sha-1',
    reviewedAt: '2026-01-01T00:00:00.000Z',
    findings: findings.map((f) => ({
      fingerprint: `${f.file}:${f.startLine}:${f.title.toLowerCase()}`,
      category: f.category,
      severity: f.severity,
      file: f.file,
      startLine: f.startLine,
      title: f.title,
    })),
  };
  const payload = Buffer.from(JSON.stringify(state), 'utf-8').toString('base64url');
  return `<!-- openreview-summary -->\n<!-- openreview-state:${payload} -->`;
}

describe('postReviewResults', () => {
  let poster: CommentPoster;
  let api: ReturnType<typeof makeMockClient>['api'];

  beforeEach(() => {
    vi.clearAllMocks();
    const m = makeMockClient();
    poster = new CommentPoster(m.client);
    api = m.api;
  });

  it('posts only new inline comments on a follow-up commit', async () => {
    const previousFinding = makeFinding('old', 'src/a.ts', 5, 'Old issue');
    const newFinding = makeFinding('new', 'src/b.ts', 12, 'New issue');

    api.get.mockResolvedValue({
      data: [{ id: 200, body: encodedState([previousFinding]) }],
    });
    api.post.mockResolvedValue({ data: {} });
    api.patch.mockResolvedValue({ data: {} });

    const summary = await poster.postReviewResults(
      7,
      makePr(),
      [newFinding],
      makeSummary(1),
    );

    expect(api.post).toHaveBeenCalledOnce();
    const [reviewUrl, reviewBody] = api.post.mock.calls[0];
    expect(reviewUrl).toContain('/pulls/7/reviews');
    expect(reviewBody.comments).toHaveLength(1);
    expect(reviewBody.comments[0].path).toBe('src/b.ts');

    expect(summary.resolvedCount).toBe(1);
    expect(summary.newCount).toBe(1);
    expect(api.patch).toHaveBeenCalledOnce();
  });

  it('skips inline review when all findings are unchanged', async () => {
    const finding = makeFinding('same', 'src/a.ts', 5, 'Same issue');

    api.get.mockResolvedValue({
      data: [{ id: 200, body: encodedState([finding]) }],
    });
    api.patch.mockResolvedValue({ data: {} });

    const summary = await poster.postReviewResults(7, makePr(), [finding], makeSummary(1));

    expect(api.post).not.toHaveBeenCalled();
    expect(summary.newCount).toBe(0);
    expect(summary.resolvedCount).toBe(0);
    expect(api.patch).toHaveBeenCalledOnce();
  });
});

describe('postCoverageComment', () => {
  it('creates new comment when no existing coverage marker', async () => {
    const { client, api } = makeMockClient();
    const poster = new CommentPoster(client);
    api.get.mockResolvedValue({ data: [] });
    api.post.mockResolvedValue({ data: {} });

    await poster.postCoverageComment(7, 'Coverage done');

    expect(api.post).toHaveBeenCalledOnce();
    expect(api.post.mock.calls[0][1].body).toContain('<!-- openreview:coverage -->');
  });

  it('updates existing coverage comment when it is already the latest timeline comment', async () => {
    const { client, api } = makeMockClient();
    const poster = new CommentPoster(client);
    api.get
      .mockResolvedValueOnce({
        data: [{ id: 300, body: '<!-- openreview:coverage -->\nold' }],
      })
      .mockResolvedValueOnce({
        data: [{ id: 300, body: '<!-- openreview:coverage -->\nold' }],
      });
    api.patch.mockResolvedValue({ data: {} });

    await poster.postCoverageComment(7, '<!-- openreview:coverage -->\nnew');

    expect(api.patch).toHaveBeenCalledWith(
      '/repos/test-owner/test-repo/issues/comments/300',
      expect.objectContaining({ body: expect.stringContaining('new') }),
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it('posts a new coverage comment when a newer timeline comment exists', async () => {
    const { client, api } = makeMockClient();
    const poster = new CommentPoster(client);
    api.get
      .mockResolvedValueOnce({
        data: [{ id: 400, body: 'some other bot comment' }],
      })
      .mockResolvedValueOnce({
        data: [{ id: 300, body: '<!-- openreview:coverage -->\nold' }],
      });
    api.post.mockResolvedValue({ data: {} });

    await poster.postCoverageComment(7, '<!-- openreview:coverage -->\nnew');

    expect(api.post).toHaveBeenCalledOnce();
    expect(api.patch).not.toHaveBeenCalled();
  });
});

describe('postSummaryComment', () => {
  it('creates new comment when no existing summary', async () => {
    const { client, api } = makeMockClient();
    const poster = new CommentPoster(client);
    api.get.mockResolvedValue({ data: [] });
    api.post.mockResolvedValue({ data: {} });

    await poster.postSummaryComment(7, makeSummary());

    expect(api.post).toHaveBeenCalledOnce();
    expect(api.post.mock.calls[0][1].body).toContain('<!-- openreview-summary -->');
  });

  it('updates the newest summary when it is already the latest timeline comment', async () => {
    const { client, api } = makeMockClient();
    const poster = new CommentPoster(client);
    api.get
      .mockResolvedValueOnce({
        data: [{ id: 300, body: '<!-- openreview-summary -->\nnewest' }],
      })
      .mockResolvedValueOnce({
        data: [{ id: 300, body: '<!-- openreview-summary -->\nnewest' }],
      });
    api.patch.mockResolvedValue({ data: {} });

    await poster.postSummaryComment(7, makeSummary(2));

    expect(api.patch).toHaveBeenCalledWith(
      '/repos/test-owner/test-repo/issues/comments/300',
      expect.objectContaining({ body: expect.stringContaining('<!-- openreview-summary -->') }),
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it('posts a new summary when newer timeline comments exist', async () => {
    const { client, api } = makeMockClient();
    const poster = new CommentPoster(client);
    api.get
      .mockResolvedValueOnce({
        data: [{ id: 400, body: 'Review started...' }],
      })
      .mockResolvedValueOnce({
        data: [
          { id: 300, body: '<!-- openreview-summary -->\nolder summary' },
        ],
      });
    api.post.mockResolvedValue({ data: {} });

    await poster.postSummaryComment(7, makeSummary(2));

    expect(api.post).toHaveBeenCalledOnce();
    expect(api.patch).not.toHaveBeenCalled();
  });
});
