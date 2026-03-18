import { describe, expect, it } from 'vitest';

import { detectProvider } from './router.js';

/* ------------------------------------------------------------------ */
/*  detectProvider                                                     */
/* ------------------------------------------------------------------ */

describe('detectProvider', () => {
  it('detects OpenAI models', () => {
    expect(detectProvider('gpt-4o')).toBe('openai');
    expect(detectProvider('gpt-4o-mini')).toBe('openai');
    expect(detectProvider('gpt-3.5-turbo')).toBe('openai');
  });

  it('detects OpenAI o-series models', () => {
    expect(detectProvider('o1-preview')).toBe('openai');
    expect(detectProvider('o1-mini')).toBe('openai');
    expect(detectProvider('o3-mini')).toBe('openai');
  });

  it('detects Anthropic models', () => {
    expect(detectProvider('claude-3-opus-20240229')).toBe('anthropic');
    expect(detectProvider('claude-3-sonnet-20240229')).toBe('anthropic');
    expect(detectProvider('claude-3-haiku-20240307')).toBe('anthropic');
    expect(detectProvider('claude-sonnet-4-20250514')).toBe('anthropic');
  });

  it('detects Google models', () => {
    expect(detectProvider('gemini-1.5-pro')).toBe('google');
    expect(detectProvider('gemini-2.0-flash')).toBe('google');
    expect(detectProvider('gemini-1.5-flash')).toBe('google');
  });

  it('defaults to OpenAI for unknown model strings', () => {
    expect(detectProvider('custom-model')).toBe('openai');
    expect(detectProvider('my-fine-tune')).toBe('openai');
  });
});
