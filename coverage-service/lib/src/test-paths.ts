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
