#!/usr/bin/env node
import { Command } from 'commander';

import { askCommand } from './commands/ask.js';
import { reviewCommand } from './commands/review.js';

const program = new Command();

program
  .name('openreview')
  .description('AI-powered pull request review (CLI)')
  .version('1.0.0');

program.addCommand(reviewCommand());
program.addCommand(askCommand());

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
