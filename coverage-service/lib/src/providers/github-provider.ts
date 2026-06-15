import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from 'path';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { ChangedFile } from '../types';
import {
  CheckoutPROptions,
  CloneOptions,
  RepositoryProvider,
} from './repository-provider';

const execFileAsync = promisify(execFile);

export type GitHubAuthMode = 'app' | 'pat';

export interface GitHubProviderConfig {
  authMode: GitHubAuthMode;
  pat?: string;
  appId?: string;
  privateKey?: string;
  installationId?: string;
}

export class GitHubProvider implements RepositoryProvider {
  readonly name = 'github';
  private octokit: Octokit | null = null;

  constructor(private readonly config: GitHubProviderConfig) {}

  private async getOctokit(): Promise<Octokit> {
    if (this.octokit) return this.octokit;

    if (this.config.authMode === 'app') {
      if (
        !this.config.appId ||
        !this.config.privateKey ||
        !this.config.installationId
      ) {
        throw new Error(
          'GitHub App auth requires appId, privateKey, and installationId',
        );
      }
      const auth = createAppAuth({
        appId: this.config.appId,
        privateKey: this.config.privateKey.replace(/\\n/g, '\n'),
        installationId: parseInt(this.config.installationId, 10),
      });
      this.octokit = new Octokit({ auth: (await auth({ type: 'installation' })).token });
    } else {
      if (!this.config.pat) {
        throw new Error('PAT auth requires GITHUB_PAT');
      }
      this.octokit = new Octokit({ auth: this.config.pat });
    }

    return this.octokit;
  }

  private async getCloneUrl(repoUrl: string): Promise<string> {
    if (this.config.authMode === 'pat' && this.config.pat) {
      const url = new URL(repoUrl.replace('git@github.com:', 'https://github.com/'));
      url.username = 'x-access-token';
      url.password = this.config.pat;
      return url.toString();
    }

    const octokit = await this.getOctokit();
    const match = repoUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (!match) return repoUrl;

    const [owner, repo] = match[1].split('/');
    const { data } = await octokit.rest.apps.createInstallationAccessToken({
      installation_id: parseInt(this.config.installationId!, 10),
    });

    const url = new URL(`https://github.com/${owner}/${repo}.git`);
    url.username = 'x-access-token';
    url.password = data.token;
    return url.toString();
  }

  async getPullRequest(
    githubRepo: string,
    prNumber: number,
  ): Promise<{
    number: number;
    headBranch: string;
    headSha: string;
    headRepo: string;
    baseBranch: string;
  }> {
    const [owner, repo] = githubRepo.split('/');
    const octokit = await this.getOctokit();
    const { data } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    return {
      number: data.number,
      headBranch: data.head.ref,
      headSha: data.head.sha,
      headRepo: data.head.repo?.full_name ?? `${owner}/${repo}`,
      baseBranch: data.base.ref,
    };
  }

  async clone(options: CloneOptions): Promise<void> {
    const cloneUrl = await this.getCloneUrl(options.repoUrl);
    const args = ['clone', '--depth', '1'];
    if (options.branch) {
      args.push('--branch', options.branch);
    }
    args.push(cloneUrl, options.targetDir);

    await this.runGit(args);
  }

  async checkoutPR(options: CheckoutPROptions): Promise<void> {
    const { repoDir, baseBranch, headBranch, upstreamRepo } = options;

    if (upstreamRepo) {
      const upstreamUrl = await this.getCloneUrl(
        `https://github.com/${upstreamRepo}.git`,
      );
      await this.runGit(['remote', 'add', 'upstream', upstreamUrl], repoDir);
      await this.runGit(
        this.fetchBranchArgs('upstream', baseBranch, '--depth', '1'),
        repoDir,
      );
    } else {
      await this.runGit(
        this.fetchBranchArgs('origin', baseBranch, '--depth', '1'),
        repoDir,
      );
    }

    await this.runGit(
      this.fetchBranchArgs('origin', headBranch, '--depth', '1'),
      repoDir,
    );
    await this.runGit(['checkout', headBranch], repoDir);

    const baseRef = upstreamRepo
      ? `upstream/${baseBranch}`
      : `origin/${baseBranch}`;
    await this.ensureMergeBase(repoDir, baseRef, 'HEAD', headBranch);
  }

