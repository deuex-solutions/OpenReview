import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a GitHub webhook signature against the raw request body.
 *
 * GitHub signs the body with HMAC-SHA-256 using your webhook secret and
 * delivers the hex digest in the `X-Hub-Signature-256` header, prefixed
 * with `sha256=`. We MUST compare on raw bytes — JSON.parse + re-stringify
 * would alter whitespace / key order and invalidate the signature.
 *
 * Returns true if and only if the signature matches; constant-time
 * comparison defeats timing oracles.
 */
export function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signatureHeader, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
