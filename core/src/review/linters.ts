import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { config } from '../config/env.js';

import type { ReviewFinding } from './types.js';

const execFileAsync = promisify(execFile);

const LINTER_TIMEOUT_MS = 30_000;

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Run all enabled linters in parallel on the given file list.
 * Linters that are not installed are silently skipped.
 */
export async function runLinters(
  files: string[],
  repoPath: string,
): Promise<ReviewFinding[]> {
  if (files.length === 0) return [];

  const tasks: Array<Promise<ReviewFinding[]>> = [];

  if (config.linterEslint) tasks.push(runEslint(files, repoPath));
  if (config.linterRuff) tasks.push(runRuff(files, repoPath));
  if (config.linterSemgrep) tasks.push(runSemgrep(files, repoPath));
  if (config.linterShellcheck) tasks.push(runShellcheck(files, repoPath));
  if (config.linterGitleaks) tasks.push(runGitleaks(repoPath));

  const results = await Promise.allSettled(tasks);

  const findings: ReviewFinding[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      findings.push(...result.value);
    }
    // rejected = linter crashed or timed out — already warned inside the runner
  }

  return findings;
}

/**
 * Deduplicate linter findings against AI findings.
 * If a linter finding shares the same file + overlapping line range
 * with an AI finding, merge them into source: 'both'.
 */
export function deduplicateFindings(
  aiFindings: ReviewFinding[],
  linterFindings: ReviewFinding[],
): ReviewFinding[] {
  const merged = [...aiFindings];
  const usedIndices = new Set<number>();

  for (const lf of linterFindings) {
    const matchIdx = merged.findIndex(
      (af) =>
        af.file === lf.file &&
        linesOverlap(af.startLine, af.endLine, lf.startLine, lf.endLine),
    );

    if (matchIdx !== -1) {
      // Merge: keep the AI finding but mark source as 'both' and preserve linter name
      merged[matchIdx] = {
        ...merged[matchIdx],
        source: 'both',
        linterName: lf.linterName,
      };
      usedIndices.add(matchIdx);
    } else {
      merged.push(lf);
    }
  }

  return merged;
}

/* ------------------------------------------------------------------ */
/*  Individual linter runners                                          */
/* ------------------------------------------------------------------ */

async function runEslint(files: string[], cwd: string): Promise<ReviewFinding[]> {
  const tsFiles = files.filter((f) => /\.[jt]sx?$/.test(f));
  if (tsFiles.length === 0) return [];

  const raw = await exec('npx', ['eslint', '--format', 'json', ...tsFiles], cwd, 'ESLint');
  if (!raw) return [];

  return parseEslintOutput(raw);
}

async function runRuff(files: string[], cwd: string): Promise<ReviewFinding[]> {
  const pyFiles = files.filter((f) => f.endsWith('.py'));
  if (pyFiles.length === 0) return [];

  const raw = await exec('ruff', ['check', '--output-format', 'json', ...pyFiles], cwd, 'Ruff');
  if (!raw) return [];

  return parseRuffOutput(raw);
}

async function runSemgrep(files: string[], cwd: string): Promise<ReviewFinding[]> {
  const raw = await exec('semgrep', ['--json', ...files], cwd, 'Semgrep');
  if (!raw) return [];

  return parseSemgrepOutput(raw);
}

async function runShellcheck(files: string[], cwd: string): Promise<ReviewFinding[]> {
  const shellFiles = files.filter((f) => /\.(sh|bash|zsh|ksh)$/.test(f));
  if (shellFiles.length === 0) return [];

  const raw = await exec(
    'shellcheck',
    ['--format=json', ...shellFiles],
    cwd,
    'ShellCheck',
  );
  if (!raw) return [];

  return parseShellcheckOutput(raw);
}

async function runGitleaks(cwd: string): Promise<ReviewFinding[]> {
  const raw = await exec(
    'gitleaks',
    ['detect', '--source', '.', '--report-format', 'json', '--no-git'],
    cwd,
    'Gitleaks',
  );
  if (!raw) return [];

  return parseGitleaksOutput(raw);
}

/* ------------------------------------------------------------------ */
/*  Output parsers                                                     */
/* ------------------------------------------------------------------ */

export function parseEslintOutput(raw: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const data = safeJsonParse<EslintResult[]>(raw);
  if (!data) return findings;

  for (const file of data) {
    if (!file?.filePath || !Array.isArray(file.messages)) continue;
    for (const msg of file.messages) {
      findings.push({
        id: `eslint-${file.filePath}-${msg.line}-${msg.ruleId ?? 'unknown'}`,
        category: msg.severity === 2 ? 'bug' : 'flag',
        severity: msg.severity === 2 ? 'non-severe' : 'informational',
        file: file.filePath,
        startLine: msg.line,
        endLine: msg.endLine ?? msg.line,
        title: `ESLint: ${msg.ruleId ?? 'error'}`,
        explanation: msg.message,
        suggestedFix: msg.fix ? extractEslintFix(msg) : undefined,
        source: 'linter',
        linterName: 'ESLint',
        citations: [],
      });
    }
  }

  return findings;
}

