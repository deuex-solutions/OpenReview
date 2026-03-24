import {
  config,
  runFastReview,
  runRLM,
  validateConfig,
  type RLMEvent,
} from '@openreview/core';
import { Command } from 'commander';

import { printReviewResult } from '../output.js';
import { buildPRSession } from '../pr-context.js';

export function reviewCommand(): Command {
  return new Command('review')
    .description('Run an AI review on a GitHub pull request')
    .requiredOption('--url <url>', 'GitHub PR URL, e.g. https://github.com/org/repo/pull/1')
    .option('--mode <mode>', 'Review mode: fast or rlm', config.defaultReviewMode)
    .option('--output <format>', 'Output: text, markdown, or json', 'text')
    .option('--expert', 'Add SOLID, security, and quality emphasis to the prompt', false)
    .option(
      '--repo <path>',
      'Local clone of the repository (enables linters and loads REVIEW.md-style instructions)',
    )
    .action(async (opts: {
      url: string;
      mode: string;
      output: string;
      expert: boolean;
      repo?: string;
    }) => {
      validateConfig(config);

      const mode = opts.mode === 'rlm' ? 'rlm' : 'fast';
      const output = ['text', 'markdown', 'json'].includes(opts.output) ? opts.output : 'text';

      const { pr, snapshot } = await buildPRSession(opts.url, {
        repoPath: opts.repo,
        expert: Boolean(opts.expert),
      });

      const start = Date.now();

      if (mode === 'rlm') {
        const onEvent =
          opts.output === 'text'
            ? (e: RLMEvent) => {
                console.error(e.message);
              }
            : undefined;
        const findings = await runRLM(pr, snapshot, onEvent);
        printReviewResult(findings, pr.files.length, Date.now() - start, 'rlm', output as 'text' | 'markdown' | 'json');
        return;
      }

      const { findings } = await runFastReview(pr, opts.repo);
      printReviewResult(findings, pr.files.length, Date.now() - start, 'fast', output as 'text' | 'markdown' | 'json');
    });
}
