import { createApp } from './app.js';
import { assertConfigReady, loadServiceConfig } from './config.js';
import { createNoopDispatcher } from './dispatch/downstream.js';
import { createPatAuth } from './github/auth.js';
import { createRedisConnection } from './jobs/connection.js';
import { ReviewQueue } from './jobs/queue.js';
import { createLogger } from './logger.js';

/**
 * Web entrypoint. Receives webhooks, verifies them, and enqueues jobs.
 * Does NO review work itself — workers consume the queue.
 */
async function main(): Promise<void> {
  const cfg = loadServiceConfig();
  const logger = createLogger(cfg);

  try {
    assertConfigReady(cfg);
  } catch (err) {
    logger.fatal({ err: (err as Error).message }, 'startup configuration error');
    process.exit(1);
  }

  const redis = createRedisConnection(cfg);
  const queue = new ReviewQueue(redis, cfg, logger);
  const downstream = createNoopDispatcher(logger);
  const auth = createPatAuth(cfg);

  const app = createApp({ cfg, logger, redis, queue, downstream, auth });

  const server = app.listen(cfg.port, cfg.host, () => {
    logger.info({ host: cfg.host, port: cfg.port }, 'webhook server listening');
  });

  // Graceful shutdown: stop accepting new requests, drain in-flight work,
  // close Redis. Worker process handles its own draining.
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down web');
    server.close();
    await queue.close();
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal error in web entrypoint:', err);
  process.exit(1);
});