export function parseRuffOutput(raw: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const data = safeJsonParse<RuffDiagnostic[]>(raw);
  if (!data) return findings;

  for (const d of data) {
    if (!d?.filename || !d?.location?.row || !d?.code) continue;
    findings.push({
      id: `ruff-${d.filename}-${d.location.row}-${d.code}`,
      category: 'flag',
      severity: 'non-severe',
      file: d.filename,
      startLine: d.location.row,
      endLine: d.end_location?.row ?? d.location.row,
      title: `Ruff: ${d.code}`,
      explanation: d.message,
      source: 'linter',
      linterName: 'Ruff',
      citations: [],
    });
  }

  return findings;
}

export function parseSemgrepOutput(raw: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const data = safeJsonParse<SemgrepOutput>(raw);
  if (!data?.results) return findings;

  for (const r of data.results) {
    if (!r?.path || !r?.start?.line || !r?.end?.line || !r?.check_id) continue;
    findings.push({
      id: `semgrep-${r.path}-${r.start.line}-${r.check_id}`,
      category: r.extra?.severity === 'ERROR' ? 'bug' : 'flag',
      severity: mapSemgrepSeverity(r.extra?.severity),
      file: r.path,
      startLine: r.start.line,
      endLine: r.end.line,
      title: `Semgrep: ${r.check_id}`,
      explanation: r.extra?.message ?? r.check_id,
      source: 'linter',
      linterName: 'Semgrep',
      citations: [],
    });
  }

  return findings;
}

export function parseShellcheckOutput(raw: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const data = safeJsonParse<ShellcheckDiagnostic[]>(raw);
  if (!data) return findings;

  for (const d of data) {
    if (!d?.file || !d?.line || !d?.code) continue;
    findings.push({
      id: `shellcheck-${d.file}-${d.line}-SC${d.code}`,
      category: d.level === 'error' ? 'bug' : 'flag',
      severity: d.level === 'error' ? 'non-severe' : 'informational',
      file: d.file,
      startLine: d.line,
      endLine: d.endLine ?? d.line,
      title: `ShellCheck: SC${d.code}`,
      explanation: d.message,
      source: 'linter',
      linterName: 'ShellCheck',
      citations: [],
    });
  }

  return findings;
}

export function parseGitleaksOutput(raw: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const data = safeJsonParse<GitleaksLeak[]>(raw);
  if (!data) return findings;

  for (const leak of data) {
    if (!leak?.File || !leak?.StartLine || !leak?.RuleID) continue;
    findings.push({
      id: `gitleaks-${leak.File}-${leak.StartLine}-${leak.RuleID}`,
      category: 'bug',
      severity: 'severe',
      file: leak.File,
      startLine: leak.StartLine,
      endLine: leak.EndLine ?? leak.StartLine,
      title: `Gitleaks: ${leak.RuleID}`,
      explanation: `Secret detected: ${leak.Description}. Match: \`${leak.Match}\``,
      source: 'linter',
      linterName: 'Gitleaks',
      citations: [],
    });
  }

  return findings;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function exec(
  command: string,
  args: string[],
  cwd: string,
  linterName: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd,
      timeout: LINTER_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });
    return stdout;
  } catch (error: unknown) {
    // Many linters exit with code 1 when findings exist — still capture stdout
    if (isExecError(error) && error.stdout) {
      return error.stdout as string;
    }

    if (isExecError(error) && error.code === 'ENOENT') {
      console.warn(`[OpenReview] ${linterName} not found — skipping`);
      return null;
    }

    console.warn(`[OpenReview] ${linterName} failed:`, error instanceof Error ? error.message : error);
    return null;
  }
}

function isExecError(err: unknown): err is NodeJS.ErrnoException & { stdout?: string } {
  return err instanceof Error && 'code' in err;
}

function linesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function extractEslintFix(msg: EslintMessage): string | undefined {
  if (!msg.fix) return undefined;
  // ESLint fix objects contain range + text — we return just the replacement text
  return msg.fix.text;
}

function mapSemgrepSeverity(severity?: string): ReviewFinding['severity'] {
  switch (severity) {
    case 'ERROR':
      return 'severe';
    case 'WARNING':
      return 'non-severe';
    default:
      return 'investigate';
  }
}

/* ------------------------------------------------------------------ */
/*  Linter output types (internal)                                     */
/* ------------------------------------------------------------------ */

interface EslintMessage {
  ruleId: string | null;
  severity: 1 | 2;
  message: string;
  line: number;
  endLine?: number;
  column: number;
  endColumn?: number;
  fix?: { range: [number, number]; text: string };
}

interface EslintResult {
  filePath: string;
  messages: EslintMessage[];
}

interface RuffDiagnostic {
  code: string;
  message: string;
  filename: string;
  location: { row: number; column: number };
  end_location?: { row: number; column: number };
}

interface SemgrepOutput {
  results: Array<{
    check_id: string;
    path: string;
    start: { line: number; col: number };
    end: { line: number; col: number };
    extra?: { message?: string; severity?: string };
  }>;
}

interface ShellcheckDiagnostic {
  file: string;
  line: number;
  endLine?: number;
  column: number;
  endColumn?: number;
  level: 'error' | 'warning' | 'info' | 'style';
  code: number;
  message: string;
}

interface GitleaksLeak {
  RuleID: string;
  Description: string;
  File: string;
  StartLine: number;
  EndLine?: number;
  Match: string;
}
