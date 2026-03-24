import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { config } from '../config/env.js';
import { createMainLLM, createStructuredLLM } from '../llm/router.js';

import { deduplicateFindings, runLinters } from './linters.js';
import type {
  FindingSeverity,
  PRContext,
  ReviewFinding,
  ReviewSummary,
  ReviewTrace,
} from './types.js';
import { sortFindings } from './types.js';

/* ------------------------------------------------------------------ */
/*  Zod schema for structured LLM output                               */
/* ------------------------------------------------------------------ */

const FindingSchema = z.object({
  category: z
    .enum(['bug', 'flag'])
    .describe(
      'MUST be exactly "bug" (actual error/vulnerability) or "flag" (worth investigating/informational). No other values.',
    ),
  severity: z
    .enum(['severe', 'non-severe', 'investigate', 'informational'])
    .describe(
      'MUST be exactly one of: "severe" (blocks functionality or security risk), ' +
        '"non-severe" (incorrect but not critical), "investigate" (warrants closer look), ' +
        '"informational" (annotation only). No other values like "low", "high", "medium".',
    ),
  file: z.string().describe('File path relative to repo root, e.g. "src/auth.ts"'),
  startLine: z.number().describe('Start line number in the new file (from the diff)'),
  endLine: z.number().describe('End line number (same as startLine for single-line findings)'),
  title: z.string().describe('Short title under 80 chars'),
  explanation: z.string().describe('Detailed explanation of the issue'),
  suggestedFix: z
    .string()
    .nullable()
    .describe('Optional corrected code snippet, or null if no fix needed'),
});

const ReviewOutputSchema = z.object({
  findings: z
    .array(FindingSchema)
    .describe('Array of review findings. Return at least one finding if any issue exists.'),
});

/* ------------------------------------------------------------------ */
/*  Severity normalization map (for raw/fallback parser)               */
/* ------------------------------------------------------------------ */

const SEVERITY_NORMALIZE: Record<string, FindingSeverity> = {
  // Direct matches
  severe: 'severe',
  'non-severe': 'non-severe',
  investigate: 'investigate',
  informational: 'informational',
  // Common LLM alternatives
  critical: 'severe',
  high: 'severe',
  major: 'severe',
  medium: 'non-severe',
  moderate: 'non-severe',
  minor: 'non-severe',
  low: 'non-severe',
  warning: 'investigate',
  info: 'informational',
  note: 'informational',
  suggestion: 'informational',
  trivial: 'informational',
};

/** Normalize any severity string to a valid FindingSeverity. */
function normalizeSeverity(raw: string, categoryHint: string): FindingSeverity {
  const s = raw.toLowerCase().trim();
  if (SEVERITY_NORMALIZE[s]) return SEVERITY_NORMALIZE[s];
  return mapAlternateSeverity(categoryHint);
}

/* ------------------------------------------------------------------ */
/*  Category normalization map                                         */
/* ------------------------------------------------------------------ */

const CATEGORY_BUG_KEYWORDS = [
  'bug',
  'error',
  'security',
  'vulnerability',
  'injection',
  'crash',
  'failure',
  'broken',
];

/** Normalize any category string to 'bug' or 'flag'. */
function normalizeCategory(raw: string): 'bug' | 'flag' {
  const s = raw.toLowerCase();
  return CATEGORY_BUG_KEYWORDS.some((kw) => s.includes(kw)) ? 'bug' : 'flag';
}

/* ------------------------------------------------------------------ */
/*  Fast Review Engine                                                 */
/* ------------------------------------------------------------------ */

/**
 * Run a single-shot Fast mode review on a PR.
 *
 * Pipeline:
 * 1. Run enabled linters on changed files
 * 2. Send prompt to LLM (structured output → raw fallback → empty-retry)
 * 3. Normalize findings (enum values, field names)
 * 4. Validate citations against diff (snap-to-nearest)
 * 5. Merge with linter findings (deduplicate)
 * 6. Return sorted findings + diagnostic trace
 */
