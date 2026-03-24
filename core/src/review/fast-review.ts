import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { config } from '../config/env.js';
import { createMainLLM, createStructuredLLM } from '../llm/router.js';

import { deduplicateFindings, runLinters } from './linters.js';
import type { FindingSeverity, PRContext, ReviewFinding, ReviewSummary } from './types.js';
import { sortFindings } from './types.js';

/* ------------------------------------------------------------------ */
/*  Zod schema for structured LLM output                               */
/* ------------------------------------------------------------------ */

const FindingSchema = z.object({
  category: z.enum(['bug', 'flag']).describe('bug = actual error, flag = worth investigating'),
  severity: z
    .enum(['severe', 'non-severe', 'investigate', 'informational'])
    .describe(
      'severe = blocks functionality or security risk, non-severe = incorrect but not critical, investigate = warrants closer look, informational = annotation',
    ),
  file: z.string().describe('File path relative to repo root'),
  startLine: z.number().describe('Start line number in the new file'),
  endLine: z.number().describe('End line number (same as startLine for single-line findings)'),
  title: z.string().describe('Short title (under 80 chars)'),
  explanation: z.string().describe('Detailed explanation of the issue'),
  suggestedFix: z
    .string()
    .nullable()
    .describe('Optional corrected code snippet, or null if no fix needed'),
});

const ReviewOutputSchema = z.object({
  findings: z.array(FindingSchema).describe('Array of review findings. Empty array if no issues.'),
});

/* ------------------------------------------------------------------ */
/*  Fast Review Engine                                                 */
/* ------------------------------------------------------------------ */

/**
 * Run a single-shot Fast mode review on a PR.
 *
 * 1. Run enabled linters on changed files
 * 2. Send structured prompt to LLM (diff + linter findings + instructions)
 * 3. Parse LLM response into ReviewFinding[] (structured output → fallback parser)
 * 4. Validate citations against the diff
 * 5. Merge with linter findings (deduplicate)
 * 6. Return sorted findings
 */
export async function runFastReview(
  pr: PRContext,
  repoPath?: string,
): Promise<{ findings: ReviewFinding[]; summary: ReviewSummary }> {
  const start = Date.now();

  // 1. Run linters (if we have a local checkout)
  const linterFindings = repoPath ? await runLinters(pr.files, repoPath) : [];

  // 2. Build prompt and call LLM
  const prompt = buildPrompt(pr, linterFindings);
  let aiFindings: ReviewFinding[];

  try {
    // Try structured output first (guaranteed schema compliance on gpt-4o+)
    aiFindings = await invokeStructured(prompt);
  } catch {
    // Fallback: raw LLM call + resilient parser (for models that don't support structured output)
    const llm = createMainLLM();
    const response = await llm.invoke(prompt);
    const responseText =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    aiFindings = parseLLMResponse(responseText);
  }

  // 4. Validate citations — only allow lines visible in the diff
  const diffLines = extractDiffLineMap(pr.diff);
  const validatedFindings = aiFindings.filter((f) => validateCitation(f, diffLines));

  // 5. Merge and deduplicate
  const merged = deduplicateFindings(validatedFindings, linterFindings);

  // 6. Sort by severity
  const sorted = sortFindings(merged);

  const duration = Date.now() - start;
  const summary = buildSummary(sorted, pr.files.length, duration);

  return { findings: sorted, summary };
}

/**
 * Invoke the LLM with structured output (Zod schema validation).
 * Returns typed ReviewFinding[] directly — no manual parsing needed.
 */
async function invokeStructured(
  prompt: Array<{ role: string; content: string }>,
): Promise<ReviewFinding[]> {
  const structuredLlm = createStructuredLLM(
    config.mainModel,
    ReviewOutputSchema,
    'review_output',
    0,
  );

  const result = (await structuredLlm.invoke(prompt)) as z.infer<typeof ReviewOutputSchema>;

  return result.findings.map((f: z.infer<typeof FindingSchema>) => ({
    id: `ai-${randomUUID().slice(0, 8)}`,
    category: f.category,
    severity: f.severity,
    file: f.file,
    startLine: f.startLine,
    endLine: f.endLine,
    title: f.title,
    explanation: f.explanation,
    suggestedFix: f.suggestedFix ?? undefined,
    source: 'ai' as const,
    citations: [{ file: f.file, startLine: f.startLine, endLine: f.endLine }],
  }));
}

