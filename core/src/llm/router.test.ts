import { beforeEach, describe, expect, it, vi } from 'vitest';

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

/* ------------------------------------------------------------------ */
/*  createLLM                                                          */
/* ------------------------------------------------------------------ */

vi.mock('@langchain/openai', () => {
  const ChatOpenAI = vi.fn(function (this: Record<string, unknown>, opts: Record<string, unknown>) {
    Object.assign(this, { _type: 'ChatOpenAI', ...opts });
  });
  return { ChatOpenAI };
});

vi.mock('@langchain/anthropic', () => {
  const ChatAnthropic = vi.fn(function (
    this: Record<string, unknown>,
    opts: Record<string, unknown>,
  ) {
    Object.assign(this, { _type: 'ChatAnthropic', ...opts });
  });
  return { ChatAnthropic };
});

vi.mock('@langchain/google-genai', () => {
  const ChatGoogleGenerativeAI = vi.fn(function (
    this: Record<string, unknown>,
    opts: Record<string, unknown>,
  ) {
    Object.assign(this, { _type: 'ChatGoogleGenerativeAI', ...opts });
  });
  return { ChatGoogleGenerativeAI };
});

vi.mock('../config/env.js', () => ({
  config: {
    mainModel: 'gpt-4o',
    subModel: 'claude-sonnet-4-20250514',
    openaiApiKey: 'sk-test-openai',
    anthropicApiKey: 'sk-test-anthropic',
    geminiApiKey: 'test-gemini-key',
    openaiBaseUrl: '',
  },
}));

describe('createLLM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates ChatOpenAI for gpt models', async () => {
    const { ChatOpenAI } = await import('@langchain/openai');
    const { createLLM } = await import('./router.js');

    createLLM('gpt-4o');
    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o', streaming: true }),
    );
  });

  it('creates ChatAnthropic for claude models', async () => {
    const { ChatAnthropic } = await import('@langchain/anthropic');
    const { createLLM } = await import('./router.js');

    createLLM('claude-3-opus-20240229');
    expect(ChatAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-3-opus-20240229', streaming: true }),
    );
  });

  it('creates ChatGoogleGenerativeAI for gemini models', async () => {
    const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
    const { createLLM } = await import('./router.js');

    createLLM('gemini-2.0-flash');
    expect(ChatGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.0-flash', streaming: true }),
    );
  });

  it('passes custom baseURL for OpenAI when configured', async () => {
    const { config } = await import('../config/env.js');
    (config as { openaiBaseUrl: string }).openaiBaseUrl = 'https://custom.api.example.com/v1';

    const { ChatOpenAI } = await import('@langchain/openai');
    const { createLLM } = await import('./router.js');

    createLLM('gpt-4o-mini');
    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        configuration: { baseURL: 'https://custom.api.example.com/v1' },
      }),
    );

    // Reset
    (config as { openaiBaseUrl: string }).openaiBaseUrl = '';
  });

  it('creates ChatOpenAI for o1-mini and o3-mini models', async () => {
    const { ChatOpenAI } = await import('@langchain/openai');
    const { createLLM } = await import('./router.js');

    createLLM('o1-mini');
    expect(ChatOpenAI).toHaveBeenCalledWith(expect.objectContaining({ model: 'o1-mini' }));

    vi.clearAllMocks();
    createLLM('o3-mini');
    expect(ChatOpenAI).toHaveBeenCalledWith(expect.objectContaining({ model: 'o3-mini' }));
  });

  it('falls back to ChatOpenAI for custom model strings', async () => {
    const { ChatOpenAI } = await import('@langchain/openai');
    const { createLLM } = await import('./router.js');

    createLLM('my-custom-finetuned-model');
    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'my-custom-finetuned-model' }),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  createMainLLM / createSubLLM                                       */
/* ------------------------------------------------------------------ */

describe('createMainLLM / createSubLLM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createMainLLM uses mainModel from config', async () => {
    const { ChatOpenAI } = await import('@langchain/openai');
    const { createMainLLM } = await import('./router.js');

    createMainLLM();
    expect(ChatOpenAI).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o' }));
  });

  it('createSubLLM uses subModel from config', async () => {
    const { ChatAnthropic } = await import('@langchain/anthropic');
    const { createSubLLM } = await import('./router.js');

    createSubLLM();
    expect(ChatAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-20250514' }),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  streamChat                                                         */
/* ------------------------------------------------------------------ */

describe('streamChat', () => {
  it('yields text chunks from stream', async () => {
    const { streamChat } = await import('./router.js');

    const mockChunks = [{ content: 'Hello' }, { content: ' world' }, { content: '!' }];

    const mockLLM = {
      stream: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          for (const chunk of mockChunks) {
            yield chunk;
          }
        },
      })),
    };

    const chunks: string[] = [];
    for await (const text of streamChat(mockLLM as never, [{ role: 'human', content: 'Hi' }])) {
      chunks.push(text);
    }

    expect(chunks).toEqual(['Hello', ' world', '!']);
  });

  it('skips non-string content chunks', async () => {
    const { streamChat } = await import('./router.js');

    const mockChunks = [
      { content: 'text chunk' },
      { content: [{ type: 'image', data: 'base64...' }] },
      { content: '' },
      { content: 'final chunk' },
    ];

    const mockLLM = {
      stream: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          for (const chunk of mockChunks) {
            yield chunk;
          }
        },
      })),
    };

    const chunks: string[] = [];
    for await (const text of streamChat(mockLLM as never, [{ role: 'human', content: 'Hi' }])) {
      chunks.push(text);
    }

    // Non-string and empty string chunks are skipped
    expect(chunks).toEqual(['text chunk', 'final chunk']);
  });
});

/* ------------------------------------------------------------------ */
/*  Provider detection edge cases                                      */
/* ------------------------------------------------------------------ */

describe('detectProvider edge cases', () => {
  it('detects o1-mini as openai', () => {
    expect(detectProvider('o1-mini')).toBe('openai');
  });

  it('detects o3-mini as openai', () => {
    expect(detectProvider('o3-mini')).toBe('openai');
  });

  it('detects o1-preview as openai', () => {
    expect(detectProvider('o1-preview')).toBe('openai');
  });

  it('treats model strings not matching any prefix as openai', () => {
    expect(detectProvider('llama-3-70b')).toBe('openai');
    expect(detectProvider('mistral-large')).toBe('openai');
    expect(detectProvider('deepseek-coder')).toBe('openai');
  });

  it('does not confuse partial prefix matches', () => {
    // "claude" without hyphen should not match anthropic
    expect(detectProvider('claudex-model')).toBe('openai');
    // "gemini" without hyphen should not match google
    expect(detectProvider('geminix-model')).toBe('openai');
  });
});
