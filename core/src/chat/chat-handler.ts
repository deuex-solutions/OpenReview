import type { GitHubClient } from '../github/client.js';
import { CommentPoster } from '../github/comments.js';
import { createMainLLM, streamChat } from '../llm/router.js';
import type { SnapshotBuilder } from '../review/snapshot.js';
import type { PRContext } from '../review/types.js';

import { generateSuggestions } from './suggestions.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CommentEvent {
  commentId: number;
  body: string;
  user: string;
  prNumber: number;
}

export interface ChatContext {
  pr: PRContext;
  client: GitHubClient;
  snapshot: SnapshotBuilder;
  botUsername?: string;
}

/* ------------------------------------------------------------------ */
/*  Chat handler                                                       */
/* ------------------------------------------------------------------ */

const MENTION_RE = /@openreview\s*/i;
const BOT_DEFAULT = 'openreview[bot]';

/**
 * Handle an @openreview mention in a PR comment.
 * Extracts the question, builds context, calls LLM, validates citations,
 * and posts the answer as a reply comment with follow-up suggestions.
 */
export async function handleChatMention(
  event: CommentEvent,
  ctx: ChatContext,
): Promise<void> {
  // Detect bot's own comments to prevent reply loops
  const botName = ctx.botUsername ?? BOT_DEFAULT;
  if (event.user.toLowerCase() === botName.toLowerCase()) {
    return;
  }

  // Extract question from comment text
  const question = extractQuestion(event.body);
  if (!question) return;

  // Load conversation thread history
  const threadHistory = await loadThreadHistory(ctx.client, ctx.pr, event.prNumber);

  // Build chat context with snapshot tools
  const messages = buildChatMessages(question, threadHistory, ctx.pr, ctx.snapshot);

  // Call LLM and collect response
  const llm = createMainLLM();
  let answer = '';
  for await (const chunk of streamChat(llm, messages)) {
    answer += chunk;
  }

  // Validate citations in the response
  answer = await validateAnswerCitations(answer, ctx.snapshot);

  // Generate follow-up suggestions
  const suggestions = await generateSuggestions(answer, ctx.pr);

  // Append suggestions as blockquote list
  if (suggestions.length > 0) {
    answer += '\n\n---\n**Suggested follow-ups:**\n';
    answer += suggestions.map((s) => `> - ${s}`).join('\n');
  }

  // Post reply
  const poster = new CommentPoster(ctx.client);
  await poster.postChatReply(event.commentId, answer);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function extractQuestion(body: string): string | null {
  const stripped = body.replace(MENTION_RE, '').trim();
  return stripped.length > 0 ? stripped : null;
}

async function loadThreadHistory(
  client: GitHubClient,
  _pr: PRContext,
  prNumber: number,
): Promise<Array<{ user: string; body: string }>> {
  try {
    const response = await client['api'].get(
      `/repos/${client.owner}/${client.repo}/issues/${prNumber}/comments`,
      { params: { per_page: 50 } },
    );

    return (response.data as Array<{ user: { login: string }; body: string }>).map((c) => ({
      user: c.user.login,
      body: c.body,
    }));
  } catch {
    return [];
  }
}

function buildChatMessages(
  question: string,
  threadHistory: Array<{ user: string; body: string }>,
  pr: PRContext,
  snapshot: SnapshotBuilder,
): Array<{ role: string; content: string }> {
  const systemParts = [
    'You are OpenReview, a codebase-aware AI assistant for code review.',
    'You answer questions about the PR and the codebase.',
    '',
    'You have access to the full codebase via the snapshot. When referencing code,',
    'include file paths and line numbers as citations.',
    '',
    `Repository: ${pr.owner}/${pr.repo}`,
    `PR #${pr.prNumber}: ${pr.metadata.title}`,
    `Author: ${pr.metadata.author}`,
    '',
    'Available files for reference: ' + snapshot.getCachedPaths().join(', '),
  ];

  if (pr.instructions) {
    systemParts.push('', '## Project Instructions', pr.instructions);
  }

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemParts.join('\n') },
  ];

  // Include recent thread history for context
  const recentHistory = threadHistory.slice(-10);
  for (const entry of recentHistory) {
    const role = entry.user.toLowerCase().includes('openreview') ? 'ai' : 'human';
    messages.push({ role, content: entry.body });
  }

  // Add the current question with diff context
  messages.push({
    role: 'human',
    content: `Question: ${question}\n\nDiff for context:\n\`\`\`diff\n${pr.diff}\n\`\`\``,
  });

  return messages;
}

async function validateAnswerCitations(
  answer: string,
  snapshot: SnapshotBuilder,
): Promise<string> {
  // Extract file references like `path/to/file.ts:10`
  const fileRefRe = /`([a-zA-Z0-9_/.@-]+\.[a-zA-Z0-9]+)(?::(\d+))?`/g;
  const referencedFiles = new Set<string>();

  let match;
  while ((match = fileRefRe.exec(answer)) !== null) {
    referencedFiles.add(match[1]);
  }

  // Verify each referenced file actually exists
  const availableFiles = await snapshot.listFiles();
  const fileSet = new Set(availableFiles);

  for (const ref of referencedFiles) {
    if (!fileSet.has(ref)) {
      // Mark invalid references
      answer = answer.replaceAll(`\`${ref}\``, `\`${ref}\` *(file not found)*`);
    }
  }

  return answer;
}
