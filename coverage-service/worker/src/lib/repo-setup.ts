import { existsSync } from 'fs';
import { join } from 'path';

import {
  ensurePythonTestConfig,
  ensurePythonVenv,
  PR_COVERAGE_VENV,
  venvDir,
  wrapWithVenvActivate,
} from './python-venv';

export interface RepoSetup {
  isPython: boolean;
  isJavaScript: boolean;
  venvDir: string | null;
  installCommand: string | null;
  wrapCommand: (command: string) => string;
}

export async function setupPythonRepo(
  repoDir: string,
  setup: RepoSetup,
): Promise<RepoSetup> {
  if (!setup.isPython) return setup;

  await ensurePythonVenv(repoDir);
  await ensurePythonTestConfig(repoDir);

  return {
    ...setup,
    venvDir: venvDir(repoDir),
    wrapCommand: (command) => wrapWithVenvActivate(command, repoDir),
  };
}

export function detectRepoSetup(repoDir: string): RepoSetup {
  const hasUvLock = existsSync(join(repoDir, 'uv.lock'));
  const hasPoetryLock = existsSync(join(repoDir, 'poetry.lock'));
  const hasPyproject = existsSync(join(repoDir, 'pyproject.toml'));
  const hasRequirements = existsSync(join(repoDir, 'requirements.txt'));
  const hasPnpmLock = existsSync(join(repoDir, 'pnpm-lock.yaml'));
  const hasYarnLock = existsSync(join(repoDir, 'yarn.lock'));
  const hasPackageLock = existsSync(join(repoDir, 'package-lock.json'));
  const hasPackageJson = existsSync(join(repoDir, 'package.json'));

  const coverageDeps = 'coverage pytest pytest-asyncio';
  const jsCoverageDeps = 'c8 check-code-coverage tsx';
  const noVenv: RepoSetup = {
    isPython: false,
    isJavaScript: false,
    venvDir: null,
    installCommand: null,
    wrapCommand: (cmd) => cmd,
  };

  if (hasUvLock) {
    return {
      isPython: true,
      isJavaScript: false,
      venvDir: null,
      installCommand: [
        `UV_PROJECT_ENVIRONMENT=${PR_COVERAGE_VENV} uv sync --all-groups --all-extras`,
        `pip install ${coverageDeps}`,
      ].join(' && '),
      wrapCommand: (cmd) => cmd,
    };
  }

  if (hasPoetryLock) {
    return {
      isPython: true,
      isJavaScript: false,
      venvDir: null,
      installCommand: [
        'POETRY_VIRTUALENVS_CREATE=false poetry install --no-interaction',
        `pip install ${coverageDeps}`,
      ].join(' && '),
      wrapCommand: (cmd) => cmd,
    };
  }

  if (hasPyproject || hasRequirements) {
    const installParts = [
      hasRequirements ? 'pip install -r requirements.txt' : null,
      hasPyproject
        ? 'pip install -e ".[test]" || pip install -e .'
        : null,
      `pip install ${coverageDeps}`,
    ].filter(Boolean);

    return {
      isPython: true,
      isJavaScript: false,
      venvDir: null,
      installCommand: installParts.join(' && '),
      wrapCommand: (cmd) => cmd,
    };
  }

  const jsInstallBase = hasPackageLock ? 'npm ci' : 'npm install';
  const jsInstallCommand = `${jsInstallBase} && npm install --no-save --legacy-peer-deps ${jsCoverageDeps}`;

  if (hasPnpmLock) {
    return {
      ...noVenv,
      isJavaScript: true,
      installCommand: `pnpm install --frozen-lockfile && pnpm add -D ${jsCoverageDeps}`,
    };
  }

  if (hasYarnLock) {
    return {
      ...noVenv,
      isJavaScript: true,
      installCommand: `yarn install --frozen-lockfile && yarn add -D ${jsCoverageDeps}`,
    };
  }

  if (hasPackageLock || hasPackageJson) {
    return {
      ...noVenv,
      isJavaScript: true,
      installCommand: jsInstallCommand,
    };
  }

  return noVenv;
}
