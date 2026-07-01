import type { GeneratedTestCategory, TestGenerationContext } from '../types';

export interface TestabilityClassificationResult {
  category: GeneratedTestCategory;
  reason: string;
}

export function buildTestabilityClassificationPrompt(
  ctx: TestGenerationContext,
): string {
  const symbols = ctx.symbols
    .map((s) => `- ${s.kind} ${s.name}`)
    .join('\n');

  const exports =
    ctx.exportedSymbols?.length ?
      ctx.exportedSymbols.map((s) => `- ${s}`).join('\n')
    : '(none)';

  return `You are analyzing whether a changed source file is a good candidate for **unit test** generation.

## File
${ctx.file}

## Language / framework
${ctx.language} / ${ctx.framework}

## Diff
${ctx.diff || '(no diff)'}

## Full source (PR branch)
${ctx.source}

## Exported symbols
${exports}

## Symbols in changed/uncovered regions
${symbols || '(none detected)'}

## Uncovered lines
${ctx.uncoveredLines}

## Existing tests for this file
${ctx.existingTests?.trim() || '(none found)'}

## Task
Decide if this file is **worthwhile for unit tests** (isolated tests with mocks) or if it **needs integration tests** instead.

Choose **UNIT_TEST_WORTHWHILE** when:
- Pure functions, validators, utilities, or services with clear mockable boundaries
- Config/prompt/schema exports that can be smoke-tested with simple imports
- Hooks or modules testable by mocking fetch/API/QueryClient at the boundary
- Incremental unit tests can realistically cover the uncovered lines

Choose **INTEGRATION_TEST_NEEDED** when:
- React Native / Next screens with navigation, providers, and multiple context dependencies
- Glue/orchestration code where unit tests would be brittle and not exercise real behavior
- Heavy UI composition where meaningful coverage requires rendering with full provider trees
- Entry points or scripts better verified end-to-end than with isolated unit tests
- Type-only or barrel re-export files with no executable logic to unit test

Respond with **only** valid JSON (no markdown fences):
{"category":"UNIT_TEST_WORTHWHILE"|"INTEGRATION_TEST_NEEDED","reason":"one or two sentences explaining why"}`;
}

export function parseTestabilityClassificationResponse(
  raw: string,
): TestabilityClassificationResult {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  const jsonText = jsonMatch?.[0] ?? trimmed;

  let parsed: { category?: string; reason?: string };
  try {
    parsed = JSON.parse(jsonText) as { category?: string; reason?: string };
  } catch {
    return {
      category: 'UNIT_TEST_WORTHWHILE',
      reason: 'Could not parse LLM classification; defaulting to unit test generation.',
    };
  }

  const category =
    parsed.category === 'INTEGRATION_TEST_NEEDED' ?
      'INTEGRATION_TEST_NEEDED'
    : 'UNIT_TEST_WORTHWHILE';

  const reason =
    typeof parsed.reason === 'string' && parsed.reason.trim() ?
      parsed.reason.trim()
    : category === 'INTEGRATION_TEST_NEEDED' ?
      'This file requires integration-level testing rather than isolated unit tests.'
    : 'This file is suitable for unit test generation.';

  return { category, reason };
}
