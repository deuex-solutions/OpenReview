import express from 'express';
import type { Express } from 'express';
import type { Redis } from 'ioredis';

import type { ServiceConfig } from './config.js';
import type { DownstreamDispatcher } from './dispatch/downstream.js';
import type { GitHubAuth } from './github/auth.js';
import type { ReviewQueue } from './jobs/queue.js';
import type { Logger } from './logger.js';
import { createCoverageTriggerRouter } from './routes/coverage-trigger.js';
import { createHealthRouter } from './routes/health.js';
import { createWebhookRouter } from './routes/webhook.js';

export interface AppDeps {
  cfg: ServiceConfig;
  logger: Logger;
  redis: Redis;
  queue: ReviewQueue;
  downstream: DownstreamDispatcher;
  auth: GitHubAuth;
}

/**
 * Build the Express application. Pure factory — no listening, no side effects.
 * Web entrypoint mounts this; tests can instantiate it with fake deps.
 */
export function createApp(deps: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(createHealthRouter(deps.redis));
  app.use(
    createWebhookRouter(
      deps.cfg,
      {
        queue: deps.queue,
        downstream: deps.downstream,
        logger: deps.logger,
        pullRequestOptions: {
          coverageServiceEnabled: deps.cfg.coverageServiceEnabled,
        },
      },
      deps.logger,
    ),
  );

  if (deps.cfg.coverageServiceEnabled) {
    app.use(
      createCoverageTriggerRouter({
        cfg: deps.cfg,
        logger: deps.logger,
        queue: deps.queue,
        auth: deps.auth,
      }),
    );
  }

  return app;
}
