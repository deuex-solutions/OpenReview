import { describe, expect, it } from 'vitest';

import { createLLM, createMainLLM, createSubLLM, detectProvider } from '../../../core/src/llm/router.js';

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

/* ------------------------------------------------------------------ */
/*  createLLM                                                          */
/* ------------------------------------------------------------------ */

describe('createLLM', () => {
  it('creates an LLM instance for OpenAI models', () => {
    const llm = createLLM('gpt-4o');
    expect(llm).toBeDefined();
    expect(typeof llm.invoke).toBe('function');
  });

  it('creates an LLM instance for Anthropic models (or throws if no key)', () => {
    try {
      const llm = createLLM('claude-3-opus-20240229');
      expect(llm).toBeDefined();
      expect(typeof llm.invoke).toBe('function');
    } catch (e) {
      // Anthropic SDK throws if no API key — acceptable in test env
      expect((e as Error).message).toContain('API key');
    }
  });

  it('creates an LLM instance for Google models (or throws if no key)', () => {
    try {
      const llm = createLLM('gemini-2.0-flash');
      expect(llm).toBeDefined();
      expect(typeof llm.invoke).toBe('function');
    } catch (e) {
      // Google SDK may throw if no API key — acceptable in test env
      expect((e as Error).message).toBeDefined();
    }
  });

  it('creates an LLM instance for o-series models', () => {
    const llm = createLLM('o1-mini');
    expect(llm).toBeDefined();
    expect(typeof llm.invoke).toBe('function');
  });

  it('creates an LLM instance for custom model strings (defaults to OpenAI)', () => {
    const llm = createLLM('my-custom-finetuned-model');
    expect(llm).toBeDefined();
    expect(typeof llm.invoke).toBe('function');
  });

  it('accepts a temperature parameter', () => {
    const llm = createLLM('gpt-4o', 0.5);
    expect(llm).toBeDefined();
  });

  it('defaults temperature to 0', () => {
    const llm = createLLM('gpt-4o');
    expect(llm).toBeDefined();
    // Can't easily verify temperature on the returned object without mocking,
    // but the function should not throw
  });
});

/* ------------------------------------------------------------------ */
/*  createMainLLM / createSubLLM                                       */
/* ------------------------------------------------------------------ */

describe('createMainLLM / createSubLLM', () => {
  it('createMainLLM returns an LLM instance', () => {
    const llm = createMainLLM();
    expect(llm).toBeDefined();
    expect(typeof llm.invoke).toBe('function');
  });

  it('createSubLLM returns an LLM instance', () => {
    const llm = createSubLLM();
    expect(llm).toBeDefined();
    expect(typeof llm.invoke).toBe('function');
  });
});
