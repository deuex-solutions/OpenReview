import { Router, raw } from 'express';

import type { ServiceConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { WebhookRouterDeps } from '../webhook/router.js';
import { routeWebhook } from '../webhook/router.js';
import { verifySignature } from '../webhook/verify.js';

/**
 * Mount POST /webhook. Uses `express.raw` so we can verify the HMAC
 * against the EXACT bytes GitHub signed; `express.json` would re-stringify
 * and break the signature.
 *
 * We always ACK fast (202) before doing any review work — GitHub's webhook
 * delivery times out at ~10s and a real review can take 60s+. Errors that
 * happen after the 202 are logged but cannot be reported back via HTTP.
 */
export function createWebhookRouter(
  cfg: ServiceConfig,
  deps: WebhookRouterDeps,
  logger: Logger,
): Router {
  const router = Router();

  router.post(
    '/webhook',
    raw({ type: 'application/json', limit: cfg.maxPayloadBytes }),
    async (req, res) => {
      const event = req.header('x-github-event') || '';
      const deliveryId = req.header('x-github-delivery') || 'unknown';
      const signature = req.header('x-hub-signature-256');

      const rawBody = req.body as Buffer;
      if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
        res.status(400).json({ error: 'empty body' });
        return;
      }

      if (!verifySignature(rawBody, signature, cfg.githubWebhookSecret)) {
        logger.warn({ deliveryId, event }, 'webhook signature verification failed');
        res.status(401).json({ error: 'invalid signature' });
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.status(400).json({ error: 'invalid JSON' });
        return;
      }

      // Acknowledge immediately, do the actual work after the response is sent.
      res.status(202).json({ status: 'accepted', deliveryId });

      // Fire-and-forget. Errors are logged; BullMQ retries handle transient
      // downstream failures for jobs that were successfully enqueued.
      void routeWebhook(event, deliveryId, payload, deps)
        .then((result) => {
          logger.info(
            { deliveryId, event, result },
            `webhook ${result.status}`,
          );
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error({ deliveryId, event, err: msg }, 'webhook handler crashed');
        });
    },
  );

  return router;
}
