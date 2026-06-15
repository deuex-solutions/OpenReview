import { Redis } from 'ioredis';

import type { ServiceConfig } from '../config.js';

/**
 * Create an ioredis connection configured for BullMQ.
 *
 * BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck: false`
 * on the connection used by `Worker` / `QueueScheduler`, otherwise commands
 * will fail during transient disconnects. We use the same config for the
 * producer connection for simplicity.
 *
 * The return type is the runtime Redis class (so callers can `.ping()`,
 * `.quit()`, etc.) — BullMQ accepts a `Redis` instance as a `ConnectionOptions`.
 */
export function createRedisConnection(cfg: ServiceConfig): Redis {
  return new Redis(cfg.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });
}
