import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessageLike } from '@langchain/core/messages';
import type { Runnable } from '@langchain/core/runnables';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import type { z } from 'zod';

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

/**
 * Create a chat model instance for the given model ID.
 *
 * @param modelId - The model identifier (e.g. 'gpt-4o', 'claude-3-opus')
 * @param temperature - Temperature for generation. Default 0 for deterministic review output.
 *                      Use 0.3+ for chat/creative tasks.
 */
export function createLLM(modelId: string, temperature = 0): BaseChatModel {
  const provider = detectProvider(modelId);

  switch (provider) {
    case 'openai': {
      const opts: ConstructorParameters<typeof ChatOpenAI>[0] = {
        model: modelId,
        apiKey: config.openaiApiKey,
        temperature,
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
        temperature,
        streaming: true,
      });

    case 'google':
      return new ChatGoogleGenerativeAI({
        model: modelId,
        apiKey: config.geminiApiKey,
        temperature,
        streaming: true,
      });
  }
}

/* ------------------------------------------------------------------ */
/*  Convenience constructors                                           */
/* ------------------------------------------------------------------ */

/** Create main LLM with temperature=0 (deterministic review output). */
export function createMainLLM(): BaseChatModel {
  return createLLM(config.mainModel, 0);
}

/** Create sub LLM with temperature=0.3 (slightly creative for summaries/suggestions). */
export function createSubLLM(): BaseChatModel {
  return createLLM(config.subModel, 0.3);
}

/* ------------------------------------------------------------------ */
/*  Structured output helper                                           */
/* ------------------------------------------------------------------ */

/**
 * Create a structured LLM that returns typed, validated output matching a Zod schema.
 *
 * Uses the best available method per provider:
 * - OpenAI/Google: native JSON schema mode (guaranteed schema compliance on gpt-4o+)
 * - Anthropic: function calling (high reliability)
 * - Fallback: function calling for older models (gpt-3.5-turbo)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createStructuredLLM<T extends z.ZodType>(
  modelId: string,
  schema: T,
  name: string,
  temperature = 0,
): Runnable<any, z.infer<T>> {
  const llm = createLLM(modelId, temperature);
  const provider = detectProvider(modelId);

  // gpt-3.5-turbo doesn't support native json_schema, use function calling
  const supportsJsonSchema =
    (provider === 'openai' && !modelId.includes('gpt-3.5')) || provider === 'google';

  const method = supportsJsonSchema ? 'jsonSchema' : 'functionCalling';

  return llm.withStructuredOutput(schema, { method, name, strict: true }) as Runnable<
    any,
    z.infer<T>
  >;
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
