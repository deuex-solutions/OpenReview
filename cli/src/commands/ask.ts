import { createInterface } from 'node:readline';

import {
  GitHubClient,
  createMainLLM,
  streamChat,
} from '@openreview/core';
import type { Command } from 'commander';


export function registerAskCommand(program: Command): void {
  program
    .command('ask')
    .description('Ask questions about a repository or PR')
    .option('--repo <path>', 'Local repository path', '.')
    .option('--url <url>', 'GitHub PR URL for context')
    .action(async (opts) => {
      try {
        console.log('OpenReview Ask — Interactive Q&A');
        console.log('Commands: reset, history, files, exit');
        console.log('');

        const thread: Array<{ role: string; content: string }> = [];
        let snapshotFiles: string[] = [];

        // Load PR context if URL provided
        if (opts.url) {
          const { client, prNumber } = GitHubClient.fromPRUrl(opts.url);
          const prMeta = await client.getPR(prNumber);
          const diff = await client.getPRDiff(prNumber);
          const files = await client.getPRFiles(prNumber);
          snapshotFiles = files.map((f) => f.filename);

          thread.push({
            role: 'system',
            content: [
              'You are OpenReview, a codebase-aware assistant.',
              `Repository: ${client.owner}/${client.repo}`,
              `PR #${prNumber}: ${prMeta.title}`,
              '',
              'Diff:',
              '```diff',
              diff,
              '```',
            ].join('\n'),
          });

          console.log(`Loaded PR #${prNumber}: ${prMeta.title} (${files.length} files)`);
          console.log('');
        }

        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
          prompt: 'openreview> ',
        });

        rl.prompt();

        rl.on('line', async (input) => {
          const trimmed = input.trim();

          if (!trimmed) {
            rl.prompt();
            return;
          }

          if (trimmed === 'exit' || trimmed === 'quit') {
            rl.close();
            return;
          }

          if (trimmed === 'reset') {
            thread.length = 0;
            console.log('Thread cleared.');
            rl.prompt();
            return;
          }

          if (trimmed === 'history') {
            for (const msg of thread) {
              if (msg.role === 'human') console.log(`You: ${msg.content.slice(0, 100)}`);
              if (msg.role === 'ai') console.log(`AI: ${msg.content.slice(0, 100)}`);
            }
            rl.prompt();
            return;
          }

          if (trimmed === 'files') {
            if (snapshotFiles.length > 0) {
              for (const f of snapshotFiles) console.log(`  ${f}`);
            } else {
              console.log('  No files loaded. Use --url to load a PR.');
            }
            rl.prompt();
            return;
          }

          // Send question to LLM
          thread.push({ role: 'human', content: trimmed });

          try {
            const llm = createMainLLM();
            let fullResponse = '';
            for await (const chunk of streamChat(llm, thread)) {
              process.stdout.write(chunk);
              fullResponse += chunk;
            }
            console.log('\n');

            thread.push({ role: 'ai', content: fullResponse });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Error: ${msg}`);
          }

          rl.prompt();
        });

        rl.on('close', () => {
          console.log('Goodbye.');
          process.exit(0);
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${msg}\n`);
        process.exit(1);
      }
    });
}
