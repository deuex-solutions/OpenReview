import type { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import axios from 'axios';

import { config } from '../config/env.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PRMetadata {
  number: number;
  title: string;
  body: string;
  state: string;
  draft: boolean;
  head: { sha: string; ref: string };
  base: { sha: string; ref: string };
  user: { login: string };
}

export interface PRFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}

export interface GitHubClientOptions {
  token: string;
  owner: string;
  repo: string;
}

/* ------------------------------------------------------------------ */
/*  PR URL parser                                                      */
/* ------------------------------------------------------------------ */

const PR_URL_RE = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

export function parsePRUrl(url: string): { owner: string; repo: string; prNumber: number } {
  const match = PR_URL_RE.exec(url);
  if (!match) {
    throw new Error(`Invalid GitHub PR URL: ${url}`);
  }
  return { owner: match[1], repo: match[2], prNumber: parseInt(match[3], 10) };
}

/* ------------------------------------------------------------------ */
/*  Axios interceptors                                                 */
/* ------------------------------------------------------------------ */

interface RetryConfig extends InternalAxiosRequestConfig {
  _retryCount?: number;
}

function attachRateLimitInterceptor(client: AxiosInstance): void {
  client.interceptors.response.use(undefined, async (error: AxiosError) => {
    if (error.response?.status === 403 && error.response.headers['x-ratelimit-remaining'] === '0') {
      const resetEpoch = Number(error.response.headers['x-ratelimit-reset']);
      const waitMs = Math.max(0, resetEpoch * 1000 - Date.now()) + 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      return client.request(error.config!);
    }
    return Promise.reject(error);
  });
}

function attachRetryInterceptor(client: AxiosInstance, maxRetries = 3): void {
  client.interceptors.response.use(undefined, async (error: AxiosError) => {
    const cfg = error.config as RetryConfig | undefined;
    if (!cfg) return Promise.reject(error);

    const status = error.response?.status ?? 0;
    if (status < 500 || status > 599) return Promise.reject(error);

    cfg._retryCount = (cfg._retryCount ?? 0) + 1;
    if (cfg._retryCount > maxRetries) return Promise.reject(error);

    const delayMs = 2 ** (cfg._retryCount - 1) * 1000;
    await new Promise((r) => setTimeout(r, delayMs));
    return client.request(cfg);
  });
}

/* ------------------------------------------------------------------ */
/*  GitHubClient                                                       */
/* ------------------------------------------------------------------ */

export class GitHubClient {
  private api: AxiosInstance;
  readonly owner: string;
  readonly repo: string;

  constructor(opts: GitHubClientOptions) {
    this.owner = opts.owner;
    this.repo = opts.repo;

    this.api = axios.create({
      baseURL: 'https://api.github.com',
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    attachRateLimitInterceptor(this.api);
    attachRetryInterceptor(this.api);
  }

  /** Create a client using environment config (GITHUB_TOKEN or GITHUB_PAT). */
  static fromConfig(owner: string, repo: string): GitHubClient {
    const token = config.githubToken || config.githubPat;
    if (!token) {
      throw new Error('No GitHub token found. Set GITHUB_TOKEN or GITHUB_PAT.');
    }
    return new GitHubClient({ token, owner, repo });
  }

  /** Create a client from a PR URL string. */
  static fromPRUrl(url: string, token?: string): { client: GitHubClient; prNumber: number } {
    const { owner, repo, prNumber } = parsePRUrl(url);
    const tok = token || config.githubToken || config.githubPat;
    if (!tok) {
      throw new Error('No GitHub token found. Set GITHUB_TOKEN or GITHUB_PAT.');
    }
    return { client: new GitHubClient({ token: tok, owner, repo }), prNumber };
  }

  /* ---- PR metadata ---- */

  async getPR(prNumber: number): Promise<PRMetadata> {
    const { data } = await this.api.get(`/repos/${this.owner}/${this.repo}/pulls/${prNumber}`);
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? '',
      state: data.state,
      draft: data.draft ?? false,
      head: { sha: data.head.sha, ref: data.head.ref },
      base: { sha: data.base.sha, ref: data.base.ref },
      user: { login: data.user.login },
    };
  }

  /* ---- PR files (paginated) ---- */

  async getPRFiles(prNumber: number): Promise<PRFile[]> {
    const files: PRFile[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const { data } = await this.api.get(
        `/repos/${this.owner}/${this.repo}/pulls/${prNumber}/files`,
        { params: { per_page: perPage, page } },
      );

      for (const f of data) {
        files.push({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          changes: f.changes,
          patch: f.patch,
          previous_filename: f.previous_filename,
        });
      }

      if (data.length < perPage) break;
      page++;
    }

    return files;
  }

  /* ---- Raw diff ---- */

  async getPRDiff(prNumber: number): Promise<string> {
    const { data } = await this.api.get(`/repos/${this.owner}/${this.repo}/pulls/${prNumber}`, {
      headers: { Accept: 'application/vnd.github.v3.diff' },
    });
    return data as string;
  }

  /* ---- File content at ref ---- */

  async getFileContent(path: string, ref: string): Promise<string> {
    const { data } = await this.api.get(`/repos/${this.owner}/${this.repo}/contents/${path}`, {
      params: { ref },
      headers: { Accept: 'application/vnd.github.v3.raw' },
    });
    return typeof data === 'string' ? data : JSON.stringify(data);
  }

  /* ---- File tree at ref ---- */

  /* ---- PR / issue comments ---- */

  async getIssueComments(
    prNumber: number,
    perPage = 50,
  ): Promise<Array<{ id: number; user: { login: string }; body: string }>> {
    const { data } = await this.api.get(
      `/repos/${this.owner}/${this.repo}/issues/${prNumber}/comments`,
      { params: { per_page: perPage } },
    );

    // Normalize: guard against deleted users (null user) and null bodies
    return (data as Array<{ id: number; user?: { login: string } | null; body?: string | null }>)
      .filter((c) => c.user != null)
      .map((c) => ({
        id: c.id,
        user: { login: c.user!.login },
        body: c.body ?? '',
      }));
  }

  /* ---- File tree at ref ---- */

  async getFileTree(ref: string): Promise<string[]> {
    const { data } = await this.api.get(`/repos/${this.owner}/${this.repo}/git/trees/${ref}`, {
      params: { recursive: '1' },
    });
    return (data.tree as Array<{ path: string; type: string }>)
      .filter((e) => e.type === 'blob')
      .map((e) => e.path);
  }
}
