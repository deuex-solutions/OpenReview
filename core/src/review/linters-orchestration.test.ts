import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenReviewConfig } from '../config/env.js';
import type { ReviewFinding } from '../review/types.js';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

// Mock child_process.execFile — promisify(execFile) calls this under the hood
const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

// Mock config with all linters enabled by default
const mockConfig: Partial<OpenReviewConfig> = {
  linterEslint: true,
  linterRuff: true,
  linterSemgrep: true,
  linterShellcheck: true,
  linterGitleaks: true,
};

vi.mock('../config/env.js', () => ({
  config: mockConfig,
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Set up exec to return specific JSON output per linter command.
 * Matches by the first argument (command name or 'npx' for ESLint).
 */
function setupExecFileByCommand(responseMap: Record<string, string>) {
  mockExecFile.mockImplementation(
    (
      cmd: string,
      args: string[],
      _opts: Record<string, unknown>,
      cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      // ESLint runs via 'npx eslint', Gitleaks via 'gitleaks', etc.
      const key = cmd === 'npx' ? 'eslint' : cmd;
      const stdout = responseMap[key];
      if (stdout !== undefined) {
        cb(null, { stdout, stderr: '' });
      } else {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        cb(err, { stdout: '', stderr: '' });
      }
    },
  );
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('runLinters orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all linters to enabled
    mockConfig.linterEslint = true;
    mockConfig.linterRuff = true;
    mockConfig.linterSemgrep = true;
    mockConfig.linterShellcheck = true;
    mockConfig.linterGitleaks = true;
  });

  it('returns empty array when no files provided', async () => {
    const { runLinters } = await import('./linters.js');

    const findings = await runLinters([], '/repo');

    expect(findings).toEqual([]);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('runs only enabled linters', async () => {
    // Disable all except Semgrep
    mockConfig.linterEslint = false;
    mockConfig.linterRuff = false;
    mockConfig.linterShellcheck = false;
    mockConfig.linterGitleaks = false;

    // Return empty results for semgrep
    setupExecFileByCommand({
      semgrep: JSON.stringify({ results: [] }),
    });

    // Re-import to pick up fresh module state
    const { runLinters } = await import('./linters.js');
    const findings = await runLinters(['app.js'], '/repo');

    expect(findings).toEqual([]);
    // Only semgrep should have been called
    const calledCommands = mockExecFile.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(calledCommands).toEqual(['semgrep']);
  });

  it('handles linter execution failure gracefully', async () => {
    // Disable all but ESLint and Semgrep
    mockConfig.linterRuff = false;
    mockConfig.linterShellcheck = false;
    mockConfig.linterGitleaks = false;

    // ESLint succeeds with one finding, Semgrep crashes
    mockExecFile.mockImplementation(
      (
        cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === 'npx') {
          // ESLint succeeds
          cb(null, {
            stdout: JSON.stringify([
              {
                filePath: 'app.js',
                messages: [
                  {
                    ruleId: 'no-undef',
                    severity: 2,
                    message: 'x is not defined',
                    line: 3,
                    column: 1,
                  },
                ],
              },
            ]),
            stderr: '',
          });
        } else {
          // Semgrep crashes — no stdout
          cb(new Error('segfault'), { stdout: '', stderr: '' });
        }
      },
    );

    const { runLinters } = await import('./linters.js');
    const findings = await runLinters(['app.js'], '/repo');

    // ESLint finding should still be returned despite Semgrep failure
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f: ReviewFinding) => f.linterName === 'ESLint')).toBe(true);
  });

  it('returns combined findings from multiple linters', async () => {
    // Only ESLint and Ruff
    mockConfig.linterSemgrep = false;
    mockConfig.linterShellcheck = false;
    mockConfig.linterGitleaks = false;

    mockExecFile.mockImplementation(
      (
        cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === 'npx') {
          // ESLint
          cb(null, {
            stdout: JSON.stringify([
              {
                filePath: 'index.ts',
                messages: [
                  {
                    ruleId: 'no-unused-vars',
                    severity: 1,
                    message: 'unused var',
                    line: 2,
                    column: 1,
                  },
                ],
              },
            ]),
            stderr: '',
          });
        } else if (cmd === 'ruff') {
          cb(null, {
            stdout: JSON.stringify([
              {
                code: 'F401',
                message: 'os imported but unused',
                filename: 'main.py',
                location: { row: 1, column: 1 },
              },
            ]),
            stderr: '',
          });
        } else {
          const err = new Error('ENOENT') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          cb(err, { stdout: '', stderr: '' });
        }
      },
    );

    const { runLinters } = await import('./linters.js');
    const findings = await runLinters(['index.ts', 'main.py'], '/repo');

    expect(findings).toHaveLength(2);
    const linterNames = findings.map((f: ReviewFinding) => f.linterName);
    expect(linterNames).toContain('ESLint');
    expect(linterNames).toContain('Ruff');
  });

  it('handles case where no linters are enabled', async () => {
    mockConfig.linterEslint = false;
    mockConfig.linterRuff = false;
    mockConfig.linterSemgrep = false;
    mockConfig.linterShellcheck = false;
    mockConfig.linterGitleaks = false;

    const { runLinters } = await import('./linters.js');
    const findings = await runLinters(['app.js'], '/repo');

    expect(findings).toEqual([]);
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
