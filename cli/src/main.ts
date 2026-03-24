#!/usr/bin/env node

import { Command } from 'commander';

import { registerAskCommand } from './commands/ask.js';
import { registerReviewCommand } from './commands/review.js';
import { registerServeCommand } from './commands/serve.js';
import { registerTracesCommand } from './commands/traces.js';

const VERSION = '1.0.0';

const program = new Command()
  .name('openreview')
  .description('Open-source agentic code review tool')
  .version(VERSION);

registerReviewCommand(program);
registerAskCommand(program);
registerServeCommand(program);
registerTracesCommand(program);

// Handle uncaught errors gracefully
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (err) {
  if (err instanceof Error && 'code' in err) {
    const code = (err as { code: string }).code;
    // commander throws on --help and --version with specific codes
    if (code === 'commander.helpDisplayed' || code === 'commander.version') {
      process.exit(0);
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}
