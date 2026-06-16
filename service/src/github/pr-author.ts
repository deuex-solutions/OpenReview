import type { GitHubClient } from '@openreview/core';
import type { AxiosInstance } from 'axios';

/**
 * Write-side GitHub helper. The read-side {@link GitHubClient} from
 * `@openreview/core` only fetches PRs / files / diffs; this class layers on
 * the Git Data API endpoints needed to author a new PR.
 *
 * It is intentionally split out of core because:
 *   1. Authoring is service-only behaviour (the CLI and GitHub Action
 *      never need it).
 *   2. The Git Data API is verbose enough that mixing it into
 *      {@link GitHubClient} would noticeably enlarge that class.
 *
 * All endpoints reuse the configured axios instance on {@link GitHubClient}
 * (with retry / rate-limit / auth interceptors) by reaching through the
 * `['api']` index-property — the same pattern `CommentPoster` uses.
 */
export class PRAuthor {
  constructor(private readonly client: GitHubClient) {}

  private get api(): AxiosInstance {
    // `api` is `private` on GitHubClient; bracket access is the same escape
    // hatch CommentPoster uses (see core/src/github/comments.ts).
    return (this.client as unknown as { api: AxiosInstance }).api;
  }

  private get repoPath(): string {
    return `/repos/${this.client.owner}/${this.client.repo}`;
  }

  /**
   * Commit one or more files atomically on top of `baseSha`, creating or
   * fast-forwarding `branch` to point at the new commit.
   *
   * Empty `files` is a no-op that returns `null` so the caller can decide
   * whether to skip PR creation.
   */
  async commitFiles(opts: {
    branch: string;
    baseSha: string;
    files: ReadonlyArray<{ path: string; content: string }>;
    commitMessage: string;
  }): Promise<{ branchRef: string; commitSha: string } | null> {
    if (opts.files.length === 0) return null;

    // 1) Resolve the tree SHA at baseSha so we can extend it.
    const { data: baseCommit } = await this.api.get(
      `${this.repoPath}/git/commits/${opts.baseSha}`,
    );
    const baseTreeSha = baseCommit.tree.sha as string;

    // 2) Upload each file as a blob.
    const blobs = await Promise.all(
      opts.files.map(async (f) => {
        const { data } = await this.api.post(`${this.repoPath}/git/blobs`, {
          content: f.content,
          encoding: 'utf-8',
        });
        return { path: f.path, sha: data.sha as string };
      }),
    );

    // 3) Build a new tree referencing the new blobs.
    const { data: newTree } = await this.api.post(
      `${this.repoPath}/git/trees`,
      {
        base_tree: baseTreeSha,
        tree: blobs.map((b) => ({
          path: b.path,
          mode: '100644',
          type: 'blob',
          sha: b.sha,
        })),
      },
    );

    // 4) Create the commit pointing at the new tree, parented on baseSha.
    const { data: newCommit } = await this.api.post(
      `${this.repoPath}/git/commits`,
      {
        message: opts.commitMessage,
        tree: newTree.sha,
        parents: [opts.baseSha],
      },
    );
    const commitSha = newCommit.sha as string;

    // 5) Create the branch ref, or fast-forward an existing one.
    const refPath = `heads/${opts.branch}`;
    const fullyQualified = `refs/heads/${opts.branch}`;
    const exists = await this.refExists(refPath);
    if (exists) {
      await this.api.patch(`${this.repoPath}/git/refs/${refPath}`, {
        sha: commitSha,
        force: true,
      });
    } else {
      await this.api.post(`${this.repoPath}/git/refs`, {
        ref: fullyQualified,
        sha: commitSha,
      });
    }

    return { branchRef: fullyQualified, commitSha };
  }

  /**
   * Open a PR with `head` -> `base`, or return the open one if it exists.
   * The {@link created} flag tells the caller whether to post a fresh
   * "tests generated" comment or to skip it.
   */
  async openOrUpdatePR(opts: {
    base: string;
    head: string;
    title: string;
    body: string;
  }): Promise<{ url: string; number: number; created: boolean }> {
    const existing = await this.findOpenPR(opts.head, opts.base);
    if (existing) {
      return { url: existing.url, number: existing.number, created: false };
    }

    const { data } = await this.api.post(`${this.repoPath}/pulls`, {
      title: opts.title,
      head: opts.head,
      base: opts.base,
      body: opts.body,
      maintainer_can_modify: true,
    });
    return {
      url: data.html_url as string,
      number: data.number as number,
      created: true,
    };
  }

  /* ---- Internal helpers --------------------------------------------- */

  private async refExists(refPath: string): Promise<boolean> {
    try {
      await this.api.get(`${this.repoPath}/git/ref/${refPath}`);
      return true;
    } catch (err) {
      if (isAxiosNotFound(err)) return false;
      throw err;
    }
  }

  private async findOpenPR(
    head: string,
    base: string,
  ): Promise<{ url: string; number: number } | null> {
    const { data } = await this.api.get(`${this.repoPath}/pulls`, {
      params: {
        head: `${this.client.owner}:${head}`,
        base,
        state: 'open',
        per_page: 1,
      },
    });
    if (!Array.isArray(data) || data.length === 0) return null;
    const pr = data[0];
    return { url: pr.html_url as string, number: pr.number as number };
  }
}

function isAxiosNotFound(err: unknown): boolean {
  // We can't rely on `axios.isAxiosError` here without importing axios — the
  // shape check is enough since the core client always uses axios.
  if (typeof err !== 'object' || err === null) return false;
  const maybeStatus = (err as { response?: { status?: number } }).response
    ?.status;
  // The core auth interceptor wraps 404 into a richer Error before it reaches
  // us, so also match on the wrapped message.
  if (maybeStatus === 404) return true;
  const msg = err instanceof Error ? err.message : '';
  return /\b404\b/.test(msg);
}
