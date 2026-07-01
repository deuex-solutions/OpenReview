import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { executeSandboxed, verifyDenoInstallation } from '../../../core/src/sandbox/deno-runner.js';

/* ------------------------------------------------------------------ */
/*  Mock child_process.execFile and node:fs for deterministic tests     */
/* ------------------------------------------------------------------ */

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);
const mockWriteFileSync = vi.mocked(writeFileSync);

/* ------------------------------------------------------------------ */
/*  executeSandboxed — edge cases                                      */
/* ------------------------------------------------------------------ */

describe('executeSandboxed — edge cases', () => {
  it('handles empty code string', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as unknown as ExecFileCallback)(null, '', '');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeSandboxed('');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    // Check the written script file contains the GLOBALS preamble
    const writeCall = mockWriteFileSync.mock.calls[mockWriteFileSync.mock.calls.length - 1];
    const writtenContent = writeCall[1] as string;
    expect(writtenContent).toContain('const GLOBALS = {}');
  });

  it('handles empty globals object (default)', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as unknown as ExecFileCallback)(null, '', '');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeSandboxed('console.log("hi")');

    expect(result.exitCode).toBe(0);
    const writeCall = mockWriteFileSync.mock.calls[mockWriteFileSync.mock.calls.length - 1];
    const writtenContent = writeCall[1] as string;
    expect(writtenContent).toContain('const GLOBALS = {};');
    expect(writtenContent).toContain('console.log("hi")');
  });

  it('handles very large globals (big JSON)', async () => {
    const largeGlobals: Record<string, unknown> = {};
    for (let i = 0; i < 1000; i++) {
      largeGlobals[`key_${i}`] = `value_${i}_${'x'.repeat(100)}`;
    }

    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as unknown as ExecFileCallback)(null, '', '');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeSandboxed('console.log(GLOBALS)', largeGlobals);

    expect(result.exitCode).toBe(0);
    const writeCall = mockWriteFileSync.mock.calls[mockWriteFileSync.mock.calls.length - 1];
    const writtenContent = writeCall[1] as string;
    expect(writtenContent).toContain('const GLOBALS = {');
    expect(writtenContent).toContain('"key_999"');
    // Verify the globals are valid JSON by checking the script parses
    const globalsJson = writtenContent.split('const GLOBALS = ')[1].split(';\n\n')[0];
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
