import {
  GitHubClient,
  LearningsStore,
  SnapshotBuilder,
  config,
  filterDiffs,
  loadInstructions,
  parseDiff,
} from '@openreview/core';
import type { PRContext } from '@openreview/core';

const EXPERT_INSTRUCTIONS = `
## Expert review mode
Emphasize SOLID principles, security (injection, authentication/authorization, secrets exposure, OWASP-style risks), and code quality (error handling, edge cases, performance, naming, duplication).
`.trim();

export interface BuiltPRSession {
  pr: PRContext;
  client: GitHubClient;
  snapshot: SnapshotBuilder;
}

export async function buildPRSession(
  prUrl: string,
  options: { repoPath?: string; expert?: boolean } = {},
): Promise<BuiltPRSession> {
  const { client, prNumber } = GitHubClient.fromPRUrl(prUrl);
  const { owner, repo } = client;

  const meta = await client.getPR(prNumber);
  if (meta.draft && !config.reviewDrafts) {
    throw new Error(
      'This PR is a draft. Set REVIEW_DRAFTS=true in your environment to review draft PRs.',
    );
  }

  const diffRaw = await client.getPRDiff(prNumber);

  let parsedDiffs = filterDiffs(parseDiff(diffRaw));
  if (parsedDiffs.length > config.maxFiles) {
    parsedDiffs = parsedDiffs.slice(0, config.maxFiles);
  }

  const files = parsedDiffs.map((d) => d.file);

  let instructions = '';
  if (options.repoPath) {
    const loaded = await loadInstructions(options.repoPath);
    instructions = loaded.globalInstructions;
  }

  if (options.expert) {
    instructions = instructions ? `${instructions}\n\n${EXPERT_INSTRUCTIONS}` : EXPERT_INSTRUCTIONS;
  }

  const store = new LearningsStore(`${owner}/${repo}`);
  const stored = await store.getAll();
  const learnings = stored.map((l) => l.finding);

  const pr: PRContext = {
    owner,
    repo,
    prNumber,
    diff: diffRaw,
    files,
    metadata: {
      title: meta.title,
      body: meta.body,
      headSha: meta.head.sha,
      baseSha: meta.base.sha,
      author: meta.user.login,
    },
    instructions,
    learnings,
  };

  const snapshot = new SnapshotBuilder({
    client,
    headRef: meta.head.sha,
    diffs: parsedDiffs,
  });

  return { pr, client, snapshot };
}
