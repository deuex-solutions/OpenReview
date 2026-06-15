import { pino } from 'pino';

import type { ServiceConfig } from './config.js';

/**
 * Build a single shared pino logger.
 * In development we use pino-pretty for readable output; in production we
 * emit one-line JSON so log aggregators can ingest cleanly.
 */
export function createLogger(cfg: ServiceConfig) {
  if (cfg.isProduction) {
    return pino({
      level: cfg.logLevel || 'info',
      base: { service: 'openreview' },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  return pino({
    level: cfg.logLevel || 'debug',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
