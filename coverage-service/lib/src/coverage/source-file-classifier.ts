/** Files exporting constants, prompts, schemas, or config should never be skipped. */
export function isConfigOrPromptExportFile(source: string): boolean {
  const patterns = [
    /export\s+(?:const|let)\s+\w*(?:PROMPT|SCHEMA|CONFIG|CONSTANTS?)\w*\s*=/i,
    /export\s+(?:const|let)\s+(?:SYSTEM_|USER_|DEFAULT_)\w+/i,
    /export\s+(?:const|let)\s+\w+\s*=\s*[\[{`'"]/,
    /export\s+(?:const|let)\s+\w+\s*:\s*(?:z\.|Schema|Record|string\[\])/i,
    /export\s+default\s+\{[\s\S]*(?:prompt|schema|config)/i,
  ];
  return patterns.some((p) => p.test(source));
}

/** Service files with retry logic, LLM calls, HTTP clients, etc. need richer test context. */
export function isComplexServiceFile(source: string): boolean {
  const patterns = [
    /\b(retry|retries|backoff|exponential)\b/i,
    /\b(openai|anthropic|llm|chat\.completions|generateText)\b/i,
    /\b(fetch\s*\(|axios|httpx|requests\.|HttpClient|http\.get|http\.post)\b/i,
    /\b(pagination|paginate|nextPage|cursor|offset|limit)\b/i,
    /\b(chunk|batch|splitIntoChunks)\b/i,
    /\bProvider\b|\bAbstractProvider\b|\bcreateClient\b/,
  ];
  return patterns.filter((p) => p.test(source)).length >= 2;
}

/** Suggest smoke test exports for config/prompt files. */
export function suggestSmokeTestExports(source: string): string[] {
  const exports: string[] = [];
  const constExports = source.matchAll(
    /export\s+(?:const|let)\s+(\w+)/g,
  );
  for (const match of constExports) {
    exports.push(match[1]);
  }
  return exports.slice(0, 8);
}
