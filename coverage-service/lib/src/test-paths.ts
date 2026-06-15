/** Infer a test file path that mirrors src/ under tests/ for JS/TS projects. */
export function inferJavaScriptTestFilePath(sourceFile: string): string {
  const ext = /\.tsx?$/.test(sourceFile) ? '.ts' : '.js';
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
    const ext = /\.tsx?$/.test(sourceFile) ? '.ts' : '.js';
    rel += ext;
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
