import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';

import { config } from '../config/env.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type LLMProvider = 'openai' | 'anthropic' | 'google';

export interface LLMInfo {
  provider: LLMProvider;
  modelId: string;
}

/* ------------------------------------------------------------------ */
/*  Provider detection                                                 */
/* ------------------------------------------------------------------ */

export function detectProvider(modelId: string): LLMProvider {
  if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3')) {
    return 'openai';
  }
  if (modelId.startsWith('claude-')) {
    return 'anthropic';
  }
  if (modelId.startsWith('gemini-')) {
    return 'google';
  }
  // Default to OpenAI for custom/OpenAI-compatible models
  return 'openai';
}

/* ------------------------------------------------------------------ */
/*  Model factory                                                      */
/* ------------------------------------------------------------------ */

export function createLLM(modelId: string): BaseChatModel {
  const provider = detectProvider(modelId);

  switch (provider) {
    case 'openai': {
      const opts: ConstructorParameters<typeof ChatOpenAI>[0] = {
        model: modelId,
        apiKey: config.openaiApiKey,
        streaming: true,
      };
      if (config.openaiBaseUrl) {
        opts.configuration = { baseURL: config.openaiBaseUrl };
      }
      return new ChatOpenAI(opts);
    }

    case 'anthropic':
      return new ChatAnthropic({
        model: modelId,
        anthropicApiKey: config.anthropicApiKey,
        streaming: true,
      });

    case 'google':
      return new ChatGoogleGenerativeAI({
        model: modelId,
        apiKey: config.geminiApiKey,
        streaming: true,
      });
  }
}

/* ------------------------------------------------------------------ */
/*  Convenience constructors                                           */
/* ------------------------------------------------------------------ */

export function createMainLLM(): BaseChatModel {
  return createLLM(config.mainModel);
}

export function createSubLLM(): BaseChatModel {
  return createLLM(config.subModel);
}

/* ------------------------------------------------------------------ */
/*  Streaming helper                                                   */
/* ------------------------------------------------------------------ */

export async function* streamChat(
  llm: BaseChatModel,
  messages: Array<{ role: string; content: string }>,
): AsyncIterable<string> {
  const stream = await llm.stream(
    messages.map((m) => ({
      role: m.role as 'system' | 'human' | 'ai',
      content: m.content,
    })),
  );

  for await (const chunk of stream) {
    const text = typeof chunk.content === 'string' ? chunk.content : '';
    if (text) yield text;
  }
}
