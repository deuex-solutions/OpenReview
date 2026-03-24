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
/*  verifyDenoInstallation                                             */
/* ------------------------------------------------------------------ */

describe('verifyDenoInstallation', () => {
  it('resolves with version string when Deno 2.7+ is present', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as unknown as ExecFileCallback)(
        null,
        'deno 2.7.3 (release, aarch64-apple-darwin)\nv8 13.0\ntypescript 5.7.3\n',
        '',
      );
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    const version = await verifyDenoInstallation();
    expect(version).toBe('2.7.3');
  });

  it('rejects when Deno is not installed', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as unknown as ExecFileCallback)(new Error('ENOENT'), '', '');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    await expect(verifyDenoInstallation()).rejects.toThrow('Deno is not installed');
  });

  it('rejects when Deno version is too old', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as unknown as ExecFileCallback)(null, 'deno 2.5.1 (release)\n', '');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    await expect(verifyDenoInstallation()).rejects.toThrow('requires Deno 2.7+');
  });

  it('rejects when version output cannot be parsed', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as unknown as ExecFileCallback)(null, 'some unexpected output\n', '');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    await expect(verifyDenoInstallation()).rejects.toThrow('Unable to parse Deno version');
  });
});

/* ------------------------------------------------------------------ */
/*  executeSandboxed                                                   */
/* ------------------------------------------------------------------ */

describe('executeSandboxed', () => {
  it('returns stdout and exitCode 0 on successful execution', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as unknown as ExecFileCallback)(null, 'hello world\n', '');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeSandboxed('console.log("hello world")');
    expect(result.stdout).toBe('hello world\n');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('passes globals as GLOBALS constant in the script', async () => {
    let capturedScript = '';

    mockExecFile.mockImplementation((_cmd, args, _opts, cb) => {
      // Script is the last argument after flags: eval --ext=ts --allow-read --deny-* <script>
      const argsArr = args as string[];
      capturedScript = argsArr[argsArr.length - 1];
      (cb as unknown as ExecFileCallback)(null, '', '');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    await executeSandboxed('console.log(GLOBALS.name)', { name: 'test-repo', lines: [1, 2, 3] });

    expect(capturedScript).toContain('const GLOBALS = {"name":"test-repo","lines":[1,2,3]}');
    expect(capturedScript).toContain('console.log(GLOBALS.name)');
  });

  it('returns stderr and non-zero exitCode on syntax error', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      const error = Object.assign(new Error('exit 1'), { code: 1 });
      (cb as unknown as ExecFileCallback)(error, '', 'error: Unexpected token\n');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeSandboxed('invalid{{{code');
    expect(result.stderr).toContain('Unexpected token');
    expect(result.exitCode).toBe(1);
  });

  it('returns timeout result when execution exceeds timeout', async () => {
    mockExecFile.mockImplementation((_cmd, _args, opts, cb) => {
      // Simulate the AbortController firing
      const options = opts as { signal: AbortSignal };
      options.signal.addEventListener('abort', () => {
        const error = Object.assign(new Error('aborted'), { code: 'ABORT_ERR' });
        (cb as unknown as ExecFileCallback)(error, '', '');
      });
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeSandboxed('while(true){}', {}, 50);
    expect(result.stderr).toContain('timed out');
    expect(result.exitCode).toBe(124);
  });

  it('captures stdout and stderr separately', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as unknown as ExecFileCallback)(null, 'output line\n', 'warning line\n');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeSandboxed('/* code */');
    expect(result.stdout).toBe('output line\n');
    expect(result.stderr).toBe('warning line\n');
    expect(result.exitCode).toBe(0);
  });

  it('uses deno eval with explicit sandbox permission flags', async () => {
    let capturedArgs: string[] = [];

    mockExecFile.mockImplementation((_cmd, args, _opts, cb) => {
      capturedArgs = args as string[];
      (cb as unknown as ExecFileCallback)(null, '', '');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    await executeSandboxed('console.log("safe")');

    expect(capturedArgs[0]).toBe('eval');
    expect(capturedArgs[1]).toBe('--ext=ts');
    // Should explicitly allow read and deny dangerous permissions
    expect(capturedArgs).toContain('--allow-read');
    expect(capturedArgs).toContain('--deny-net');
    expect(capturedArgs).toContain('--deny-write');
    expect(capturedArgs).toContain('--deny-env');
    expect(capturedArgs).toContain('--deny-run');
    // Should NOT allow dangerous permissions
    expect(capturedArgs).not.toContain('--allow-net');
    expect(capturedArgs).not.toContain('--allow-write');
    expect(capturedArgs).not.toContain('--allow-env');
    expect(capturedArgs).not.toContain('--allow-run');
  });

  it('strips inherited environment variables to prevent secret leakage', async () => {
    let capturedEnv: Record<string, string> = {};

    mockExecFile.mockImplementation((_cmd, _args, opts, cb) => {
      capturedEnv = (opts as { env: Record<string, string> }).env;
      (cb as unknown as ExecFileCallback)(null, '', '');
      return undefined as unknown as ReturnType<typeof execFile>;
    });

    await executeSandboxed('console.log("env test")');

    const keys = Object.keys(capturedEnv);
    expect(keys).toContain('PATH');
    expect(keys).toContain('HOME');
    expect(keys).toContain('DENO_DIR');
    expect(keys).not.toContain('OPENAI_API_KEY');
    expect(keys).not.toContain('GITHUB_TOKEN');
    expect(keys.length).toBe(3);
  });
});