/* ------------------------------------------------------------------ */
/*  Prompt construction                                                */
/* ------------------------------------------------------------------ */

function buildPrompt(
  pr: PRContext,
  linterFindings: ReviewFinding[],
): Array<{ role: string; content: string }> {
  const systemPrompt = [
    'You are OpenReview, an expert code reviewer. Your task is to thoroughly review a Pull Request diff and produce actionable findings.',
    '',
    '## What to look for',
    'You MUST check every changed line for ALL of the following categories:',
    '',
    '### Bugs & Logic Errors',
    '- Off-by-one errors, incorrect conditionals, unreachable code, null/undefined access',
    '- Race conditions, deadlocks, missing await, unhandled promise rejections',
    '- Wrong variable used, copy-paste mistakes, incorrect return types',
    '- Missing error handling, uncaught exceptions, silent failures',
    '',
    '### Security Vulnerabilities',
    '- Injection flaws: SQL injection, XSS, command injection, path traversal',
    '- Hardcoded secrets, API keys, tokens, passwords in code',
    '- Missing input validation or sanitization at system boundaries',
    '- Insecure cryptographic usage, weak random number generation',
    '- Improper access control, missing authentication/authorization checks',
    '- Sensitive data exposure in logs, error messages, or responses',
    '',
    '### Code Quality & Maintainability',
    '- SOLID principle violations (single responsibility, open-closed, etc.)',
    '- Functions that are too long or do too many things',
    '- Missing or incorrect type annotations that could cause runtime issues',
    '- Resource leaks: unclosed file handles, database connections, event listeners',
    '- Performance issues: N+1 queries, unnecessary re-renders, O(n²) where O(n) is possible',
    '',
    '### Best Practice Violations',
    '- Deprecated API usage',
    '- Missing edge case handling (empty arrays, null inputs, boundary values)',
    '- Inconsistent error handling patterns within the same codebase',
    '',
    '## Response format',
    'Respond ONLY with a valid JSON array of findings. Each finding must have this schema:',
    '```json',
    '[{',
    '  "category": "bug" | "flag",',
    '  "severity": "severe" | "non-severe" | "investigate" | "informational",',
    '  "file": "path/to/file.ts",',
    '  "startLine": 10,',
    '  "endLine": 12,',
    '  "title": "Short title",',
    '  "explanation": "Detailed explanation of the issue",',
    '  "suggestedFix": "Optional corrected code"',
    '}]',
    '```',
    '',
    '## Rules',
    '- Only cite line numbers that are visible in the diff (added or modified lines).',
    '- Be thorough — it is better to flag a potential issue than to miss a real bug.',
    '- Categorize correctly: "bug" for actual errors, "flag" for things worth investigating.',
    '- Severity guide: "severe" = blocks functionality or security risk, "non-severe" = incorrect but not critical, "investigate" = warrants closer look, "informational" = annotation.',
    '- If genuinely no issues are found, respond with an empty array: []',
    '- Do NOT wrap the JSON in markdown code fences.',
    '',
    '## Example response',
    'Here is an example of the EXACT format you must use:',
    '[{"category":"bug","severity":"severe","file":"src/auth.ts","startLine":42,"endLine":42,"title":"Missing null check on user object","explanation":"The user object can be null when the session expires, but it is accessed without a null check, which will throw a TypeError at runtime.","suggestedFix":"if (!user) throw new AuthError(\'Session expired\');"}]',
    '',
    'IMPORTANT: You MUST use exactly these field names: category, severity, file, startLine, endLine, title, explanation. Do NOT use alternative names like type, message, location, line, etc.',
  ];

  if (pr.instructions) {
    systemPrompt.push('', '## Project Review Instructions', pr.instructions);
  }

  if (pr.learnings.length > 0) {
    systemPrompt.push(
      '',
      '## Team Learnings',
      'The team has flagged the following patterns from previous reviews:',
      ...pr.learnings.map((l) => `- ${l}`),
    );
  }

  const humanContent = [
    `## Pull Request: ${pr.metadata.title}`,
    `**Repository:** ${pr.owner}/${pr.repo} | **PR #${pr.prNumber}** | **Author:** ${pr.metadata.author}`,
    '',
  ];

  if (pr.metadata.body) {
    humanContent.push('### Description', pr.metadata.body, '');
  }

  humanContent.push('### Diff', '```diff', pr.diff, '```');

  if (linterFindings.length > 0) {
    humanContent.push(
      '',
      '### Linter Findings (already detected)',
      'The following issues were already found by static analysis tools. Focus your review on issues NOT covered by these:',
      '',
      ...linterFindings.map(
        (f) => `- **${f.linterName}** ${f.file}:${f.startLine} — ${f.title}: ${f.explanation}`,
      ),
    );
  }

  return [
    { role: 'system', content: systemPrompt.join('\n') },
    { role: 'human', content: humanContent.join('\n') },
  ];
}

