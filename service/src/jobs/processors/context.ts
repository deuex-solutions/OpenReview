import { CommentPoster, GitHubClient } from '@openreview/core';
import type { PRContext } from '@openreview/core';

import type { GitHubAuth } from '../../github/auth.js';
import type { JobBase } from '../types.js';

/**
 * Build the PRContext + GitHub client/poster used by every processor.
 *
 * Centralised so all processors fetch the same shape and a future swap to
 * GitHub App tokens only requires changing `auth.getTokenFor`.
 */
export async function buildPRRuntime(
  job: JobBase,
  auth: GitHubAuth,
): Promise<{
  client: GitHubClient;
  poster: CommentPoster;
  pr: PRContext;
}> {
  const token = await auth.getTokenFor(job.owner, job.repo);
  const client = new GitHubClient({ token, owner: job.owner, repo: job.repo });
  const poster = new CommentPoster(client);

  const meta = await client.getPR(job.prNumber);
  const files = await client.getPRFiles(job.prNumber);
  const diff = await client.getPRDiff(job.prNumber);

  const pr: PRContext = {
    owner: job.owner,
    repo: job.repo,
    prNumber: job.prNumber,
    metadata: {
      title: meta.title,
      body: meta.body,
      headSha: meta.head.sha,
      baseSha: meta.base.sha,
      author: meta.user.login,
    },
    diff,
    files: files.map((f) => f.filename),
    instructions: '',
    learnings: [],
  };

  return { client, poster, pr };
}
