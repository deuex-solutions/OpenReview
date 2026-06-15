import { existsSync } from 'fs';
import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import type { ChangedFile, RepositoryProvider } from '@openreview/coverage-lib';
import { pythonBin } from './python-bin';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function isTestFile(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  return (
    base.startsWith('test_') ||
    path.includes('.test.') ||
    path.includes('.spec.') ||
    path.startsWith('tests/') ||
    path.startsWith('test/')
  );
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function moduleName(sourcePath: string): string {
  return normalizePath(sourcePath).replace(/\.py$/, '').replace(/\//g, '.');
}

/** Top-level package dirs to pass as --source (e.g. cli/main.py → cli). */
export function deriveCoverageSources(sourcePaths: string[]): string {
  const sources = new Set<string>();
  for (const p of sourcePaths) {
    const parts = normalizePath(p).split('/');
    sources.add(parts.length > 1 ? parts[0] : '.');
  }
  return [...sources].join(',');
}

function coverageModule(repoDir?: string): string {
  return `${pythonBin(repoDir)} -m coverage`;
}

function buildRunTarget(
  sourcePaths: string[],
  testPaths: string[],
  repoDir?: string,
): string {
  if (testPaths.length > 0) {
    return `-m pytest ${testPaths.map(shellQuote).join(' ')}`;
  }

  // No matching tests — import changed modules directly (import-time coverage).
  const imports = sourcePaths.map((p) => `import ${moduleName(p)}`).join('; ');
  return `${pythonBin(repoDir)} -c ${shellQuote(imports)}`;
}

export function buildPythonCoverageCommand(
  sourcePaths: string[],
  testPaths: string[],
  repoDir?: string,
): string {
  const coverage = coverageModule(repoDir);
  if (sourcePaths.length === 0) {
    return `${coverage} erase; ${coverage} xml || true`;
  }

  const include = sourcePaths.map(normalizePath).join(',');
  const source = deriveCoverageSources(sourcePaths);
  const runTarget = buildRunTarget(sourcePaths, testPaths, repoDir);

  return [
    `${coverage} erase`,
    `${coverage} run --source='${source}' ${runTarget}`,
    `${coverage} xml --include='${include}' || true`,
  ].join('; ');
}

export function buildPythonTestCommand(
  sourcePaths: string[],
  testPaths: string[],
  repoDir?: string,
): string {
  const python = pythonBin(repoDir);
  if (testPaths.length > 0) {
    return `${python} -m pytest ${testPaths.map(shellQuote).join(' ')}`;
  }
  const imports = sourcePaths.map((p) => `import ${moduleName(p)}`).join('; ');
  return `${python} -c ${shellQuote(imports)}`;
}

function walkPyFiles(dir: string, repoDir: string, results: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === '__pycache__' || entry === '.git') continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkPyFiles(full, repoDir, results);
    } else if (entry.endsWith('.py') && isTestFile(relative(repoDir, full))) {
      results.push(normalizePath(relative(repoDir, full)));
    }
  }
}

function guessTestFileNames(sourcePath: string): string[] {
  const normalized = normalizePath(sourcePath);
  const baseName = normalized.split('/').pop()?.replace(/\.py$/, '') ?? '';
  const dirPart = normalized.includes('/')
    ? normalized.replace(/\.py$/, '').replace(/\//g, '_')
    : baseName;

  return [
    `test_${baseName}.py`,
    `test_${dirPart}.py`,
    `${baseName}_test.py`,
    `${dirPart}_test.py`,
  ];
}

function testFileMatchesSource(testPath: string, sourcePath: string): boolean {
  const baseName = normalizePath(sourcePath).split('/').pop()?.replace(/\.py$/, '') ?? '';
  const testBase = testPath.split('/').pop() ?? '';
  const mod = moduleName(sourcePath);

  return (
    testBase === `test_${baseName}.py` ||
    testBase.includes(baseName) ||
    testBase.includes(mod.replace(/\./g, '_'))
  );
}

export async function collectPythonTestPaths(
  repoDir: string,
  changedFiles: ChangedFile[],
  sourcePaths: string[],
  repoProvider: RepositoryProvider,
): Promise<string[]> {
  const testPaths = new Set<string>();

  for (const file of changedFiles) {
    if (!file.path.endsWith('.py') || file.status === 'deleted') continue;
    if (isTestFile(file.path)) {
      testPaths.add(normalizePath(file.path));
    }
  }

  for (const sourcePath of sourcePaths) {
    const existing = await repoProvider.findExistingTests(repoDir, sourcePath);
    for (const absPath of existing) {
      testPaths.add(normalizePath(relative(repoDir, absPath)));
    }

    for (const testsDir of ['tests', 'test']) {
      for (const name of guessTestFileNames(sourcePath)) {
        const candidate = join(testsDir, name);
        if (existsSync(join(repoDir, candidate))) {
          testPaths.add(normalizePath(candidate));
        }
      }
    }
  }

  if (testPaths.size === 0 && sourcePaths.length > 0) {
    const allTests: string[] = [];
    for (const testsDir of ['tests', 'test']) {
      walkPyFiles(join(repoDir, testsDir), repoDir, allTests);
    }
    for (const testPath of allTests) {
      if (sourcePaths.some((s) => testFileMatchesSource(testPath, s))) {
        testPaths.add(testPath);
      }
    }
  }

  return [...testPaths];
}
