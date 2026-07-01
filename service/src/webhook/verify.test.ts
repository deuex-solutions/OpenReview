import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifySignature } from './verify.js';

const SECRET = 'unit-test-secret';

function sign(body: string | Buffer): string {
  const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  return 'sha256=' + createHmac('sha256', SECRET).update(buf).digest('hex');
}

describe('verifySignature', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8');

  it('accepts a correctly signed body', () => {
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a wrong signature', () => {
    const wrong = 'sha256=' + 'f'.repeat(64);
    expect(verifySignature(body, wrong, SECRET)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
  });

  it('rejects an unprefixed signature', () => {
    const digest = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifySignature(body, digest, SECRET)).toBe(false);
  });

  it('rejects when the body has been tampered with', () => {
    const sig = sign(body);
    const tampered = Buffer.from(JSON.stringify({ hello: 'WORLD' }), 'utf8');
    expect(verifySignature(tampered, sig, SECRET)).toBe(false);
  });

  it('rejects when the secret is different', () => {
    expect(verifySignature(body, sign(body), 'other-secret')).toBe(false);
  });
});
