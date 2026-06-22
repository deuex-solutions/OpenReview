/** Extension including dot for a JS/TS source file (.js, .jsx, .ts, .tsx). */
export function sourceFileExtension(sourceFile: string): string {
  const match = sourceFile.match(/\.(tsx|jsx|ts|js)$/);
  return match ? `.${match[1]}` : '.js';
}

const JS_COLOCATED_TEST_SUFFIXES = [
  '.test.ts',
  '.spec.ts',
  '.test.tsx',
  '.spec.tsx',
  '.test.js',
  '.spec.js',
  '.test.jsx',
  '.spec.jsx',
] as const;

/** Colocated test paths next to a source file (all common JS/TS test suffixes). */
export function colocatedJavaScriptTestPaths(sourceFile: string): string[] {
  const baseName = sourceFile.replace(/\.(js|jsx|ts|tsx)$/, '');
  return JS_COLOCATED_TEST_SUFFIXES.map((suffix) => `${baseName}${suffix}`);
}

/** Common __test__ / __tests__ directory layouts (e.g. src/utils/__test__/mathUtils.test.js). */
export function nestedJavaScriptTestPaths(sourceFile: string): string[] {
  const dir = sourceFile.split('/').slice(0, -1).join('/');
  const base = sourceFile.split('/').pop()!.replace(/\.[^.]+$/, '');
  const ext = sourceFileExtension(sourceFile);
  const suffixes = ['.test', '.spec'] as const;

  const paths: string[] = [];
  for (const folder of ['__test__', '__tests__'] as const) {
    for (const suffix of suffixes) {
      paths.push(`${dir}/${folder}/${base}${suffix}${ext}`);
    }
  }
  return paths;
}

export function isJavaScriptTestFileName(fileName: string): boolean {
  return (
    JS_COLOCATED_TEST_SUFFIXES.some((suffix) => fileName.endsWith(suffix)) ||
    (fileName.startsWith('test_') && /\.(js|jsx|ts|tsx)$/.test(fileName))
  );
}

/** Infer a test file path that mirrors src/ under tests/ for JS/TS projects. */
export function inferJavaScriptTestFilePath(sourceFile: string): string {
  const ext = sourceFileExtension(sourceFile);
  const withoutExt = sourceFile.replace(/\.(js|jsx|ts|tsx)$/, '');

  if (withoutExt.startsWith('src/')) {
    return `${withoutExt.replace(/^src\//, 'tests/')}.test${ext}`;
  }

  const base = sourceFile.split('/').pop()!.replace(/\.[^.]+$/, '');
  return `tests/${base}.test${ext}`;
}

/** Relative import path from a test file to its production source (ESM). */
export function inferSourceImportPath(testFile: string, sourceFile: string): string {
  const testDir = testFile.split('/').slice(0, -1);
  const sourceParts = sourceFile.split('/');
  let rel = '';

  for (let i = 0; i < testDir.length; i++) {
    if (testDir[i] === sourceParts[i]) continue;
    rel = '../'.repeat(testDir.length - i) + sourceParts.slice(i).join('/');
    break;
  }

  if (!rel) {
    rel = sourceParts.slice(testDir.length).join('/') || sourceParts[sourceParts.length - 1];
  }

  if (!/\.(js|jsx|ts|tsx)$/.test(rel)) {
    rel += sourceFileExtension(sourceFile);
  }

  return rel.startsWith('.') ? rel : `./${rel}`;
}

export function inferPythonTestFilePath(sourceFile: string): string {
  const base = sourceFile.split('/').pop()!.replace(/\.py$/, '');
  return `tests/test_${base}.py`;
}

export function inferTestFilePath(sourceFile: string, framework: string): string {
  if (framework.toLowerCase().includes('pytest')) {
    return inferPythonTestFilePath(sourceFile);
  }
  return inferJavaScriptTestFilePath(sourceFile);
}

/** All plausible test paths for a source file (tests/ mirror first). */
export function orderedTestFileCandidates(
  sourceFile: string,
  framework: string,
): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const add = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    candidates.push(path);
  };

  add(inferTestFilePath(sourceFile, framework));

  for (const path of nestedJavaScriptTestPaths(sourceFile)) {
    add(path);
  }

  for (const path of colocatedJavaScriptTestPaths(sourceFile)) {
    add(path);
  }

  if (framework.toLowerCase().includes('pytest')) {
    const base = sourceFile.split('/').pop()!.replace(/\.py$/, '');
    add(`test_${base}.py`);
  }

  return candidates;
}

function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Pick an existing test file to update. Prefers the tests/ mirror path
 * (same as inferTestFilePath) when it exists on disk.
 */
export function pickExistingTestFilePath(
  existingRelativePaths: readonly string[],
  sourceFile: string,
  framework: string,
): string | null {
  if (existingRelativePaths.length === 0) return null;

  const normalized = new Map(
    existingRelativePaths.map((p) => [normalizeRepoPath(p), p]),
  );

  for (const candidate of orderedTestFileCandidates(sourceFile, framework)) {
    const match = normalized.get(normalizeRepoPath(candidate));
    if (match) return match;
  }

  const mirror = normalizeRepoPath(inferTestFilePath(sourceFile, framework));
  const underTests = existingRelativePaths.filter((p) => {
    const n = normalizeRepoPath(p);
    return n.startsWith('tests/') || n.startsWith('test/');
  });
  if (underTests.length > 0) {
    const mirrorMatch = underTests.find(
      (p) => normalizeRepoPath(p) === mirror,
    );
    if (mirrorMatch) return mirrorMatch;
    return [...underTests].sort()[0]!;
  }

  const baseName = sourceFile.split('/').pop()!.replace(/\.[^.]+$/, '');
  const nestedMatch = existingRelativePaths.find((p) => {
    const n = normalizeRepoPath(p);
    return (
      (n.includes('/__test__/') || n.includes('/__tests__/')) &&
      n.includes(baseName)
    );
  });
  if (nestedMatch) return nestedMatch;

  if (existingRelativePaths.length === 1) {
    return existingRelativePaths[0]!;
  }

  return null;
}

/** Resolve where generated tests should be written (update vs create). */
export function resolveTestFileTarget(
  existingRelativePaths: readonly string[],
  sourceFile: string,
  framework: string,
): { testOutputPath: string; isUpdatingExistingTest: boolean } {
  const existing = pickExistingTestFilePath(
    existingRelativePaths,
    sourceFile,
    framework,
  );
  if (existing) {
    return { testOutputPath: existing, isUpdatingExistingTest: true };
  }
  return {
    testOutputPath: inferTestFilePath(sourceFile, framework),
    isUpdatingExistingTest: false,
  };
}
