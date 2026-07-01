import type { ChangedFile } from '../types';

export interface CloneOptions {
  repoUrl: string;
  targetDir: string;
  branch?: string;
}

export interface CheckoutPROptions {
  repoDir: string;
  prNumber: number;
  baseBranch: string;
  headBranch: string;
  /** When the PR head is on a fork, the upstream repo (owner/repo) for the base branch. */
  upstreamRepo?: string;
}

export interface RepositoryProvider {
  readonly name: string;
  clone(options: CloneOptions): Promise<void>;
  checkoutPR(options: CheckoutPROptions): Promise<void>;
  getChangedFiles(
    repoDir: string,
    compareRef: string,
    headBranch: string,
  ): Promise<ChangedFile[]>;
  getFileContent(repoDir: string, filePath: string): Promise<string>;
  findExistingTests(
    repoDir: string,
    sourceFile: string,
    framework?: string,
  ): Promise<string[]>;
}
