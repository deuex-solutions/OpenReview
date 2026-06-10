import { Router } from 'express';
import type { Redis } from 'ioredis';

/**
 * Liveness + readiness endpoints.
 *
 * `/health` returns 200 as long as the process is running.
 * `/ready` additionally pings Redis so load balancers stop sending traffic
 * to a pod whose queue connection is gone.
 */
export function createHealthRouter(redis: Redis): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/ready', async (_req, res) => {
    try {
      const pong = await redis.ping();
      res.json({ status: 'ok', redis: pong === 'PONG' ? 'ok' : 'unknown' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(503).json({ status: 'error', redis: msg });
    }
  });

  return router;
}