export async function runFastReview(
  pr: PRContext,
  repoPath?: string,
): Promise<{ findings: ReviewFinding[]; summary: ReviewSummary; trace: ReviewTrace }> {
  const start = Date.now();
  const trace: ReviewTrace = {
    model: config.mainModel,
    rawFindingsCount: 0,
    postValidationCount: 0,
    droppedByCitation: [],
    finalFindingsCount: 0,
    path: 'structured',
    durationMs: 0,
  };

  // 1. Run linters (if we have a local checkout)
  const linterFindings = repoPath ? await runLinters(pr.files, repoPath) : [];

  // 2. Build prompt and call LLM with fallback chain
  const prompt = buildPrompt(pr, linterFindings);
  let aiFindings: ReviewFinding[];

  // Path A: Try structured output first
  try {
    aiFindings = await invokeStructured(prompt);
    trace.path = 'structured';
  } catch {
    // Path B: Fallback to raw LLM + resilient parser
    try {
      aiFindings = await invokeRawWithParser(prompt, pr.files);
    } catch {
      aiFindings = [];
    }
    trace.path = 'fallback';
  }

  // Path C: If structured output returned empty, retry with raw parser
  // (the model might have valid findings but returned empty due to schema constraints)
  if (aiFindings.length === 0 && trace.path === 'structured') {
    const rawRetry = await invokeRawWithParser(prompt, pr.files);
    if (rawRetry.length > 0) {
      aiFindings = rawRetry;
      trace.path = 'structured+fallback';
    }
  }

  trace.rawFindingsCount = aiFindings.length;

  // 3. Validate citations with snap-to-nearest
  const diffLines = extractDiffLineMap(pr.diff);
  const { validated, dropped } = validateWithSnap(aiFindings, diffLines);

  trace.postValidationCount = validated.length;
  trace.droppedByCitation = dropped.map((f) => ({
    file: f.file,
    lines: `${f.startLine}-${f.endLine}`,
    title: f.title,
  }));

  // 4. Merge and deduplicate
  const merged = deduplicateFindings(validated, linterFindings);

  // 5. Sort by severity
  const sorted = sortFindings(merged);

  const duration = Date.now() - start;
  trace.finalFindingsCount = sorted.length;
  trace.durationMs = duration;

  if (sorted.length === 0) {
    if (aiFindings.length === 0) {
      trace.emptyReason = 'structured_and_fallback_empty';
    } else {
      trace.emptyReason = 'all_filtered_by_citation';
    }
  }

  const summary = buildSummary(sorted, pr.files.length, duration);

  return { findings: sorted, summary, trace };
}

/* ------------------------------------------------------------------ */
/*  LLM invocation strategies                                          */
/* ------------------------------------------------------------------ */

/**
 * Invoke via structured output (Zod schema enforcement).
 * Guaranteed schema compliance on gpt-4o+.
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

/**
 * Invoke raw LLM and parse response with the resilient parser.
 * Handles alternate field names, wrong enum values, code fences, etc.
 */
