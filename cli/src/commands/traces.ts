import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { config, parsePRUrl } from '@openreview/core';
import type { Command } from 'commander';


export function registerTracesCommand(program: Command): void {
  program
    .command('traces')
    .description('View review trace logs')
    .option('--pr <url>', 'List traces for a specific PR')
    .option('--list', 'List recent traces (last 20)')
    .option('--open <file>', 'Pretty-print a trace file')
    .action(async (opts) => {
      try {
        const tracesDir = join(config.openreviewHome, 'traces');

        if (!existsSync(tracesDir)) {
          console.log('No traces found. Run a review first.');
          return;
        }

        if (opts.open) {
          // Pretty-print a specific trace
          const filePath = opts.open.includes('/') ? opts.open : join(tracesDir, opts.open);
          if (!existsSync(filePath)) {
            console.error(`Trace file not found: ${filePath}`);
            process.exit(1);
          }

          const content = readFileSync(filePath, 'utf-8');
          const trace = JSON.parse(content);

          console.log(`Trace: ${filePath}`);
          console.log(`  Owner: ${trace.meta?.owner}`);
          console.log(`  Repo: ${trace.meta?.repo}`);
          console.log(`  PR: #${trace.meta?.prNumber}`);
          console.log(`  Started: ${trace.meta?.startedAt}`);
          console.log(`  Entries: ${trace.entries?.length}`);
          console.log('');

          for (const entry of trace.entries ?? []) {
            console.log(`  [${entry.type}] ${entry.timestamp}`);
            if (entry.type === 'fast_review') {
              console.log(`    Files: ${entry.data?.input?.fileCount}, Duration: ${entry.data?.duration}ms`);
            } else if (entry.type === 'rlm_iteration') {
              console.log(`    Iteration: ${entry.data?.iteration}`);
              console.log(`    Reasoning: ${(entry.data?.reasoning as string)?.slice(0, 100)}...`);
            } else if (entry.type === 'findings') {
              console.log(`    Count: ${entry.data?.count}`);
              for (const f of entry.data?.findings ?? []) {
                console.log(`    - [${f.severity}] ${f.file}:${f.startLine} — ${f.title}`);
              }
            } else if (entry.type === 'metadata') {
              console.log(`    Total duration: ${entry.data?.totalDuration}ms`);
              console.log(`    LLM calls: ${entry.data?.llmCallCount}`);
            }
          }
          return;
        }

        // List traces
        const allFiles = readdirSync(tracesDir)
          .filter((f) => f.endsWith('.json'))
          .sort()
          .reverse();

        if (opts.pr) {
          // Filter by PR
          const { owner, repo, prNumber } = parsePRUrl(opts.pr);
          const filtered = allFiles.filter(
            (f) => f.includes(`${owner}-${repo}-${prNumber}`),
          );

          if (filtered.length === 0) {
            console.log(`No traces found for ${owner}/${repo}#${prNumber}`);
            return;
          }

          console.log(`Traces for ${owner}/${repo}#${prNumber}:`);
          for (const f of filtered) {
            console.log(`  ${f}`);
          }
        } else {
          // List last 20
          const recent = allFiles.slice(0, 20);
          if (recent.length === 0) {
            console.log('No traces found.');
            return;
          }

          console.log(`Recent traces (${recent.length}):`);
          for (const f of recent) {
            console.log(`  ${f}`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${msg}\n`);
        process.exit(1);
      }
    });
}
