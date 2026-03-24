import { execFile } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { executeSandboxed, verifyDenoInstallation } from '../../../core/src/sandbox/deno-runner.js';

/* ------------------------------------------------------------------ */
/*  Mock child_process.execFile for deterministic tests                */
/* ------------------------------------------------------------------ */

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);

/* ------------------------------------------------------------------ */
/*  executeSandboxed — edge cases                                      */
/* ------------------------------------------------------------------ */

describe('executeSandboxed — edge cases', () => {
  it('handles empty code string', async () => {
    let capturedScript = '';

    mockExecFile.mockImplementation((_cmd, args, _opts, cb) => {
      const argsArr = args as string[];
      capturedScript = argsArr[argsArr.length - 1];
      (cb as unknown as ExecFileCallback)(null, '', '');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeSandboxed('');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    // The script should still contain the GLOBALS preamble followed by empty code
    expect(capturedScript).toContain('const GLOBALS = {}');
  });

  it('handles empty globals object (default)', async () => {
    let capturedScript = '';

    mockExecFile.mockImplementation((_cmd, args, _opts, cb) => {
      const argsArr = args as string[];
      capturedScript = argsArr[argsArr.length - 1];
      (cb as unknown as ExecFileCallback)(null, '', '');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeSandboxed('console.log("hi")');

    expect(result.exitCode).toBe(0);
    expect(capturedScript).toContain('const GLOBALS = {};');
    expect(capturedScript).toContain('console.log("hi")');
  });

  it('handles very large globals (big JSON)', async () => {
    let capturedScript = '';
    const largeGlobals: Record<string, unknown> = {};
    for (let i = 0; i < 1000; i++) {
      largeGlobals[`key_${i}`] = `value_${i}_${'x'.repeat(100)}`;
    }

    mockExecFile.mockImplementation((_cmd, args, _opts, cb) => {
      const argsArr = args as string[];
      capturedScript = argsArr[argsArr.length - 1];
      (cb as unknown as ExecFileCallback)(null, '', '');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeSandboxed('console.log(GLOBALS)', largeGlobals);

    expect(result.exitCode).toBe(0);
    expect(capturedScript).toContain('const GLOBALS = {');
    expect(capturedScript).toContain('"key_999"');
    // Verify the globals are valid JSON by checking the script parses
    const globalsJson = capturedScript.split('const GLOBALS = ')[1].split(';\n\n')[0];
    expect(() => JSON.parse(globalsJson)).not.toThrow();
  });

  it('exit code extraction: exit code 2 (not just 1)', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      const error = Object.assign(new Error('exit 2'), { code: 2 });
      (cb as unknown as ExecFileCallback)(error, '', 'error: something went wrong\n');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeSandboxed('Deno.exit(2)');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('something went wrong');
  });

  it('exit code extraction: string error.code (like ENOENT) falls back to 1', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      const error = Object.assign(new Error('spawn deno ENOENT'), { code: 'ENOENT' });
      (cb as unknown as ExecFileCallback)(error, '', '');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeSandboxed('console.log("test")');

    expect(result.exitCode).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  verifyDenoInstallation — edge cases                                */
/* ------------------------------------------------------------------ */

describe('verifyDenoInstallation — edge cases', () => {
  it('passes with Deno 3.0.0 (major >= 2 and > 7)', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as unknown as ExecFileCallback)(
        null,
        'deno 3.0.0 (release, x86_64-unknown-linux-gnu)\nv8 14.0\ntypescript 6.0.0\n',
        '',
      );
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    const version = await verifyDenoInstallation();
    expect(version).toBe('3.0.0');
  });

  it('passes with Deno 2.7.0 (exact minimum)', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as unknown as ExecFileCallback)(
        null,
        'deno 2.7.0 (release, aarch64-apple-darwin)\nv8 13.0\ntypescript 5.7.3\n',
        '',
      );
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    const version = await verifyDenoInstallation();
    expect(version).toBe('2.7.0');
  });
});