async function invokeRawWithParser(
  prompt: Array<{ role: string; content: string }>,
  changedFiles?: string[],
): Promise<ReviewFinding[]> {
  const llm = createMainLLM();
  const response = await llm.invoke(prompt);
  const responseText =
    typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  return parseLLMResponse(responseText, changedFiles);
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
    '### Configuration & Data Correctness',
    '- Incorrect nesting or structure in YAML/JSON/TOML config files',
    '- Missing required fields in configuration',
    '- Inconsistencies between similar configuration blocks',
    '- Wrong values, typos in field names, incorrect references',
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
    '- Inconsistent patterns within the same codebase',
    '',
    '## Response format',
    'Respond ONLY with a valid JSON array of findings. Each finding MUST use these exact field names and values:',
    '',
    '- **category**: MUST be `"bug"` or `"flag"` — no other values like "Documentation", "Security", etc.',
    '- **severity**: MUST be `"severe"`, `"non-severe"`, `"investigate"`, or `"informational"` — no other values like "low", "high", "medium"',
    '- **file**: file path relative to repo root',
    '- **startLine**: line number from the diff',
    '- **endLine**: end line number (same as startLine for single-line)',
    '- **title**: short title under 80 chars',
    '- **explanation**: detailed explanation',
    '- **suggestedFix**: corrected code or null',
    '',
    '```json',
    '[{',
    '  "category": "bug",',
    '  "severity": "non-severe",',
    '  "file": "src/config.yaml",',
    '  "startLine": 42,',
    '  "endLine": 42,',
    '  "title": "Missing required field in config",',
    '  "explanation": "The enabled field is missing from the oidcConfiguration block, which will cause the auth provider to be silently disabled.",',
    '  "suggestedFix": "oidcConfiguration:\\n  enabled: true"',
    '}]',
    '```',
    '',
    '## Rules',
    '- Only cite line numbers that are visible in the diff (added, modified, or context lines).',
    '- Be thorough — it is better to flag a potential issue than to miss a real bug.',
    '- For config/YAML/MDX files: check structure correctness, missing fields, inconsistencies between similar blocks.',
    '- Classify documentation/config issues as category "flag" with severity "investigate" or "informational".',
    '- If genuinely no issues are found, respond with an empty array: []',
    '- Do NOT wrap the JSON in markdown code fences.',
    '',
    'CRITICAL: Use ONLY the exact enum values specified above for category and severity. Do NOT use values like "Documentation", "low", "high", "Security", etc.',
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
/*  LLM response parsing (resilient fallback parser)                   */
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
 */
function parseLocation(loc: string): { file: string; startLine: number; endLine: number } | null {
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
 * Normalize a raw LLM finding with alternate field names and non-standard enum values.
 * When file/startLine are missing, tries to infer from changedFiles list.
 */
function normalizeFinding(
  raw: RawLLMFinding,
  changedFiles?: string[],
): {
  category: 'bug' | 'flag';
  severity: FindingSeverity;
  file: string;
  startLine: number;
  endLine: number;
  title: string;
  explanation: string;
  suggestedFix?: string;
} | null {
  let file = raw.file ?? raw.path;
  let startLine = raw.startLine ?? raw.line;
  let endLine = raw.endLine;

  if ((!file || !startLine) && raw.location) {
    const parsed = parseLocation(raw.location);
    if (parsed) {
      file = file ?? parsed.file;
      startLine = startLine ?? parsed.startLine;
      endLine = endLine ?? parsed.endLine;
    }
  }

  // If file is still missing, try to extract from the finding text
  if (!file && changedFiles && changedFiles.length > 0) {
    const text = raw.description ?? raw.explanation ?? raw.message ?? raw.title ?? '';
    for (const cf of changedFiles) {
      const filename = cf.split('/').pop() ?? '';
      if (text.includes(cf) || (filename && text.includes(filename))) {
        file = cf;
        break;
      }
    }
    // If still no file match, use the first changed file as fallback
    if (!file) file = changedFiles[0];
  }

  // Default startLine to 1 only when changedFiles context is available
  // (meaning we're in the full review pipeline, not standalone parsing)
  if (file && !startLine && changedFiles) startLine = 1;

  if (!file || !startLine) return null;

  // Handle description-only findings (no separate title/explanation)
  let title = raw.title ?? raw.message;
  let explanation = raw.explanation ?? raw.description ?? raw.message;

  // If only description is present, split into title + explanation
  if (!title && raw.description) {
    const desc = raw.description;
    // Title = first sentence (up to 80 chars), explanation = full description
    const firstSentenceEnd = desc.search(/[.!?]\s/) + 1;
    title = firstSentenceEnd > 0 ? desc.slice(0, Math.min(firstSentenceEnd, 80)) : desc.slice(0, 80);
    explanation = desc;
  }

  if (!title || !explanation) return null;

  const rawCategory = (raw.category ?? raw.type ?? '').toLowerCase();
  const category = normalizeCategory(rawCategory);

  const rawSeverity = (raw.severity ?? '').toLowerCase().trim();
  const severity = normalizeSeverity(rawSeverity, rawCategory);

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

export function parseLLMResponse(text: string, changedFiles?: string[]): ReviewFinding[] {
  const cleaned = text
    .replace(/^```(?:json)?\s*\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
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
    const normalized = normalizeFinding(item as RawLLMFinding, changedFiles);
    if (!normalized) continue;

    findings.push({
      id: `ai-${randomUUID().slice(0, 8)}`,
      category: normalized.category,
      severity: normalized.severity,
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
/*  Citation validation with snap-to-nearest                           */
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
      // Context lines are visible in the diff — include them
      map.get(currentFile)!.add(newLineNum);
      newLineNum++;
    }
  }

  return map;
}

/** Snap-to-nearest tolerance in lines (like PR-Agent's 10-line tolerance). */
const SNAP_TOLERANCE = 10;

/**
 * Validate findings against diff lines with snap-to-nearest.
 * Returns validated findings (possibly with adjusted line numbers) and dropped findings.
 */
function validateWithSnap(
  findings: ReviewFinding[],
  diffLines: DiffLineMap,
): { validated: ReviewFinding[]; dropped: ReviewFinding[] } {
  const validated: ReviewFinding[] = [];
  const dropped: ReviewFinding[] = [];

  for (const finding of findings) {
    const fileLines = diffLines.get(finding.file);
    if (!fileLines || fileLines.size === 0) {
      dropped.push(finding);
      continue;
    }

    // Check exact match first
    let exactMatch = false;
    for (let line = finding.startLine; line <= finding.endLine; line++) {
      if (fileLines.has(line)) {
        exactMatch = true;
        break;
      }
    }

    if (exactMatch) {
      validated.push(finding);
      continue;
    }

    // Snap to nearest diff line within tolerance
    const sortedLines = [...fileLines].sort((a, b) => a - b);
    const midpoint = Math.floor((finding.startLine + finding.endLine) / 2);

    let nearest = -1;
    let minDist = Infinity;
    for (const dl of sortedLines) {
      const dist = Math.abs(dl - midpoint);
      if (dist < minDist) {
        minDist = dist;
        nearest = dl;
      }
    }

    if (nearest !== -1 && minDist <= SNAP_TOLERANCE) {
      const offset = nearest - finding.startLine;
      validated.push({
        ...finding,
        startLine: finding.startLine + offset,
        endLine: finding.endLine + offset,
        citations: [
          {
            file: finding.file,
            startLine: finding.startLine + offset,
            endLine: finding.endLine + offset,
          },
        ],
      });
    } else {
      dropped.push(finding);
    }
  }

  return { validated, dropped };
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
