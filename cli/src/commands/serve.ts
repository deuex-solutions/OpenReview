import type { Command } from 'commander';

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the OpenReview API server')
    .option('--port <port>', 'Port to listen on', '3000')
    .option('--host <host>', 'Host to bind to', 'localhost')
    .action(async (opts) => {
      try {
        // Dynamic import to avoid loading Express when not needed
        const { default: express } = await import('express');
        const app = express();

        app.use(express.json());

        app.get('/health', (_req, res) => {
          res.json({ status: 'ok', version: '1.0.0' });
        });

        const port = parseInt(opts.port, 10);
        const host = opts.host as string;

        app.listen(port, host, () => {
          console.log(`OpenReview server running at http://${host}:${port}`);
          console.log('Endpoints:');
          console.log(`  GET  http://${host}:${port}/health`);
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${msg}\n`);
        process.exit(1);
      }
    });
}
