import * as core from '@actions/core';
import type { Context } from '@actions/github/lib/context.js';
import {
  CommentPoster,
  GitHubClient,
  runFastReview,
} from '@openreview/core';
import type { PRContext } from '@openreview/core';

/**
 * Handle pull_request events: opened, synchronize, reopened, ready_for_review.
 * Runs Fast mode review and posts findings as a batch GitHub review + summary comment.
 */
export async function handlePullRequest(context: Context): Promise<void> {
  const payload = context.payload;
  const pr = payload.pull_request;

  if (!pr) {
    core.warning('No pull_request in payload');
    return;
  }

  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const prNumber = pr.number as number;
  const token = core.getInput('github-token', { required: true });

  core.info(`Processing PR #${prNumber}: ${pr.title}`);

  // Skip draft PRs unless configured
  const reviewDrafts = core.getInput('review-drafts') === 'true';
  if (pr.draft && !reviewDrafts) {
    core.info('Skipping draft PR (set review-drafts: true to enable)');
    return;
  }

  // Skip if PR description contains openreview: skip
  if (typeof pr.body === 'string' && pr.body.includes('openreview: skip')) {
    core.info('Skipping review: PR description contains "openreview: skip"');
    return;
  }

  // Set up env vars from action inputs
  injectInputsToEnv();

  const client = new GitHubClient({ token, owner, repo });
  const poster = new CommentPoster(client);

  // Post acknowledgement
  await poster.postAcknowledgement(
    prNumber,
    '[INFO] **OpenReview** — Review started... results will appear shortly.',
  );

  try {
    const prMeta = await client.getPR(prNumber);
    const files = await client.getPRFiles(prNumber);
    const diff = await client.getPRDiff(prNumber);

    // Check for incremental review
    const maxFiles = parseInt(core.getInput('max-files') || '100', 10);
    if (files.length > maxFiles) {
      core.warning(`PR has ${files.length} files (max: ${maxFiles}). Reviewing first ${maxFiles}.`);
    }

    const prContext: PRContext = {
      owner,
      repo,
      prNumber,
      metadata: {
        title: prMeta.title,
        body: prMeta.body,
        headSha: prMeta.head.sha,
        baseSha: prMeta.base.sha,
        author: prMeta.user.login,
      },
      diff,
      files: files.slice(0, maxFiles).map((f) => f.filename),
      instructions: '',
      learnings: [],
    };

    const { findings, summary } = await runFastReview(prContext);

    const finalSummary = await poster.postReviewResults(prNumber, prContext, findings, summary);

    core.info(
      `Review complete: ${finalSummary.totalFindings} open, ${finalSummary.resolvedCount ?? 0} resolved (${finalSummary.duration})`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.error(`Review failed: ${msg}`);

    // Post error comment so the user knows
    await poster.postAcknowledgement(
      prNumber,
      `[ERROR] **OpenReview** — Review failed: ${msg}`,
    );

    throw err;
  }
}

/**
 * Inject action inputs into process.env so @openreview/core config picks them up.
 */
function injectInputsToEnv(): void {
  const mappings: Array<[string, string]> = [
    ['openai-api-key', 'OPENAI_API_KEY'],
    ['anthropic-api-key', 'ANTHROPIC_API_KEY'],
    ['gemini-api-key', 'GEMINI_API_KEY'],
    ['main-model', 'MAIN_MODEL'],
    ['sub-model', 'SUB_MODEL'],
    ['max-files', 'MAX_FILES'],
    ['review-drafts', 'REVIEW_DRAFTS'],
  ];

  for (const [input, envVar] of mappings) {
    const value = core.getInput(input);
    if (value) {
      process.env[envVar] = value;
    }
  }
}
