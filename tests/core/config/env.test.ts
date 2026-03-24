import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loadConfig, validateConfig } from '../../../core/src/config/env.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all OpenReview-related env vars
    const keys = Object.keys(process.env).filter(
      (k) =>
        k.startsWith('OPENAI_') ||
        k.startsWith('ANTHROPIC_') ||
        k.startsWith('GEMINI_') ||
        k.startsWith('MAIN_') ||
        k.startsWith('SUB_') ||
        k.startsWith('MAX_') ||
        k.startsWith('INCLUDE_') ||
        k.startsWith('EXCLUDE_') ||
        k.startsWith('LINTER_') ||
        k.startsWith('REVIEW_') ||
        k.startsWith('MOVE_') ||
        k.startsWith('DEFAULT_') ||
        k.startsWith('GITHUB_') ||
        k.startsWith('OPENREVIEW_'),
    );
    for (const key of keys) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns correct defaults when no env vars set', () => {
    const cfg = loadConfig();

    expect(cfg.mainModel).toBe('gpt-4o');
    expect(cfg.subModel).toBe('gpt-4o-mini');
    expect(cfg.maxIterations).toBe(20);
    expect(cfg.maxLlmCalls).toBe(25);
    expect(cfg.maxFiles).toBe(100);
    expect(cfg.maxFileBytes).toBe(200_000);
    expect(cfg.maxTotalBytes).toBe(5_000_000);
    expect(cfg.includeGlobs).toEqual([]);
    expect(cfg.excludeGlobs).toEqual([]);
    expect(cfg.linterEslint).toBe(true);
    expect(cfg.linterRuff).toBe(true);
    expect(cfg.linterSemgrep).toBe(true);
    expect(cfg.linterShellcheck).toBe(true);
    expect(cfg.linterGitleaks).toBe(true);
    expect(cfg.reviewDrafts).toBe(false);
    expect(cfg.moveDetectionThreshold).toBe(0.8);
    expect(cfg.defaultReviewMode).toBe('fast');
    expect(cfg.openaiApiKey).toBe('');
    expect(cfg.anthropicApiKey).toBe('');
    expect(cfg.geminiApiKey).toBe('');
  });

  it('reads API keys from env', () => {
    process.env.OPENAI_API_KEY = 'sk-test-123';
    process.env.ANTHROPIC_API_KEY = 'ant-key-456';
    process.env.GEMINI_API_KEY = 'gem-key-789';

    const cfg = loadConfig();

    expect(cfg.openaiApiKey).toBe('sk-test-123');
    expect(cfg.anthropicApiKey).toBe('ant-key-456');
    expect(cfg.geminiApiKey).toBe('gem-key-789');
  });

  it('parses boolean vars correctly', () => {
    process.env.REVIEW_DRAFTS = 'true';
    process.env.LINTER_ESLINT = 'false';
    process.env.LINTER_RUFF = '1';
    process.env.LINTER_SEMGREP = 'yes';
    process.env.LINTER_SHELLCHECK = '0';
    process.env.LINTER_GITLEAKS = 'no';

    const cfg = loadConfig();

    expect(cfg.reviewDrafts).toBe(true);
    expect(cfg.linterEslint).toBe(false);
    expect(cfg.linterRuff).toBe(true);
    expect(cfg.linterSemgrep).toBe(true);
    expect(cfg.linterShellcheck).toBe(false);
    expect(cfg.linterGitleaks).toBe(false);
  });

  it('parses comma-separated glob arrays', () => {
    process.env.INCLUDE_GLOBS = 'src/**/*.ts, src/**/*.py';
    process.env.EXCLUDE_GLOBS = 'dist/**, node_modules/**';

    const cfg = loadConfig();

    expect(cfg.includeGlobs).toEqual(['src/**/*.ts', 'src/**/*.py']);
    expect(cfg.excludeGlobs).toEqual(['dist/**', 'node_modules/**']);
  });

  it('handles empty glob strings', () => {
    process.env.INCLUDE_GLOBS = '';
    process.env.EXCLUDE_GLOBS = '  ';

    const cfg = loadConfig();

    expect(cfg.includeGlobs).toEqual([]);
    expect(cfg.excludeGlobs).toEqual([]);
  });

  it('expands ~ in OPENREVIEW_HOME', () => {
    process.env.OPENREVIEW_HOME = '~/my-openreview';

    const cfg = loadConfig();

    expect(cfg.openreviewHome).toBe(resolve(homedir(), 'my-openreview'));
  });

  it('uses default OPENREVIEW_HOME when not set', () => {
    const cfg = loadConfig();

    expect(cfg.openreviewHome).toBe(resolve(homedir(), '.openreview'));
  });

  it('parses integer values', () => {
    process.env.MAX_ITERATIONS = '50';
    process.env.MAX_FILES = '200';

    const cfg = loadConfig();

    expect(cfg.maxIterations).toBe(50);
    expect(cfg.maxFiles).toBe(200);
  });

  it('falls back to defaults for invalid integers', () => {
    process.env.MAX_ITERATIONS = 'not-a-number';

    const cfg = loadConfig();

    expect(cfg.maxIterations).toBe(20);
  });

  it('parses float values', () => {
    process.env.MOVE_DETECTION_THRESHOLD = '0.9';

    const cfg = loadConfig();

    expect(cfg.moveDetectionThreshold).toBe(0.9);
  });

  it('parses DEFAULT_REVIEW_MODE', () => {
    process.env.DEFAULT_REVIEW_MODE = 'rlm';
    expect(loadConfig().defaultReviewMode).toBe('rlm');

    process.env.DEFAULT_REVIEW_MODE = 'fast';
    expect(loadConfig().defaultReviewMode).toBe('fast');

    process.env.DEFAULT_REVIEW_MODE = 'invalid';
    expect(loadConfig().defaultReviewMode).toBe('fast');
  });

  it('trims whitespace from values', () => {
    process.env.OPENAI_API_KEY = '  sk-test-123  ';
    process.env.MAIN_MODEL = '  claude-3-opus  ';

    const cfg = loadConfig();

    expect(cfg.openaiApiKey).toBe('sk-test-123');
    expect(cfg.mainModel).toBe('claude-3-opus');
  });
});

describe('validateConfig', () => {
  it('throws when no API key is set', () => {
    const cfg = loadConfig();
    cfg.openaiApiKey = '';
    cfg.anthropicApiKey = '';
    cfg.geminiApiKey = '';

    expect(() => validateConfig(cfg)).toThrow('requires at least one LLM API key');
  });

  it('does not throw when OpenAI key is set', () => {
    const cfg = loadConfig();
    cfg.openaiApiKey = 'sk-test';

    expect(() => validateConfig(cfg)).not.toThrow();
  });

  it('does not throw when Anthropic key is set', () => {
    const cfg = loadConfig();
    cfg.anthropicApiKey = 'ant-key';

    expect(() => validateConfig(cfg)).not.toThrow();
  });

  it('does not throw when Gemini key is set', () => {
    const cfg = loadConfig();
    cfg.geminiApiKey = 'gem-key';

    expect(() => validateConfig(cfg)).not.toThrow();
  });
});
