import {
  config,
  createMainLLM,
  streamChat,
  validateConfig,
} from '@openreview/core';
import { Command } from 'commander';

import { buildPRSession } from '../pr-context.js';

export function askCommand(): Command {
  return new Command('ask')
    .description('Ask a codebase-aware question about a PR (read-only; does not post to GitHub)')
    .requiredOption('--url <url>', 'GitHub PR URL')
    .option('--repo <path>', 'Local clone for instruction files (REVIEW.md, etc.)')
    .argument('[words...]', 'Your question')
    .action(async (words: string[], opts: { url: string; repo?: string }) => {
      validateConfig(config);

      const question = words.join(' ').trim();
      if (!question) {
        throw new Error('Provide a question after the options, e.g. openreview ask --url <PR> what does this PR change?');
      }

      const { pr } = await buildPRSession(opts.url, { repoPath: opts.repo });

      const systemParts = [
        'You are OpenReview, a codebase-aware assistant for pull request review.',
        'Answer concisely. When referencing code, use backticks with path:line format.',
        '',
        `Repository: ${pr.owner}/${pr.repo}`,
        `PR #${pr.prNumber}: ${pr.metadata.title}`,
        `Author: ${pr.metadata.author}`,
        '',
        'Changed files in this PR: ' + pr.files.join(', '),
      ];

      if (pr.instructions) {
        systemParts.push('', '## Project instructions', pr.instructions);
      }

      const messages: Array<{ role: string; content: string }> = [
        { role: 'system', content: systemParts.join('\n') },
        {
          role: 'human',
          content: `Question: ${question}\n\nDiff:\n\`\`\`diff\n${pr.diff}\n\`\`\``,
        },
      ];

      const llm = createMainLLM();
      for await (const chunk of streamChat(llm, messages)) {
        process.stdout.write(chunk);
      }
      process.stdout.write('\n');
    });
}
