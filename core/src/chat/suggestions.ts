import { createSubLLM } from '../llm/router.js';
import type { PRContext } from '../review/types.js';

/* ------------------------------------------------------------------ */
/*  Follow-up suggestion generator                                     */
/* ------------------------------------------------------------------ */

/**
 * Generate 4–5 follow-up questions based on the chat answer and PR context.
 * Uses the sub (cheaper) LLM model for cost efficiency.
 * Each suggestion is <= 8 words.
 */
export async function generateSuggestions(
  answer: string,
  context: PRContext,
): Promise<string[]> {
  if (!answer.trim()) return [];

  const llm = createSubLLM();

  const prompt = [
    {
      role: 'system' as const,
      content: [
        'Generate 4-5 follow-up questions a developer might ask after receiving this code review answer.',
        'Each question must be 8 words or fewer.',
        'Output ONLY the questions, one per line, no numbering or bullets.',
        '',
        `Context: PR #${context.prNumber} in ${context.owner}/${context.repo}`,
        `PR title: ${context.metadata.title}`,
      ].join('\n'),
    },
    {
      role: 'human' as const,
      content: `Answer given:\n${answer}`,
    },
  ];

  try {
    const response = await llm.invoke(
      prompt.map((m) => ({
        role: m.role as 'system' | 'human',
        content: m.content,
      })),
    );

    const text =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    const suggestions = text
      .split('\n')
      .map((line) => line.replace(/^[-•*\d.)\s]+/, '').trim())
      .filter((line) => line.length > 0 && line.split(/\s+/).length <= 8)
      .slice(0, 5);

    return suggestions;
  } catch {
    return [];
  }
}
