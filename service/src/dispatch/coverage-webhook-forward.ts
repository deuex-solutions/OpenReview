import axios from 'axios';

import type { Logger } from '../logger.js';

export interface CoverageWebhookForwardHeaders {
  event: string;
  deliveryId: string;
  signature?: string;
}

/**
 * Forwards GitHub App installation events to the coverage-service so it can
 * store per-repo `githubInstallationId` values. OpenReview is the public
 * webhook entrypoint; coverage-service stays on localhost.
 */
export async function forwardCoverageInstallationWebhook(
  baseUrl: string,
  rawBody: Buffer,
  headers: CoverageWebhookForwardHeaders,
  logger: Logger,
): Promise<{ status: number; body: unknown }> {
  const url = `${baseUrl.replace(/\/$/, '')}/webhooks/github`;

  const response = await axios.post(url, rawBody, {
    headers: {
      'content-type': 'application/json',
      'x-github-event': headers.event,
      'x-github-delivery': headers.deliveryId,
      ...(headers.signature
        ? { 'x-hub-signature-256': headers.signature }
        : {}),
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true,
  });

  logger.info(
    {
      deliveryId: headers.deliveryId,
      event: headers.event,
      status: response.status,
      url,
    },
    'forwarded installation webhook to coverage-service',
  );

  return { status: response.status, body: response.data };
}
