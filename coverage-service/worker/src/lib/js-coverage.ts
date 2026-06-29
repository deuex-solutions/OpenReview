import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

import { sourceFileExtension, type ChangedFile, type RepositoryProvider } from '@openreview/coverage-lib';

import { needsJsTranspileLoader } from './repo-packages.js';

const TEST_REGISTER_PATH = '.openreview-test-register.cjs';
const TEST_LOADER_PATH = '.openreview-test-loader.mjs';
const TEST_REGISTER_CONTENT = `const noop = (module) => { module.exports = {}; };
for (const ext of ['.css', '.scss', '.sass', '.less', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp']) {
  require.extensions[ext] = noop;
}
`;
const TEST_LOADER_CONTENT = `const ASSET_EXTENSIONS = /\\.(css|scss|sass|less|svg|png|jpg|jpeg|gif|webp)(\\?.*)?$/;

export async function load(url, context, nextLoad) {
  if (ASSET_EXTENSIONS.test(url)) {
    return { format: 'module', source: 'export default {};', shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Escape glob metacharacters so c8/node --test match literal paths (e.g. [matchId] routes). */
export function escapeGlobPathForC8(path: string): string {
  return normalizePath(path)
    .split('/')
    .map((segment) =>
      [...segment]
        .map((char) => (char === '[' ? '[[]' : char === ']' ? '[]]' : char))
        .join(''),
    )
    .join('/');
}

/** Write tsx/CSS loader hooks before running coverage or tests (avoids sh -c setup chains). */
export function prepareJsTestHarness(
  repoDir: string,
  sourcePaths: string[],
  testPaths: string[],
): void {
  const runtimePaths = [...testPaths, ...sourcePaths];
  if (!needsRuntimeRegister(runtimePaths)) return;

  writeFileSync(join(repoDir, TEST_REGISTER_PATH), TEST_REGISTER_CONTENT);
  writeFileSync(join(repoDir, TEST_LOADER_PATH), TEST_LOADER_CONTENT);
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

function isCliEntryPoint(sourcePath: string): boolean {
  const base = sourcePath.split('/').pop() ?? sourcePath;
  return base === 'cli.js' || base === 'main.js' || base === 'index.js';
}

function needsRuntimeRegister(paths: string[]): boolean {
  return needsJsTranspileLoader(paths);
}

function runtimeRegisterSetupCommand(_paths: string[]): string | null {
  return null;
}

function nodeLoaderPrefix(paths: string[]): string {
  if (!needsJsTranspileLoader(paths)) return '';
  const loaderRegister =
    `data:text/javascript,import { register } from "node:module"; ` +
    `import { pathToFileURL } from "node:url"; ` +
    `register("./${TEST_LOADER_PATH}", pathToFileURL("./"));`;
  return [
    '--require',
    shellQuote(`./${TEST_REGISTER_PATH}`),
    '--import',
    shellQuote(loaderRegister),
    '--import',
    'tsx',
    '',
  ].join(' ');
}

function withRuntimeRegister(paths: string[], command: string): string {
  const setup = runtimeRegisterSetupCommand(paths);
  return setup ? `${setup} && ${command}` : command;
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
  const loader = nodeLoaderPrefix(targets);

  if (isEsmRepo(repoDir)) {
    const body = paths
      .map((p) => `try{await import(${shellQuote(p)})}catch(e){}`)
      .join(';');
    return withRuntimeRegister(targets, `node ${loader}--input-type=module -e ${shellQuote(body)}`);
  }

  const body = paths.map((p) => `try{require(${shellQuote(p)})}catch(e){}`).join(';');
  return withRuntimeRegister(targets, `node ${loader}-e ${shellQuote(body)}`);
}

function buildRunTarget(
  repoDir: string,
  sourcePaths: string[],
  testPaths: string[],
): string {
  if (testPaths.length > 0) {
    const runtimePaths = [...testPaths, ...sourcePaths];
    const loader = nodeLoaderPrefix(runtimePaths);
    return withRuntimeRegister(
      runtimePaths,
      `node ${loader}--test ${testPaths.map((p) => shellQuote(escapeGlobPathForC8(p))).join(' ')}`,
    );
  }

  // No PR-specific tests were found. Avoid running the repository-wide test
  // suite here; import only changed source files so diff coverage stays scoped
  // to the PR files under analysis.
  return buildSourceImportCommand(repoDir, sourcePaths);
}

function coverageToolPrefix(sourcePaths: string[]): string {
  const includes =
    sourcePaths.length > 0
      ? sourcePaths.map(
          (p) => `--include=${shellQuote(escapeGlobPathForC8(p))}`,
        )
      : ["--include='**/*'"];

  // c8 uses V8 native coverage and works with ESM; nyc/istanbul often reports 0% for "type":"module" repos.
  return [
    'npx c8',
    '--reporter=cobertura',
    '--reporter=text',
    '--all',
    ...includes,
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

/** c8 only collects V8 coverage from its direct child process. */
function wrapForCoverageInstrumentedChild(command: string): string {
  if (!command.includes(' && ')) return command;
  return `sh -c ${shellQuote(command)}`;
}

export function buildJsCoverageCommand(
  sourcePaths: string[],
  testPaths: string[],
  repoDir?: string,
): string {
  const dir = repoDir ?? '.';
  const runTarget = wrapForCoverageInstrumentedChild(
    buildRunTarget(dir, sourcePaths, testPaths),
  );
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

function isNodeTestCompatible(repoDir: string, testPath: string): boolean {
  let content: string;
  try {
    content = readFileSync(join(repoDir, testPath), 'utf-8');
  } catch {
    return false;
  }

  if (/\bfrom\s+['"](?:node:)?test['"]/.test(content) || /require\(\s*['"](?:node:)?test['"]\s*\)/.test(content)) {
    return true;
  }

  if (/\bfrom\s+['"](?:vitest|@jest\/globals)['"]/.test(content)) {
    return false;
  }

  return !/\b(?:describe|it|expect|beforeEach|afterEach)\s*\(/.test(content);
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
      const normalized = normalizePath(file.path);
      if (isNodeTestCompatible(repoDir, normalized)) {
        testPaths.add(normalized);
      }
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
      if (existsSync(join(repoDir, candidate)) && isNodeTestCompatible(repoDir, candidate)) {
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
      if (
        isNodeTestCompatible(repoDir, testPath) &&
        sourcePaths.some((s) => testFileMatchesSource(testPath, s))
      ) {
        testPaths.add(testPath);
      }
    }
  }

  return [...testPaths];
}
