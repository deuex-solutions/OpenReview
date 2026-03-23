import { config } from '../config/env.js';
import type { GitHubClient } from '../github/client.js';
import type { ParsedDiff } from '../github/diff.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SnapshotOptions {
  client: GitHubClient;
  headRef: string;
  diffs: ParsedDiff[];
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

/* ------------------------------------------------------------------ */
/*  SnapshotBuilder                                                    */
/* ------------------------------------------------------------------ */

/**
 * Hybrid snapshot that pre-loads diff file contents and lazily fetches
 * additional files from the GitHub API on demand. Respects per-file and
 * total byte caps to prevent OOM on large repos.
 */
export class SnapshotBuilder {
  private readonly client: GitHubClient;
  private readonly headRef: string;
  private readonly maxFileBytes: number;
  private readonly maxTotalBytes: number;

  /** In-memory file cache: path → content (empty string for binary files). */
  private readonly cache = new Map<string, string>();

  /** Total bytes fetched so far (across all cached files). */
  private totalBytes = 0;

  /** Lazy-loaded full file tree (null = not yet fetched). */
  private fileTree: string[] | null = null;

  constructor(options: SnapshotOptions) {
    this.client = options.client;
    this.headRef = options.headRef;
    this.maxFileBytes = options.maxFileBytes ?? config.maxFileBytes;
    this.maxTotalBytes = options.maxTotalBytes ?? config.maxTotalBytes;

    // Pre-load diff file paths into cache keys (content loaded lazily)
    for (const diff of options.diffs) {
      if (diff.newPath && !this.cache.has(diff.newPath)) {
        this.cache.set(diff.newPath, '');
      }
    }
  }

  /**
   * Get a file's content. Returns from cache if available, otherwise fetches
   * from GitHub. Returns empty string for binary files or files that exceed
   * the byte limit.
   */
  async getFile(path: string): Promise<string> {
    // Return cached content if we've already fetched it (non-empty)
    const cached = this.cache.get(path);
    if (cached !== undefined && cached.length > 0) {
      return cached;
    }

    // Check total byte budget before fetching
    if (this.totalBytes >= this.maxTotalBytes) {
      return '';
    }

    try {
      const content = await this.client.getFileContent(path, this.headRef);

      // Binary detection: check for null bytes in first 8KB
      if (isBinary(content)) {
        this.cache.set(path, '');
        return '';
      }

      // Per-file byte limit
      if (Buffer.byteLength(content, 'utf-8') > this.maxFileBytes) {
        this.cache.set(path, '');
        return '';
      }

      // Total byte cap
      const contentBytes = Buffer.byteLength(content, 'utf-8');
      if (this.totalBytes + contentBytes > this.maxTotalBytes) {
        this.cache.set(path, '');
        return '';
      }

      this.totalBytes += contentBytes;
      this.cache.set(path, content);
      return content;
    } catch {
      // File not found or inaccessible — return empty
      this.cache.set(path, '');
      return '';
    }
  }

  /**
   * List all files in the repo at the head ref. Lazily fetches the full
   * file tree from GitHub on first call.
   */
  async listFiles(): Promise<string[]> {
    if (this.fileTree !== null) {
      return this.fileTree;
    }

    try {
      this.fileTree = await this.client.getFileTree(this.headRef);
    } catch {
      this.fileTree = [];
    }

    return this.fileTree;
  }

  /** Get all currently cached file paths. */
  getCachedPaths(): string[] {
    return [...this.cache.keys()];
  }

  /** Get total bytes fetched so far. */
  getTotalBytes(): number {
    return this.totalBytes;
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Simple binary detection: look for null bytes in the first 8KB. */
function isBinary(content: string): boolean {
  const sample = content.slice(0, 8192);
  return sample.includes('\0');
}
