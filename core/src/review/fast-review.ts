import { randomUUID } from 'node:crypto';

import { createMainLLM } from '../llm/router.js';

import { deduplicateFindings, runLinters } from './linters.js';
import type { FindingSeverity, PRContext, ReviewFinding, ReviewSummary } from './types.js';
import { sortFindings } from './types.js';

/* ------------------------------------------------------------------ */
/*  Fast Review Engine                                                 */
/* ------------------------------------------------------------------ */

/**
 * Run a single-shot Fast mode review on a PR.
 *
 * 1. Run enabled linters on changed files
 * 2. Send structured prompt to LLM (diff + linter findings + instructions)
 * 3. Parse LLM response into ReviewFinding[]
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
  const llm = createMainLLM();
  const response = await llm.invoke(prompt);

  const responseText =
    typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

  // 3. Parse LLM response
  const aiFindings = parseLLMResponse(responseText);

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

/* ------------------------------------------------------------------ */
/*  Prompt construction                                                */
/* ------------------------------------------------------------------ */

function buildPrompt(
  pr: PRContext,
  linterFindings: ReviewFinding[],
): Array<{ role: string; content: string }> {
  const systemPrompt = [
    'You are OpenReview, an expert code reviewer. Your task is to review a Pull Request diff and find bugs, security issues, and quality problems.',
    '',
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
    'Rules:',
    '- Only cite line numbers that are visible in the diff (added or modified lines).',
    '- Categorize correctly: "bug" for actual errors, "flag" for things worth investigating.',
    '- Severity guide: "severe" = blocks functionality or security risk, "non-severe" = incorrect but not critical, "investigate" = warrants closer look, "informational" = annotation.',
    '- If no issues are found, respond with an empty array: []',
    '- Do NOT wrap the JSON in markdown code fences.',
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
  category?: string;
  severity?: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  title?: string;
  explanation?: string;
  suggestedFix?: string;
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
    const raw = item as RawLLMFinding;
    if (!raw.file || !raw.startLine || !raw.title || !raw.explanation) continue;

    const category = raw.category === 'bug' ? 'bug' : 'flag';
    const severity = isValidSeverity(raw.severity) ? raw.severity : 'investigate';

    findings.push({
      id: `ai-${randomUUID().slice(0, 8)}`,
      category,
      severity,
      file: raw.file,
      startLine: raw.startLine,
      endLine: raw.endLine ?? raw.startLine,
      title: raw.title,
      explanation: raw.explanation,
      suggestedFix: raw.suggestedFix,
      source: 'ai',
      citations: [
        {
          file: raw.file,
          startLine: raw.startLine,
          endLine: raw.endLine ?? raw.startLine,
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
