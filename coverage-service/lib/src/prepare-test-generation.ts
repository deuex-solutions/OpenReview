import type { RepositoryProvider } from './providers/repository-provider';
import { resolveTestFileTarget } from './test-paths';

export interface PreparedTestFileContext {
  existingTestPaths: string[];
  existingTests: string;
  testOutputPath: string;
  isUpdatingExistingTest: boolean;
}

/**
 * Discover existing tests for a source file and decide whether to update
 * an existing test file or create a new one at the inferred path.
 */
export async function prepareTestFileContext(
  repoProvider: RepositoryProvider,
  repoDir: string,
  sourceFile: string,
  framework: string,
): Promise<PreparedTestFileContext> {
  const existingTestPaths = await repoProvider.findExistingTests(
    repoDir,
    sourceFile,
    framework,
  );

  const { testOutputPath, isUpdatingExistingTest } = resolveTestFileTarget(
    existingTestPaths,
    sourceFile,
    framework,
  );

  const pathsToRead = isUpdatingExistingTest
    ? [testOutputPath]
    : existingTestPaths;

  const parts = await Promise.all(
    pathsToRead.map((p) => repoProvider.getFileContent(repoDir, p)),
  );
  const existingTests =
    parts
      .map((content, i) =>
        content.length > 0 ? `// ${pathsToRead[i]}\n${content}` : '',
      )
      .filter(Boolean)
      .join('\n\n---\n\n') || '(none found)';

  return {
    existingTestPaths,
    existingTests,
    testOutputPath,
    isUpdatingExistingTest,
  };
}
