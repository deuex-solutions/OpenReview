import { SnapshotBuilder, handleChatMention, parseDiff } from '@openreview/core';

import type { GitHubAuth } from '../../github/auth.js';
import type { Logger } from '../../logger.js';
import type { ChatJob } from '../types.js';

import { buildPRRuntime } from './context.js';

/**
 * Process an `@openreview <question>` comment via the chat handler.
 */
export async function processChat(
  job: ChatJob,
  deps: { auth: GitHubAuth; logger: Logger },
): Promise<void> {
  const log = deps.logger.child({
    job: 'chat',
    repo: `${job.owner}/${job.repo}`,
    prNumber: job.prNumber,
    commentId: job.commentId,
  });

  log.info({ question: job.question.slice(0, 80) }, 'handling chat mention');

  const { client, pr } = await buildPRRuntime(job, deps.auth);

  const snapshot = new SnapshotBuilder({
    client,
    headRef: pr.metadata.headSha,
    diffs: parseDiff(pr.diff),
  });

  await handleChatMention(
    {
      commentId: job.commentId,
      body: job.question,
      user: job.user,
      prNumber: job.prNumber,
    },
    {
      pr,
      client,
      snapshot,
      botUsername: 'openreview[bot]',
    },
  );

  log.info('chat reply posted');
}
