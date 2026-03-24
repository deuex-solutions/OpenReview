import { execFile } from 'node:child_process';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

/* ------------------------------------------------------------------ */
/*  Deno detection                                                     */
/* ------------------------------------------------------------------ */

/**
 * Verify Deno 2.7+ is installed. Throws a descriptive error if missing
 * or if the installed version is too old.
 */
export async function verifyDenoInstallation(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('deno', ['--version'], { timeout: 5_000 }, (error, stdout) => {
      if (error) {
        reject(
          new Error(
            'Deno is not installed or not found on PATH. ' +
              'RLM deep mode requires Deno 2.7+. Install from https://deno.land',
          ),
        );
        return;
      }

      const match = stdout.match(/deno\s+(\d+)\.(\d+)\.(\d+)/);
      if (!match) {
        reject(new Error(`Unable to parse Deno version from output: ${stdout.trim()}`));
        return;
      }

      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      const version = `${match[1]}.${match[2]}.${match[3]}`;

      if (major < 2 || (major === 2 && minor < 7)) {
        reject(
          new Error(
            `Deno ${version} is installed but RLM deep mode requires Deno 2.7+. ` +
              'Please upgrade: https://deno.land',
          ),
        );
        return;
      }

      resolve(version);
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Sandbox execution                                                  */
/* ------------------------------------------------------------------ */

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Build a Deno script that injects `globals` as a top-level `const GLOBALS`
 * and then runs the user-supplied `code`.
 */
function buildScript(code: string, globals: Record<string, unknown>): string {
  const serialized = JSON.stringify(globals);
  return `const GLOBALS = ${serialized};\n\n${code}`;
}

/**
 * Execute arbitrary code inside a Deno sandbox with strict permissions:
 * - `--allow-read` only (no network, no write, no env)
 * - Hard timeout via AbortController
 *
 * `globals` are injected as `GLOBALS` constant available in user code.
 */
export async function executeSandboxed(
  code: string,
  globals: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SandboxResult> {
  const script = buildScript(code, globals);
  const start = Date.now();

  return new Promise((resolve) => {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    execFile(
      'deno',
      [
        'eval',
        '--ext=ts',
        '--allow-read',
        '--deny-net',
        '--deny-write',
        '--deny-env',
        '--deny-run',
        script,
      ],
      {
        signal: controller.signal,
        timeout: timeoutMs + 1_000, // extra buffer for OS-level timeout
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        env: {
          // Minimal env — no inherited secrets
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          DENO_DIR: process.env.DENO_DIR ?? '',
          // Deno permission flags via env are not used — we rely on CLI flags
        },
      },
      (error, stdout, stderr) => {
        clearTimeout(timeout);
        const duration = Date.now() - start;

        if (error && controller.signal.aborted) {
          resolve({
            stdout: '',
            stderr: `Sandbox execution timed out after ${timeoutMs}ms`,
            exitCode: 124, // conventional timeout exit code
            duration,
          });
          return;
        }

        // Node's ExecException sets `code` to a number (the exit code) for
        // process exits, and a string (e.g. 'ENOENT') for system errors.
        const rawCode = error ? (error as { code?: string | number }).code : 0;
        const exitCode = typeof rawCode === 'number' ? rawCode : 1;

        resolve({
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
          exitCode,
          duration,
        });
      },
    );
  });
}