/* ------------------------------------------------------------------ */
/*  LLM response parsing                                               */
/* ------------------------------------------------------------------ */

interface RawLLMFinding {
  // Standard fields
  category?: string;
  severity?: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  title?: string;
  explanation?: string;
  suggestedFix?: string;
  // Alternate field names that smaller models sometimes use
  type?: string;
  message?: string;
  location?: string;
  line?: number;
  path?: string;
  description?: string;
  fix?: string;
  suggested_fix?: string;
}

/**
 * Parse a "file:line" or "file:line1-line2" location string.
 * Handles formats like "src/auth.ts:42", "src/auth.ts:42-45",
 * and comma-separated multi-locations "file1.ts:10, file2.ts:20" (takes first).
 */
function parseLocation(loc: string): { file: string; startLine: number; endLine: number } | null {
  // Take first location if comma-separated
  const first = loc.split(',')[0].trim();
  const match = /^(.+?):(\d+)(?:-(\d+))?$/.exec(first);
  if (!match) return null;
  const startLine = parseInt(match[2], 10);
  return {
    file: match[1].trim(),
    startLine,
    endLine: match[3] ? parseInt(match[3], 10) : startLine,
  };
}

/**
 * Normalize a raw LLM finding that may use non-standard field names.
 * Returns null if the finding cannot be normalized into a valid shape.
 */
function normalizeFinding(raw: RawLLMFinding): {
  category: string;
  severity: string;
  file: string;
  startLine: number;
  endLine: number;
  title: string;
  explanation: string;
  suggestedFix?: string;
} | null {
  // Resolve file + line from standard or alternate fields
  let file = raw.file ?? raw.path;
  let startLine = raw.startLine ?? raw.line;
  let endLine = raw.endLine;

  // If no file/startLine but location string exists, parse it
  if ((!file || !startLine) && raw.location) {
    const parsed = parseLocation(raw.location);
    if (parsed) {
      file = file ?? parsed.file;
      startLine = startLine ?? parsed.startLine;
      endLine = endLine ?? parsed.endLine;
    }
  }

  if (!file || !startLine) return null;

  // Resolve title and explanation from standard or alternate fields
  const title = raw.title ?? raw.message ?? raw.description;
  const explanation = raw.explanation ?? raw.message ?? raw.description;
  if (!title || !explanation) return null;

  // Resolve category from standard or "type" field
  const rawCategory = (raw.category ?? raw.type ?? '').toLowerCase();
  const category = rawCategory.includes('bug') || rawCategory.includes('error') ? 'bug' : 'flag';

  // Resolve severity
  const rawSeverity = (raw.severity ?? '').toLowerCase();
  const severity = isValidSeverity(rawSeverity) ? rawSeverity : mapAlternateSeverity(rawCategory);

  return {
    category,
    severity,
    file,
    startLine,
    endLine: endLine ?? startLine,
    title,
    explanation,
    suggestedFix: raw.suggestedFix ?? raw.suggested_fix ?? raw.fix,
  };
}

/**
 * Map alternate category/type strings to a severity when no explicit severity is provided.
 */
