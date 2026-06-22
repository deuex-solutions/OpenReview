import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { sourceFileExtension, type ChangedFile, type RepositoryProvider } from '@openreview/coverage-lib';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
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

function isEsmRepo(repoDir: string): boolean {
  const pkgPath = join(repoDir, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { type?: string };
    return pkg.type === 'module';
  } catch {
    return false;
  }
}

function hasNpmTestScript(repoDir: string): boolean {
  const pkgPath = join(repoDir, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    return Boolean(pkg.scripts?.test?.trim());
  } catch {
    return false;
  }
}

function deriveCoverageInclude(sourcePaths: string[]): string {
  const includes = new Set<string>();
  for (const p of sourcePaths) {
    const normalized = normalizePath(p);
    const parts = normalized.split('/');
    if (parts.length > 1) {
      includes.add(`${parts[0]}/**`);
    } else {
      includes.add(normalized);
    }
  }
  return [...includes].join(',');
}

function isCliEntryPoint(sourcePath: string): boolean {
  const base = sourcePath.split('/').pop() ?? sourcePath;
  return base === 'cli.js' || base === 'main.js' || base === 'index.js';
}

function buildSourceImportCommand(repoDir: string, sourcePaths: string[]): string {
  const importable = sourcePaths
    .map((p) => normalizePath(p))
    .filter((p) => !isCliEntryPoint(p));

  const targets = importable.length > 0 ? importable : sourcePaths.map((p) => normalizePath(p));

  if (targets.length === 0) {
    return 'node -e ""';
  }

  const paths = targets.map((p) => (p.startsWith('./') ? p : `./${p}`));

  if (isEsmRepo(repoDir)) {
    const body = paths
      .map((p) => `try{await import(${shellQuote(p)})}catch(e){}`)
      .join(';');
    return `node --input-type=module -e ${shellQuote(body)}`;
  }

  const body = paths.map((p) => `try{require(${shellQuote(p)})}catch(e){}`).join(';');
  return `node -e ${shellQuote(body)}`;
}

function buildRunTarget(
  repoDir: string,
  sourcePaths: string[],
  testPaths: string[],
): string {
  if (testPaths.length > 0) {
    return `node --test ${testPaths.map(shellQuote).join(' ')}`;
  }

  if (hasNpmTestScript(repoDir)) {
    return 'npm test -- --passWithNoTests';
  }

  return buildSourceImportCommand(repoDir, sourcePaths);
}

function coverageToolPrefix(sourcePaths: string[]): string {
  const include =
    sourcePaths.length > 0
      ? `--include='${deriveCoverageInclude(sourcePaths)}'`
      : "--include='**/*'";

  // c8 uses V8 native coverage and works with ESM; nyc/istanbul often reports 0% for "type":"module" repos.
  return [
    'npx c8',
    '--reporter=cobertura',
    '--reporter=text',
    '--all',
    include,
    "--exclude='tests/**'",
    "--exclude='**/*.test.js'",
    "--exclude='**/*.spec.js'",
    "--exclude='**/*.test.jsx'",
    "--exclude='**/*.spec.jsx'",
    "--exclude='**/*.test.ts'",
    "--exclude='**/*.spec.ts'",
    "--exclude='**/*.test.tsx'",
    "--exclude='**/*.spec.tsx'",
    "--exclude='**/node_modules/**'",
  ].join(' ');
}

export function buildJsCoverageCommand(
  sourcePaths: string[],
  testPaths: string[],
  repoDir?: string,
): string {
  const dir = repoDir ?? '.';
  const runTarget = buildRunTarget(dir, sourcePaths, testPaths);
  return `${coverageToolPrefix(sourcePaths)} ${runTarget}`;
}

export function buildJsTestCommand(
  sourcePaths: string[],
  testPaths: string[],
  repoDir?: string,
): string {
  const dir = repoDir ?? '.';
  return buildRunTarget(dir, sourcePaths, testPaths);
}

function walkJsTestFiles(dir: string, repoDir: string, results: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkJsTestFiles(full, repoDir, results);
    } else if (
      /\.(test|spec)\.(js|jsx|ts|tsx)$/.test(entry) ||
      (entry.startsWith('test_') && /\.(js|jsx|ts|tsx)$/.test(entry))
    ) {
      results.push(normalizePath(relative(repoDir, full)));
    }
  }
}

function guessTestFileNames(sourcePath: string): string[] {
  const normalized = normalizePath(sourcePath);
  const baseName = normalized.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
  const dir = normalized.includes('/')
    ? normalized.replace(/\/[^/]+$/, '')
    : '';
  const dirPart = normalized.includes('/')
    ? normalized.replace(/\.[^.]+$/, '').replace(/\//g, '_')
    : baseName;
  const underTests = normalized.startsWith('src/')
    ? normalized.replace(/^src\//, 'tests/').replace(/\.[^.]+$/, '')
    : `tests/${baseName}`;
  const ext = sourceFileExtension(sourcePath);

  return [
    `${underTests}.test${ext}`,
    `${underTests}.spec${ext}`,
    ...(dir
      ? [
          `${dir}/__test__/${baseName}.test${ext}`,
          `${dir}/__tests__/${baseName}.test${ext}`,
        ]
      : []),
    `${baseName}.test${ext}`,
    `${baseName}.spec${ext}`,
    `test_${baseName}${ext}`,
    `test_${dirPart}${ext}`,
    `tests/${baseName}.test${ext}`,
    `tests/test_${baseName}${ext}`,
    `test/${baseName}.test${ext}`,
  ];
}

function testFileMatchesSource(testPath: string, sourcePath: string): boolean {
  const baseName =
    normalizePath(sourcePath).split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
  const ext = sourceFileExtension(sourcePath);
  const testBase = testPath.split('/').pop() ?? '';
  return (
    testBase.includes(baseName) ||
    testBase === `${baseName}.test${ext}` ||
    testBase === `${baseName}.spec${ext}` ||
    testBase === `test_${baseName}${ext}`
  );
}

export async function collectJsTestPaths(
  repoDir: string,
  changedFiles: ChangedFile[],
  sourcePaths: string[],
  repoProvider: RepositoryProvider,
): Promise<string[]> {
  const testPaths = new Set<string>();

  for (const file of changedFiles) {
    if (!/\.(js|jsx|ts|tsx)$/.test(file.path) || file.status === 'deleted') continue;
    if (isTestFile(file.path)) {
      testPaths.add(normalizePath(file.path));
    }
  }

  for (const sourcePath of sourcePaths) {
    const existing = await repoProvider.findExistingTests(
      repoDir,
      sourcePath,
      'node:test',
    );
    for (const testPath of existing) {
      const rel = normalizePath(
        testPath.startsWith(repoDir)
          ? relative(repoDir, testPath)
          : testPath,
      );
      testPaths.add(rel);
    }

    for (const candidate of guessTestFileNames(sourcePath)) {
      if (existsSync(join(repoDir, candidate))) {
        testPaths.add(normalizePath(candidate));
      }
    }
  }

  if (testPaths.size === 0 && sourcePaths.length > 0) {
    const allTests: string[] = [];
    for (const testsDir of ['tests', 'test', 'src']) {
      walkJsTestFiles(join(repoDir, testsDir), repoDir, allTests);
    }
    for (const testPath of allTests) {
      if (sourcePaths.some((s) => testFileMatchesSource(testPath, s))) {
        testPaths.add(testPath);
      }
    }
  }

  return [...testPaths];
}