  /** Fetch a branch and update its remote-tracking ref (required for merge-base). */
  private fetchBranchArgs(
    remote: string,
    branch: string,
    depthFlag: '--depth' | '--deepen',
    depth: string,
  ): string[] {
    return [
      'fetch',
      remote,
      `${branch}:refs/remotes/${remote}/${branch}`,
      depthFlag,
      depth,
    ];
  }

  /** Deepen shallow fetches until git can compute a merge base for diff-cover. */
  private async ensureMergeBase(
    repoDir: string,
    baseRef: string,
    headRef = 'HEAD',
    headBranch?: string,
  ): Promise<void> {
    if (await this.hasMergeBase(repoDir, baseRef, headRef)) return;

    const [remote, ...branchParts] = baseRef.split('/');
    const baseBranch = branchParts.join('/');

    for (let attempt = 0; attempt < 50; attempt++) {
      await this.runGit(['fetch', '--deepen', '50'], repoDir);
      try {
        await this.runGit(
          this.fetchBranchArgs(remote, baseBranch, '--deepen', '50'),
          repoDir,
        );
      } catch {
        // Base branch may only exist on a different remote.
      }
      if (headBranch) {
        try {
          await this.runGit(
            this.fetchBranchArgs('origin', headBranch, '--deepen', '50'),
            repoDir,
          );
        } catch {
          // Head branch may only exist on a fork remote.
        }
      }
      if (await this.hasMergeBase(repoDir, baseRef, headRef)) return;
    }

    throw new Error(
      `No merge base between ${baseRef} and ${headRef} after deepening shallow clone`,
    );
  }

  private async hasMergeBase(
    repoDir: string,
    refA: string,
    refB: string,
  ): Promise<boolean> {
    try {
      await execFileAsync('git', ['merge-base', refA, refB], { cwd: repoDir });
      return true;
    } catch {
      return false;
    }
  }

  async getChangedFiles(
    repoDir: string,
    compareRef: string,
    headBranch: string,
  ): Promise<ChangedFile[]> {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--name-status', `${compareRef}...${headBranch}`],
      { cwd: repoDir },
    );

    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [status, ...rest] = line.split('\t');
        const path = rest[rest.length - 1];
        const mappedStatus =
          status === 'A'
            ? 'added'
            : status === 'D'
              ? 'deleted'
              : status.startsWith('R')
                ? 'renamed'
                : 'modified';
        return { path, status: mappedStatus as ChangedFile['status'] };
      });
  }

  async getFileContent(repoDir: string, filePath: string): Promise<string> {
    const fullPath = join(repoDir, filePath);
    if (!existsSync(fullPath)) return '';
    const { readFile } = await import('fs/promises');
    return readFile(fullPath, 'utf-8');
  }

  async findExistingTests(
    repoDir: string,
    sourceFile: string,
  ): Promise<string[]> {
    const { readdir } = await import('fs/promises');
    const baseName = sourceFile.replace(/\.[^.]+$/, '');
    const dir = join(repoDir, sourceFile.split('/').slice(0, -1).join('/'));
    const patterns = [
      `${baseName}.test.ts`,
      `${baseName}.spec.ts`,
      `${baseName}.test.js`,
      `${baseName}.spec.js`,
      `test_${baseName.split('/').pop()}.py`,
    ];

    const results: string[] = [];
    for (const pattern of patterns) {
      const full = join(dir, pattern.split('/').pop()!);
      if (existsSync(full)) results.push(full);
    }

    try {
      const entries = await readdir(join(repoDir, 'test'), { recursive: true });
      for (const entry of entries) {
        const name = String(entry);
        if (
          name.includes(baseName.split('/').pop()!) &&
          (name.endsWith('.test.ts') ||
            name.endsWith('.spec.ts') ||
            name.startsWith('test_'))
        ) {
          results.push(join(repoDir, 'test', name));
        }
      }
    } catch {
      // no test directory
    }

    try {
      const entries = await readdir(join(repoDir, 'tests'), { recursive: true });
      for (const entry of entries) {
        const name = String(entry);
        if (
          name.includes(baseName.split('/').pop()!) &&
          (name.endsWith('.test.ts') ||
            name.endsWith('.spec.ts') ||
            name.startsWith('test_'))
        ) {
          results.push(join(repoDir, 'tests', name));
        }
      }
    } catch {
      // no tests directory
    }

    return results;
  }

  private async runGit(args: string[], cwd?: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('git', args, { cwd, stdio: 'pipe' });
      let stderr = '';
      proc.stderr.on('data', (d) => (stderr += d.toString()));
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`git ${args.join(' ')} failed: ${stderr}`));
      });
    });
  }
}
