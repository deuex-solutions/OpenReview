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
   * Commit generated test files on `branch`.
   *
   * Stacked test PRs target the feature branch (`headRef`) and should only
   * *show* test-file deltas in the PR diff. We always build the commit tree
   * from the current feature tip (`baseSha`) plus test overlays — never
   * re-import an older snapshot of source files.
   *
   * History strategy:
   * - **First push:** single parent = feature tip.
   * - **Refresh, feature unchanged:** single parent = test-branch tip.
   * - **Refresh, feature advanced:** merge commit with parents
   *   `[test-branch tip, feature tip]` so the branch stays aligned with the
   *   feature branch and GitHub's PR diff does not resurrect `.js` changes.
   */
  async commitFiles(opts: {
    branch: string;
    baseSha: string;
    files: ReadonlyArray<{ path: string; content: string }>;
    commitMessage: string;
  }): Promise<{ branchRef: string; commitSha: string } | null> {
    if (opts.files.length === 0) return null;

    const refPath = `heads/${opts.branch}`;
    const fullyQualified = `refs/heads/${opts.branch}`;
    const headSha = opts.baseSha;
    const branchExists = await this.refExists(refPath);

    let parents: string[];
    if (!branchExists) {
      parents = [headSha];
    } else {
      const branchTip = await this.getRefSha(refPath);
      const headMerged =
        branchTip === headSha ||
        (await this.isAncestor(headSha, branchTip));
      parents = headMerged ? [branchTip] : [branchTip, headSha];
    }

    const baseTreeSha = await this.getCommitTreeSha(headSha);

    const blobs = await Promise.all(
      opts.files.map(async (f) => {
        const { data } = await this.api.post(`${this.repoPath}/git/blobs`, {
          content: f.content,
          encoding: 'utf-8',
        });
        return { path: f.path, sha: data.sha as string };
      }),
    );

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

    const { data: newCommit } = await this.api.post(
      `${this.repoPath}/git/commits`,
      {
        message: opts.commitMessage,
        tree: newTree.sha,
        parents,
      },
    );
    const commitSha = newCommit.sha as string;

    if (branchExists) {
      await this.api.patch(`${this.repoPath}/git/refs/${refPath}`, {
        sha: commitSha,
      });
    } else {
      await this.api.post(`${this.repoPath}/git/refs`, {
        ref: fullyQualified,
        sha: commitSha,
      });
    }

    return { branchRef: fullyQualified, commitSha };
  }

  /** Whether `refs/heads/<branch>` already exists (used to pick a commit message). */
  async branchExists(branch: string): Promise<boolean> {
    return this.refExists(`heads/${branch}`);
  }

  /**
   * Open a PR with `head` -> `base`, or refresh title/body on the open one.
   *
   * When a matching open PR exists, its title and body are PATCHed so
   * re-runs after `pull_request.synchronize` show up-to-date coverage stats.
   */
  async openOrUpdatePR(opts: {
    base: string;
    head: string;
    title: string;
    body: string;
  }): Promise<{ url: string; number: number; created: boolean; updated: boolean }> {
    const existing = await this.findOpenPR(opts.head, opts.base);
    if (existing) {
      await this.api.patch(`${this.repoPath}/pulls/${existing.number}`, {
        title: opts.title,
        body: opts.body,
      });
      return {
        url: existing.url,
        number: existing.number,
        created: false,
        updated: true,
      };
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
      updated: false,
    };
  }

  /* ---- Internal helpers --------------------------------------------- */

  private async getRefSha(refPath: string): Promise<string> {
    const { data } = await this.api.get(`${this.repoPath}/git/ref/${refPath}`);
    return data.object.sha as string;
  }

  private async getCommitTreeSha(commitSha: string): Promise<string> {
    const { data } = await this.api.get(
      `${this.repoPath}/git/commits/${commitSha}`,
    );
    return data.tree.sha as string;
  }

  /** True when `ancestorSha` is reachable from `descendantSha` (inclusive). */
  private async isAncestor(
    ancestorSha: string,
    descendantSha: string,
  ): Promise<boolean> {
    if (ancestorSha === descendantSha) return true;
    const { data } = await this.api.get(
      `${this.repoPath}/compare/${ancestorSha}...${descendantSha}`,
    );
    return (data.merge_base_commit?.sha as string | undefined) === ancestorSha;
  }

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
