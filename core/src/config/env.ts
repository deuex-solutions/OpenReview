import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

loadDotenv();

function envString(key: string, defaultValue: string): string {
  return process.env[key]?.trim() || defaultValue;
}

function envInt(key: string, defaultValue: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function envFloat(key: string, defaultValue: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return defaultValue;
  const parsed = parseFloat(raw);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function envBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key]?.trim()?.toLowerCase();
  if (raw === undefined || raw === '') return defaultValue;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function envStringArray(key: string): string[] {
  const raw = process.env[key]?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function expandHome(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return resolve(homedir(), filepath.slice(2));
  }
  return resolve(filepath);
}

export interface OpenReviewConfig {
  // LLM provider keys
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;

  // Model selection
  mainModel: string;
  subModel: string;

  // Review limits
  maxIterations: number;
  maxLlmCalls: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;

  // File filtering
  includeGlobs: string[];
  excludeGlobs: string[];

  // Linters
  linterEslint: boolean;
  linterRuff: boolean;
  linterSemgrep: boolean;
  linterShellcheck: boolean;
  linterGitleaks: boolean;

  // Review behavior
  reviewDrafts: boolean;
  moveDetectionThreshold: number;
  defaultReviewMode: 'fast' | 'rlm';

  // GitHub
  githubPat: string;
  githubToken: string;

  // Storage
  openreviewHome: string;

  // OpenAI-compatible endpoint
  openaiBaseUrl: string;
}

export function loadConfig(): OpenReviewConfig {
  const openreviewHome = expandHome(envString('OPENREVIEW_HOME', '~/.openreview'));

  const modeRaw = envString('DEFAULT_REVIEW_MODE', 'fast');
  const defaultReviewMode = modeRaw === 'rlm' ? 'rlm' : 'fast';

  return {
    openaiApiKey: envString('OPENAI_API_KEY', ''),
    anthropicApiKey: envString('ANTHROPIC_API_KEY', ''),
    geminiApiKey: envString('GEMINI_API_KEY', ''),

    mainModel: envString('MAIN_MODEL', 'gpt-4o'),
    subModel: envString('SUB_MODEL', 'gpt-4o-mini'),

    maxIterations: envInt('MAX_ITERATIONS', 20),
    maxLlmCalls: envInt('MAX_LLM_CALLS', 250),
    maxFiles: envInt('MAX_FILES', 100),
    maxFileBytes: envInt('MAX_FILE_BYTES', 200_000),
    maxTotalBytes: envInt('MAX_TOTAL_BYTES', 5_000_000),

    includeGlobs: envStringArray('INCLUDE_GLOBS'),
    excludeGlobs: envStringArray('EXCLUDE_GLOBS'),

    linterEslint: envBool('LINTER_ESLINT', true),
    linterRuff: envBool('LINTER_RUFF', true),
    linterSemgrep: envBool('LINTER_SEMGREP', true),
    linterShellcheck: envBool('LINTER_SHELLCHECK', true),
    linterGitleaks: envBool('LINTER_GITLEAKS', true),

    reviewDrafts: envBool('REVIEW_DRAFTS', false),
    moveDetectionThreshold: envFloat('MOVE_DETECTION_THRESHOLD', 0.8),
    defaultReviewMode,

    githubPat: envString('GITHUB_PAT', ''),
    githubToken: envString('GITHUB_TOKEN', ''),

    openreviewHome,

    openaiBaseUrl: envString('OPENAI_BASE_URL', ''),
  };
}

export function validateConfig(cfg: OpenReviewConfig): void {
  const hasKey = cfg.openaiApiKey || cfg.anthropicApiKey || cfg.geminiApiKey;
  if (!hasKey) {
    throw new Error(
      'OpenReview requires at least one LLM API key. ' +
        'Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY in your .env file.',
    );
  }
}

export const config = loadConfig();
