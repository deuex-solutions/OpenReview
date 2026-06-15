import { existsSync } from 'fs';
import { join } from 'path';

const PR_COVERAGE_VENV = '.pr-coverage-venv';

export function systemPythonBin(): string {
  return process.env.PYTHON_BIN?.trim() || 'python3';
}

/** Python executable for repo commands; prefers the per-run virtualenv when present. */
export function pythonBin(repoDir?: string): string {
  if (repoDir) {
    const venvPy = join(repoDir, PR_COVERAGE_VENV, 'bin', 'python');
    if (existsSync(venvPy)) return venvPy;
  }
  return systemPythonBin();
}
