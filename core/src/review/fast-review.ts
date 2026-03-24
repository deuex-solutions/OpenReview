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
    typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

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

type ReviewLanguage =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'java'
  | 'go'
  | 'ruby'
  | 'php'
  | 'csharp'
  | 'rust'
  | 'unknown';

type ReviewFramework = 'react' | 'nextjs' | 'node' | 'express';

function buildPrompt(
  pr: PRContext,
  linterFindings: ReviewFinding[],
): Array<{ role: string; content: string }> {
  const detectedLanguage = detectPrimaryLanguage(pr.diff);
  const detectedFrameworks = detectFrameworks(pr.diff);

  const systemPrompt = [
    ...buildBaseSystemPrompt(),
    '',
    '## Review Context',
    `Primary language detected: ${detectedLanguage}`,
    detectedFrameworks.length > 0
      ? `Framework/runtime hints: ${detectedFrameworks.join(', ')}`
      : 'Framework/runtime hints: none detected',
    '',
    ...buildLanguageReviewBlock(detectedLanguage),
    ...buildFrameworkReviewBlocks(detectedFrameworks),
  ];

  console.log('===============================================');
  console.log('System prompt:', systemPrompt.join('\n'));
  console.log('===============================================');

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

function buildBaseSystemPrompt(): string[] {
  return [
    'You are OpenReview, an expert senior code reviewer.',
    'Your job is to review a Pull Request diff and identify high-value issues in correctness, security, stability, maintainability, and production readiness.',
    '',
    'Review with the mindset of a strict but practical senior engineer:',
    '- Prioritize real bugs, regressions, unsafe behavior, and maintainability risks.',
    '- Prefer fewer, higher-confidence findings over many weak comments.',
    '- Do not nitpick formatting or subjective style unless it affects correctness, readability, maintainability, or team standards.',
    '- Only report issues that are visible in the changed lines or are directly caused by the changed lines.',
    '',
    'Primary review dimensions:',
    '- Functional correctness',
    '- Security vulnerabilities',
    '- Data validation and trust boundaries',
    '- Async/concurrency correctness',
    '- State management correctness',
    '- Performance regressions',
    '- Resource cleanup and lifecycle safety',
    '- Maintainability and code clarity',
    '- Edge cases and failure handling',
    '',
    'Important review behavior:',
    '- Treat "bug" as a definite issue likely to cause incorrect behavior, break functionality, introduce a security risk, corrupt data, or create a real production problem.',
    '- Treat "flag" as a suspicious or risky pattern that may depend on surrounding code or runtime assumptions.',
    '- Do not report purely stylistic preferences.',
    '- Do not report missing tests unless the code change clearly introduces a risky untested path and the lack of coverage is itself material.',
    '- Do not restate linter issues already provided unless the changed code creates a deeper functional impact.',
    '- Do not speculate about hidden files or unseen code unless the diff clearly creates the risk.',
    '- Before emitting a finding, verify that the issue is specific, actionable, and plausibly caused by the changed lines.',
    '- Do not emit vague findings like "this may cause issues" without explaining the concrete failure mode.',
    '- For React findings, prefer explaining the user-visible or state-consistency impact, not just the hook rule being violated.',
    '',
    'When evaluating a change, ask:',
    '- Can this fail at runtime?',
    '- Can this produce stale, inconsistent, or incorrect UI/data?',
    '- Can this break under null, undefined, empty, loading, or error states?',
    '- Can this leak resources or create duplicate subscriptions/timers/listeners?',
    '- Can this cause race conditions or out-of-order updates?',
    '- Can this expose sensitive data or trust unsafe input?',
    '- Can this make future maintenance meaningfully harder?',
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
    'Output rules:',
    '- Only cite file paths and line numbers visible in the diff.',
    '- Each finding must point to a specific changed line range.',
    '- Keep titles short and precise.',
    '- Explanations must describe why the issue matters in runtime or maintenance terms.',
    '- suggestedFix should be included only when a clear improvement can be expressed briefly and safely.',
    '- Avoid duplicate findings for the same root cause.',
    '',
    'Severity guide:',
    '- severe: likely production breakage, security issue, crash, data corruption, auth issue, or major regression',
    '- non-severe: real correctness or reliability issue with narrower impact',
    '- investigate: suspicious logic or assumption that needs verification',
    '- informational: useful annotation tied to maintainability or code quality, but not a likely defect on its own',
    '',
    'If no meaningful issues are found, respond with: []',
    'Do NOT wrap the JSON in markdown code fences.',
    'Do NOT include any prose before or after the JSON.',
  ];
}

function buildLanguageReviewBlock(language: ReviewLanguage): string[] {
  switch (language) {
    case 'javascript':
    case 'typescript':
      return [
        '## Language-Specific Review Rules: JavaScript / TypeScript',
        'Review this change as production JavaScript/TypeScript code, focusing on runtime safety, correctness, and maintainability.',
        '',
        'Check carefully for correctness issues such as:',
        '- Missing await on async operations',
        '- Promise chains that are started but not handled',
        '- Silent promise rejection paths',
        '- try/catch blocks that swallow errors without preserving failure information',
        '- Returning before async work is completed when completion is expected',
        '- Race conditions caused by multiple async calls updating the same state/value',
        '- Stale values captured by closures',
        '- Mutating shared objects, arrays, props, or stateful references in place',
        '- Incorrect default values during destructuring',
        '- Truthy/falsy checks that break valid values like 0, false, or empty string',
        '- Null/undefined access risks',
        '- Optional chaining used in a way that hides a real data contract problem',
        '- Incorrect equality logic where strict equality is required for correctness',
        '- Dead conditions, unreachable branches, or contradictory checks',
        '',
        'Check carefully for security and trust-boundary issues such as:',
        '- Using untrusted input in HTML, script execution, URLs, storage, or navigation flows',
        '- innerHTML, dangerouslySetInnerHTML, eval, Function constructor, setTimeout with string input, or similar unsafe execution patterns',
        '- Building queries, URLs, or request payloads from unvalidated user-controlled values',
        '',
        'Check carefully for maintainability and standards:',
        '- Ambiguous or misleading variable naming that can cause future bugs',
        '- Large inline logic blocks that make behavior hard to reason about',
        '- Repeated logic introduced instead of reusing safe existing patterns',
        '- Hidden side effects inside helper functions, array methods, or callbacks',
        '- Console logging or debug-only behavior left in important flows',
        '',
        'Check carefully for performance and lifecycle issues:',
        '- Recreating expensive values/functions unnecessarily in hot paths',
        '- Repeated work during render or request handling that could have been avoided',
        '- Timers, listeners, subscriptions, observers, or async handlers not being cleaned up',
        '',
        'Do not report:',
        '- Prettier/style-only concerns',
        '- Personal naming preferences unless they materially hurt readability or correctness',
        '- General architectural preferences unless the changed code creates a specific risk',
        '',
      ];

    case 'python':
      return [
        '## Language-Specific Review Rules: Python',
        'Check carefully for:',
        '- Mutable default arguments',
        '- Missing exception handling',
        '- Overly broad except blocks',
        '- Resource handling issues (files, DB connections, network clients)',
        '- Blocking calls in async code',
        '- None handling bugs',
        '- Unsafe eval/exec or deserialization',
        '- Incorrect dict/list mutation during iteration',
        '',
      ];

    case 'java':
      return [
        '## Language-Specific Review Rules: Java',
        'Check carefully for:',
        '- Null handling issues',
        '- Resource leaks',
        '- Concurrency bugs',
        '- Incorrect equals/hashCode implications',
        '- Exception swallowing',
        '- Unsafe collection mutation',
        '',
      ];

    case 'go':
      return [
        '## Language-Specific Review Rules: Go',
        'Check carefully for:',
        '- Ignored errors',
        '- Goroutine leaks',
        '- Nil pointer risks',
        '- Deferred cleanup issues',
        '- Shared state races',
        '',
      ];

    case 'ruby':
      return [
        '## Language-Specific Review Rules: Ruby',
        'Check carefully for:',
        '- Nil handling issues',
        '- Unsafe metaprogramming or eval',
        '- Mutation side effects',
        '- Silent rescue blocks',
        '',
      ];

    case 'php':
      return [
        '## Language-Specific Review Rules: PHP',
        'Check carefully for:',
        '- Loose comparisons causing correctness bugs',
        '- Unsafe input handling',
        '- Null/array access issues',
        '- SQL injection or output escaping problems',
        '',
      ];

    case 'csharp':
      return [
        '## Language-Specific Review Rules: C#',
        'Check carefully for:',
        '- Null reference risks',
        '- Async/await misuse',
        '- IDisposable/resource cleanup issues',
        '- Thread safety problems',
        '',
      ];

    case 'rust':
      return [
        '## Language-Specific Review Rules: Rust',
        'Check carefully for:',
        '- Panic-prone unwrap/expect usage in unsafe contexts',
        '- Lifetime/ownership workarounds hiding logic issues',
        '- Error handling regressions',
        '- Concurrency or lock misuse',
        '',
      ];

    default:
      return [
        '## Language-Specific Review Rules',
        'Use best judgment based on the diff and prioritize correctness, security, and maintainability.',
        '',
      ];
  }
}

function buildFrameworkReviewBlocks(frameworks: ReviewFramework[]): string[] {
  const blocks: string[] = [];

  for (const framework of frameworks) {
    if (framework === 'react') {
      console.log('Building React review rules');
      blocks.push(
        '## Framework-Specific Review Rules: React',
        'Review this as production React code. Focus on correctness of rendering, state flow, effects, event handling, and UI consistency.',
        '',
        'Check carefully for Hooks correctness:',
        '- Missing dependencies in useEffect, useMemo, or useCallback that can cause stale values',
        '- Extra dependencies that can cause unnecessary reruns, loops, or repeated network calls',
        '- Effects doing work that should happen in event handlers or derived state instead',
        '- Missing cleanup in useEffect for subscriptions, listeners, intervals, timeouts, observers, or in-flight async work',
        '- Stale closure bugs inside effects, callbacks, timers, and async handlers',
        '',
        'Check carefully for state correctness:',
        '- State updates based on stale state instead of functional updates',
        '- Multiple state updates that can race or overwrite each other',
        '- Derived state stored separately and allowed to drift from source state',
        '- Props copied into state without clear synchronization logic',
        '- Direct mutation of state, nested state, props, refs, or arrays/objects used by state',
        '- Loading, error, and empty states that are inconsistent or incomplete',
        '',
        'Check carefully for rendering correctness:',
        '- Conditional rendering that can break valid values like 0 or empty string',
        '- Rendering assumptions that may fail before async data loads',
        '- Missing null guards before using nested properties',
        '- List rendering with unstable or incorrect keys',
        '- Components reading values that may be undefined on first render',
        '- Controlled/uncontrolled input mismatches',
        '',
        'Check carefully for async UI bugs:',
        '- A later request being overwritten by an older request resolving later',
        '- State updates after unmount',
        '- Missing cancellation or ignore guards for in-flight async work',
        '- Loading flags not reset on all success/failure paths',
        '- Optimistic UI updates without rollback handling',
        '',
        'Check carefully for event and form handling:',
        '- Event handlers capturing stale values',
        '- Handlers firing with the wrong item/index due to closure mistakes',
        '- Forms submitting with incomplete validation or inconsistent source of truth',
        '- Disabled/loading button states not preventing duplicate submissions',
        '',
        'Check carefully for performance:',
        '- Expensive calculations performed on every render without need',
        '- Inline object/array/function creation that may cause avoidable rerenders in memoized children',
        '- Memoization added incorrectly in a way that hides stale data or gives false safety',
        '- Large lists rendered without any consideration for rendering cost when the diff clearly worsens it',
        '',
        'Check carefully for maintainability and standards:',
        '- Component responsibilities becoming mixed and hard to reason about',
        '- Side effects hidden in render paths',
        '- Complex JSX conditions that are error-prone',
        '- Inconsistent state ownership making future bugs likely',
        '',
        'Do not report:',
        '- The mere absence of useMemo/useCallback unless the diff clearly introduces a real rerender or stale-data problem',
        '- Subjective component structure preferences without a concrete risk',
        '- Generic recommendations like "split this component" unless the changed code creates a specific maintainability or correctness problem',
        '',
      );
    }

    if (framework === 'nextjs') {
      console.log('Building React review rules');
      blocks.push(
        '## Framework-Specific Review Rules: Next.js',
        'Check carefully for:',
        '- Server/client boundary mistakes',
        '- Browser-only API usage in server components or server handlers',
        '- Sensitive data accidentally exposed to client-side code',
        '- Fetch/caching/revalidation mistakes',
        '- Route handler correctness and request validation issues',
        '',
      );
    }

    if (framework === 'node') {
      console.log('Building React review rules');
      blocks.push(
        '## Runtime-Specific Review Rules: Node.js',
        'Check carefully for:',
        '- Blocking synchronous work in hot request paths',
        '- Unhandled promise rejections',
        '- Unsafe process, file system, or shell usage',
        '- Missing validation of external input',
        '- Resource leaks and long-lived handlers',
        '',
      );
    }

    if (framework === 'express') {
      console.log('Building React review rules');
      blocks.push(
        '## Framework-Specific Review Rules: Express',
        'Check carefully for:',
        '- Missing validation on req.body, req.query, or req.params',
        '- Missing auth/authz checks where the diff adds sensitive behavior',
        '- Response paths that forget to return and continue execution',
        '- Errors not passed to next() where needed',
        '- Unsafe trust of user-controlled request values',
        '',
      );
    }
  }

  return blocks;
}

function detectPrimaryLanguage(rawDiff: string): ReviewLanguage {
  const paths = extractChangedFilePaths(rawDiff);
  const counts = new Map<ReviewLanguage, number>();

  for (const path of paths) {
    const language = pathToLanguage(path);
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }

  let best: ReviewLanguage = 'unknown';
  let bestCount = 0;

  for (const [language, count] of counts.entries()) {
    if (language === 'unknown') continue;
    if (count > bestCount) {
      best = language;
      bestCount = count;
    }
  }

  return best;
}

function detectFrameworks(rawDiff: string): ReviewFramework[] {
  const paths = extractChangedFilePaths(rawDiff);
  const lowerDiff = rawDiff.toLowerCase();

  const frameworks = new Set<ReviewFramework>();

  const hasReactFile = paths.some((p) => /\.(jsx|tsx)$/.test(p));
  const hasNextSignal = paths.some(
    (p) =>
      p.includes('/app/') ||
      p.includes('/pages/') ||
      p.includes('/api/') ||
      p.includes('next.config.') ||
      p.includes('middleware.ts') ||
      p.includes('middleware.js'),
  );
  const hasExpressSignal =
    lowerDiff.includes('express(') ||
    lowerDiff.includes("from 'express'") ||
    lowerDiff.includes('require(\'express\')') ||
    lowerDiff.includes('router.');
  const hasNodeSignal =
    lowerDiff.includes("from 'node:") ||
    lowerDiff.includes('process.env') ||
    lowerDiff.includes('fs.') ||
    lowerDiff.includes('path.') ||
    paths.some((p) => /\.(cjs|mjs)$/.test(p));

  if (hasReactFile) frameworks.add('react');
  if (hasNextSignal) frameworks.add('nextjs');
  if (hasExpressSignal) frameworks.add('express');
  if (hasNodeSignal || hasExpressSignal) frameworks.add('node');

  return [...frameworks];
}

function extractChangedFilePaths(rawDiff: string): string[] {
  const lines = rawDiff.split('\n');
  const paths: string[] = [];
  const diffHeaderRe = /^diff --git a\/(.+?) b\/(.+?)$/;

  for (const line of lines) {
    const match = diffHeaderRe.exec(line);
    if (match) paths.push(match[2]);
  }

  return paths;
}

function pathToLanguage(path: string): ReviewLanguage {
  if (/\.(js|jsx|mjs|cjs)$/.test(path)) return 'javascript';
  if (/\.(ts|tsx)$/.test(path)) return 'typescript';
  if (/\.py$/.test(path)) return 'python';
  if (/\.java$/.test(path)) return 'java';
  if (/\.go$/.test(path)) return 'go';
  if (/\.rb$/.test(path)) return 'ruby';
  if (/\.php$/.test(path)) return 'php';
  if (/\.cs$/.test(path)) return 'csharp';
  if (/\.rs$/.test(path)) return 'rust';
  return 'unknown';
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