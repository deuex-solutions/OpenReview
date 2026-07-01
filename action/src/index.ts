import * as core from '@actions/core';
import * as github from '@actions/github';

import { handleComment } from './comment-handler.js';
import { handlePullRequest } from './pr-handler.js';

async function run(): Promise<void> {
  try {
    const context = github.context;
    const eventName = context.eventName;

    core.info(`Event: ${eventName} | Action: ${context.payload.action}`);

    if (eventName === 'pull_request') {
      const action = context.payload.action;
      const validActions = ['opened', 'synchronize', 'reopened', 'ready_for_review'];

      if (!action || !validActions.includes(action)) {
        core.info(`Skipping pull_request action: ${action}`);
        return;
      }

      await handlePullRequest(context);
    } else if (
      eventName === 'pull_request_review_comment' ||
      eventName === 'issue_comment'
    ) {
      if (context.payload.action !== 'created') {
        core.info(`Skipping comment action: ${context.payload.action}`);
        return;
      }

      await handleComment(context);
    } else {
      core.info(`Unsupported event: ${eventName}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.setFailed(msg);
  }
}

run();
