import { CommentPoster, GitHubClient, LearningsStore } from '@openreview/core';

import type { GitHubAuth } from '../../github/auth.js';
import type { Logger } from '../../logger.js';
import type { LearningsForgetJob, LearningsListJob } from '../types.js';

/**
 * Reply with the list of stored learnings for the repository.
 */
export async function processLearningsList(
  job: LearningsListJob,
  deps: { auth: GitHubAuth; logger: Logger },
): Promise<void> {
  const log = deps.logger.child({
    job: 'learnings-list',
    repo: `${job.owner}/${job.repo}`,
    prNumber: job.prNumber,
  });

  const token = await deps.auth.getTokenFor(job.owner, job.repo);
  const client = new GitHubClient({ token, owner: job.owner, repo: job.repo });
  const poster = new CommentPoster(client);

  const store = new LearningsStore(`${job.owner}/${job.repo}`);
  const learnings = await store.list();

  if (learnings.length === 0) {
    await poster.postChatReply(job.prNumber, 'No learnings stored for this repository.');
    log.info('no learnings to list');
    return;
  }

  const body = learnings
    .map((l, i) => `${i + 1}. ${l.finding} (used ${l.usedCount}x)`)
    .join('\n');

  await poster.postChatReply(
    job.prNumber,
    `**Team Learnings (${learnings.length}):**\n\n${body}`,
  );
  log.info({ count: learnings.length }, 'listed learnings');
}

/**
 * Delete a learning whose description fuzzily matches `job.description`.
 */
export async function processLearningsForget(
  job: LearningsForgetJob,
  deps: { auth: GitHubAuth; logger: Logger },
): Promise<void> {
  const log = deps.logger.child({
    job: 'learnings-forget',
    repo: `${job.owner}/${job.repo}`,
    prNumber: job.prNumber,
  });

  const token = await deps.auth.getTokenFor(job.owner, job.repo);
  const client = new GitHubClient({ token, owner: job.owner, repo: job.repo });
  const poster = new CommentPoster(client);

  const store = new LearningsStore(`${job.owner}/${job.repo}`);
  const all = await store.list();
  const needle = job.description.toLowerCase();
  const match = all.find((l) => l.finding.toLowerCase().includes(needle));

  if (!match) {
    await poster.postChatReply(
      job.prNumber,
      `No matching learning found for: "${job.description}"`,
    );
    log.info({ needle }, 'no matching learning to forget');
    return;
  }

  await store.delete(match.id);
  await poster.postChatReply(job.prNumber, `[SUCCESS] Forgot: "${match.finding}"`);
  log.info({ id: match.id }, 'learning deleted');
}