function mapAlternateSeverity(typeStr: string): FindingSeverity {
  if (typeStr.includes('security') || typeStr.includes('severe') || typeStr.includes('critical')) {
    return 'severe';
  }
  if (typeStr.includes('bug') || typeStr.includes('error')) {
    return 'non-severe';
  }
  if (typeStr.includes('warning') || typeStr.includes('quality') || typeStr.includes('style')) {
    return 'informational';
  }
  return 'investigate';
}

export function parseLLMResponse(text: string): ReviewFinding[] {
  // Strip markdown code fences if present
  const cleaned = text
    .replace(/^```(?:json)?\s*\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to extract JSON array from the response
    const match = /\[[\s\S]*\]/.exec(cleaned);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  const findings: ReviewFinding[] = [];
  for (const item of parsed) {
    const normalized = normalizeFinding(item as RawLLMFinding);
    if (!normalized) continue;

    findings.push({
      id: `ai-${randomUUID().slice(0, 8)}`,
      category: normalized.category === 'bug' ? 'bug' : 'flag',
      severity: normalized.severity as FindingSeverity,
      file: normalized.file,
      startLine: normalized.startLine,
      endLine: normalized.endLine,
      title: normalized.title,
      explanation: normalized.explanation,
      suggestedFix: normalized.suggestedFix,
      source: 'ai',
      citations: [
        {
          file: normalized.file,
          startLine: normalized.startLine,
          endLine: normalized.endLine,
        },
      ],
    });
  }

  return findings;
}

/* ------------------------------------------------------------------ */
/*  Citation validation                                                */
/* ------------------------------------------------------------------ */

/** Map of file → set of line numbers visible in the diff. */
type DiffLineMap = Map<string, Set<number>>;

export function extractDiffLineMap(rawDiff: string): DiffLineMap {
  const map: DiffLineMap = new Map();
  const lines = rawDiff.split('\n');

  let currentFile: string | null = null;
  let newLineNum = 0;

  const diffHeaderRe = /^diff --git a\/(.+?) b\/(.+?)$/;
  const hunkHeaderRe = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

  for (const line of lines) {
    const diffMatch = diffHeaderRe.exec(line);
    if (diffMatch) {
      currentFile = diffMatch[2];
      if (!map.has(currentFile)) map.set(currentFile, new Set());
      continue;
    }

    const hunkMatch = hunkHeaderRe.exec(line);
    if (hunkMatch) {
      newLineNum = parseInt(hunkMatch[1], 10);
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      map.get(currentFile)!.add(newLineNum);
      newLineNum++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // deleted lines — don't increment new line number
    } else if (line.startsWith(' ')) {
      // Context lines are visible in the diff — include them so the LLM
      // can reference nearby unchanged lines without being filtered out.
      map.get(currentFile)!.add(newLineNum);
      newLineNum++;
    }
  }

  return map;
}

function validateCitation(finding: ReviewFinding, diffLines: DiffLineMap): boolean {
  const fileLines = diffLines.get(finding.file);
  if (!fileLines) return false;

  // At least one line in the finding's range must be in the diff
  for (let line = finding.startLine; line <= finding.endLine; line++) {
    if (fileLines.has(line)) return true;
  }

  return false;
}

/* ------------------------------------------------------------------ */
/*  Summary builder                                                    */
/* ------------------------------------------------------------------ */

function buildSummary(
  findings: ReviewFinding[],
  fileCount: number,
  durationMs: number,
): ReviewSummary {
  const bySeverity: Record<FindingSeverity, number> = {
    severe: 0,
    'non-severe': 0,
    investigate: 0,
    informational: 0,
  };

  for (const f of findings) {
    bySeverity[f.severity]++;
  }

  const seconds = Math.round(durationMs / 1000);
  const duration = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;

  return {
    filesReviewed: fileCount,
    duration,
    mode: 'fast',
    findingsBySeverity: bySeverity,
    totalFindings: findings.length,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isValidSeverity(s?: string): s is FindingSeverity {
  return s === 'severe' || s === 'non-severe' || s === 'investigate' || s === 'informational';
}
