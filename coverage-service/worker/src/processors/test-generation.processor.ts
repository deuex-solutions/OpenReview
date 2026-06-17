import { randomUUID } from 'crypto';
import { mkdir } from 'fs/promises';
import { join } from 'path';

import type {
  TestGenerationJobData,
  TestGenerationStatus,
  GitHubProvider,
  ChangedFile,
  DiffCoverageReport} from '@openreview/coverage-lib';
import {
  detectFramework,
  detectLanguage,
  getAnalyzerForFile,
  extractExportedSymbols,
  computeDiffCoverageFromGit,
  parseCoberturaXml,
  applyCoverageThreshold,
  pickTargetFileForTestGeneration,
  getTestThresholdPercent,
  pathsMatch,
} from '@openreview/coverage-lib';
import type { Job } from 'bullmq';

import {
  buildJsCoverageCommand,
  collectJsTestPaths,
} from '../lib/js-coverage';
import { prisma } from '../lib/prisma';
import {
  createCoverageProviderFromEnv,
  createLLMProvider,
  createRepositoryProvider,
  resolveTestGenerationModel,
} from '../lib/providers';
import {
  buildPythonCoverageCommand,
  collectPythonTestPaths,
} from '../lib/python-coverage';
import {
  collectRepoPackages,
  parseGeneratedTestContent,
} from '../lib/repo-packages';
import { detectRepoSetup, setupPythonRepo } from '../lib/repo-setup';
import { cleanupDir, findCoverageXml, runCommand } from '../lib/shell';

export class TestGenerationProcessor {
  private readonly repoProvider = createRepositoryProvider();
  private readonly coverageProvider = createCoverageProviderFromEnv();
  private readonly llmProvider = createLLMProvider();
  private readonly workDir = process.env.WORK_DIR ?? '/tmp/pr-coverage-runs';
  private readonly testThresholdPercent = getTestThresholdPercent();

  async process(
    data: TestGenerationJobData,
    job?: Job<TestGenerationJobData>,
  ): Promise<void> {
    const runDir = join(this.workDir, 'test-gen', data.runId, randomUUID());

    try {
      await this.updateStatus(data.runId, 'CLONING');

      const repository = await prisma.repository.findUniqueOrThrow({
        where: { id: data.repositoryId },
      });

      const github = this.repoProvider as GitHubProvider;
      const pr = await github.getPullRequest(
        repository.githubRepo,
        data.prNumber,
      );
      const headRepo = pr.headRepo;
      const headBranch = data.headBranch || pr.headBranch;
      const baseBranch = data.baseBranch || pr.baseBranch;
      const isFork = headRepo !== repository.githubRepo;
      const baseRef = isFork
        ? `upstream/${baseBranch}`
        : `origin/${baseBranch}`;

      const targetLabel = data.targetFile ?? '(auto-pick from diff coverage)';
      await this.log(
        data.runId,
        'info',
        `Starting test generation for ${targetLabel} (PR #${data.prNumber})`,
      );

      const repoUrl = `https://github.com/${headRepo}.git`;
      await mkdir(runDir, { recursive: true });

      await this.withProgressHeartbeat(
        data.runId,
        `Cloning ${headRepo} (branch: ${headBranch})`,
        () =>
          this.repoProvider.clone({
            repoUrl,
            targetDir: runDir,
            branch: headBranch,
          }),
        job,
      );

      await this.withProgressHeartbeat(
        data.runId,
        `Fetching and checking out PR #${data.prNumber}`,
        () =>
          this.repoProvider.checkoutPR({
            repoDir: runDir,
            prNumber: data.prNumber,
            baseBranch,
            headBranch,
            upstreamRepo: isFork ? repository.githubRepo : undefined,
          }),
        job,
      );

      let repoSetup = detectRepoSetup(runDir);
      if (repoSetup.isPython) {
        repoSetup = await setupPythonRepo(runDir, repoSetup);
      }

      const rawInstallCommand =
        repository.installCommand?.trim() || repoSetup.installCommand;
      const installCommand = rawInstallCommand
        ? repoSetup.wrapCommand(rawInstallCommand)
        : null;
      if (installCommand) {
        await this.log(
          data.runId,
          'info',
          `Installing dependencies: ${installCommand}`,
        );
        const installResult = await this.withProgressHeartbeat(
          data.runId,
          'Installing dependencies',
          () => runCommand(installCommand, runDir),
          job,
        );
        if (installResult.exitCode !== 0) {
          const output = `${installResult.stdout}\n${installResult.stderr}`.slice(
            -2000,
          );
          throw new Error(
            `Dependency install failed (exit ${installResult.exitCode}): ${output}`,
          );
        }
      }

      const repoPackages = await collectRepoPackages(runDir);
      const testCommand = repoSetup.wrapCommand(repository.testCommand);

      let targetFile = data.targetFile?.trim() || '';
      let coverageReport: DiffCoverageReport | null = null;

      if (!targetFile) {
        const changedFiles = await this.repoProvider.getChangedFiles(
          runDir,
          baseRef,
          headBranch,
        );
        const sourceFiles = this.filterSourceFiles(changedFiles);

        if (sourceFiles.length === 0) {
          throw new Error('No eligible source files changed in this PR');
        }

        await this.log(
          data.runId,
          'info',
          `Running diff coverage to auto-select target file (${sourceFiles.length} candidate(s))`,
        );

        coverageReport = await this.runCoverage({
          runId: data.runId,
          runDir,
          repository,
          repoSetup,
          changedFiles,
          sourceFiles,
          baseRef,
          headBranch,
          job,
        });

        const picked = pickTargetFileForTestGeneration(
          coverageReport,
          sourceFiles,
          this.testThresholdPercent,
        );
        if (!picked) {
          throw new Error('No eligible source file found for test generation');
        }

        targetFile = picked.path;
        const fileCoverage = coverageReport.fileCoverage.find((f) =>
          pathsMatch(f.file, targetFile),
        );
        const effective =
          fileCoverage?.diffCoveragePercent ??
          fileCoverage?.lineCoveragePercent ??
          'n/a';

        await prisma.testGenerationRun.update({
          where: { id: data.runId },
          data: { targetFile },
        });

        await this.log(
          data.runId,
          'info',
          `Auto-selected ${targetFile} (effective coverage ${effective}%, threshold ${this.testThresholdPercent}%)`,
        );
      }

      await this.updateStatus(data.runId, 'GENERATING_TESTS');
      const llmProviderName = (process.env.LLM_PROVIDER ?? 'openai') as
        | 'openai'
        | 'anthropic'
        | 'local';
      await this.log(
        data.runId,
        'info',
        `Generating test via ${llmProviderName} / ${resolveTestGenerationModel(llmProviderName)}`,
      );

      const generated = await this.generateTestForFile({
        runDir,
        filePath: targetFile,
        baseRef,
        headBranch,
        testCommand,
        repoPackages,
        coverageReport,
      });

      if (!generated) {
        throw new Error(`Could not read source file: ${targetFile}`);
      }

      const parsed = parseGeneratedTestContent(generated.content);
      generated.content = parsed.content;

      await prisma.generatedTestArtifact.create({
        data: {
          testGenerationRunId: data.runId,
          filePath: generated.filePath,
          targetFile: generated.targetFile,
          content: generated.content,
        },
      });

      await prisma.testGenerationRun.update({
        where: { id: data.runId },
        data: { attempts: 1 },
      });

      await this.updateStatus(data.runId, 'COMPLETED');
      await prisma.testGenerationRun.update({
        where: { id: data.runId },
        data: { completedAt: new Date() },
      });

      await this.log(
        data.runId,
        'info',
        `Test generation completed: ${generated.filePath}`,
      );
    } catch (err) {
      const message = (err as Error).message;
      await this.log(data.runId, 'error', message);
      await this.updateStatus(data.runId, 'FAILED');
      await prisma.testGenerationRun.update({
        where: { id: data.runId },
        data: { completedAt: new Date() },
      });
      throw err;
    } finally {
      if (process.env.KEEP_WORK_DIR !== '1') {
        await cleanupDir(runDir);
      } else {
        console.log(
          `[test-gen:${data.runId}] KEEP_WORK_DIR=1 — workspace preserved at: ${runDir}`,
        );
      }
    }
  }

  private filterSourceFiles(changedFiles: ChangedFile[]): ChangedFile[] {
    return changedFiles.filter(
      (f) =>
        f.status !== 'deleted' &&
        /\.(ts|tsx|js|jsx|py)$/.test(f.path) &&
        !f.path.includes('.test.') &&
        !f.path.includes('.spec.') &&
        !f.path.startsWith('test_'),
    );
  }

  private async runCoverage(params: {
    runId: string;
    runDir: string;
    repository: {
      coverageCommand: string;
    };
    repoSetup: ReturnType<typeof detectRepoSetup>;
    changedFiles: ChangedFile[];
    sourceFiles: ChangedFile[];
    baseRef: string;
    headBranch: string;
    job?: Job<TestGenerationJobData>;
  }): Promise<DiffCoverageReport> {
    const sourcePaths = params.sourceFiles.map((f) => f.path);
    const useCoveragePackageOnly = params.repoSetup.isPython;
    const useAutoJsCoverage = params.repoSetup.isJavaScript;

    let coverageCommand: string;

    if (useCoveragePackageOnly) {
      const pythonTestPaths = await collectPythonTestPaths(
        params.runDir,
        params.changedFiles,
        sourcePaths,
        this.repoProvider,
      );
      coverageCommand = params.repoSetup.wrapCommand(
        buildPythonCoverageCommand(sourcePaths, pythonTestPaths, params.runDir),
      );
    } else if (useAutoJsCoverage) {
      const jsTestPaths = await collectJsTestPaths(
        params.runDir,
        params.changedFiles,
        sourcePaths,
        this.repoProvider,
      );
      coverageCommand = params.repoSetup.wrapCommand(
        buildJsCoverageCommand(sourcePaths, jsTestPaths, params.runDir),
      );
    } else {
      coverageCommand = params.repoSetup.wrapCommand(
        params.repository.coverageCommand,
      );
    }

    if (useCoveragePackageOnly && sourcePaths.length === 0) {
      return applyCoverageThreshold(
        {
          diffCoveragePercent: 100,
          totalCoveragePercent: 0,
          uncoveredLines: [],
          filesWithPoorCoverage: [],
          fileCoverage: [],
          rawOutput: '',
        },
        this.testThresholdPercent,
      );
    }

    await this.log(
      params.runId,
      'info',
      `Coverage command: ${coverageCommand}`,
    );

    const result = await this.withProgressHeartbeat(
      params.runId,
      'Coverage command running',
      () => runCommand(coverageCommand, params.runDir),
      params.job,
    );

    const coverageXml = findCoverageXml(params.runDir);
    if (!coverageXml) {
      if (useCoveragePackageOnly) {
        await this.log(
          params.runId,
          'warn',
          'No Cobertura XML found; using git diff coverage only',
        );
        return applyCoverageThreshold(
          await computeDiffCoverageFromGit(
            '',
            params.runDir,
            params.baseRef,
            params.headBranch,
            sourcePaths,
            this.testThresholdPercent,
          ),
          this.testThresholdPercent,
        );
      }

      const output = `${result.stdout}\n${result.stderr}`.slice(-2000);
      throw new Error(
        `coverage.xml not found after running coverage command (exit ${result.exitCode}). ${output}`,
      );
    }

    await this.log(params.runId, 'info', `Cobertura XML: ${coverageXml}`);

    try {
      const cobertura = await parseCoberturaXml(coverageXml);
      await this.log(
        params.runId,
        'info',
        `Cobertura total line coverage: ${cobertura.totalCoveragePercent.toFixed(1)}%`,
      );
    } catch (err) {
      await this.log(
        params.runId,
        'warn',
        `Could not parse Cobertura XML: ${(err as Error).message}`,
      );
    }

    const report = useCoveragePackageOnly
      ? await computeDiffCoverageFromGit(
          coverageXml,
          params.runDir,
          params.baseRef,
          params.headBranch,
          sourcePaths,
          this.testThresholdPercent,
        )
      : await this.coverageProvider.runDiffCoverage(
          coverageXml,
          params.baseRef,
          params.runDir,
        );

    return applyCoverageThreshold(report, this.testThresholdPercent);
  }

  private async generateTestForFile(params: {
    runDir: string;
    filePath: string;
    baseRef: string;
    headBranch: string;
    testCommand: string;
    repoPackages: string[];
    coverageReport: DiffCoverageReport | null;
  }) {
    const source = await this.repoProvider.getFileContent(
      params.runDir,
      params.filePath,
    );
    if (!source) return null;

    const language = detectLanguage(params.filePath);
    const framework = detectFramework(
      params.runDir,
      language,
      params.testCommand,
    );

    const { stdout: diff } = await runCommand(
      `git diff ${params.baseRef}...${params.headBranch} -- ${params.filePath}`,
      params.runDir,
    );

    const fileCoverageEntry = params.coverageReport?.fileCoverage.find((f) =>
      pathsMatch(f.file, params.filePath),
    );
    const uncoveredForFile =
      params.coverageReport?.uncoveredLines
        .filter((l) => pathsMatch(l.file, params.filePath))
        .map((l) => l.line) ?? [];

    const analyzer = getAnalyzerForFile(params.filePath);
    const symbols = await analyzer.extractSymbols(
      source,
      params.filePath,
      [],
    );
    const exportedSymbols = extractExportedSymbols(source, params.filePath);

    const existingTestPaths = await this.repoProvider.findExistingTests(
      params.runDir,
      params.filePath,
    );
    const existingTests = (
      await Promise.all(
        existingTestPaths.map((p) =>
          this.repoProvider.getFileContent(params.runDir, p),
        ),
      )
    ).join('\n\n---\n\n');

    return this.llmProvider.generateTests({
      language,
      framework,
      file: params.filePath,
      diff,
      source,
      existingTests,
      uncoveredLines: uncoveredForFile.join(', ') || 'unknown',
      symbols,
      repoPackages: params.repoPackages,
      useFullSource: true,
      fileDiffCoverage: fileCoverageEntry?.diffCoveragePercent ?? null,
      exportedSymbols,
    });
  }

  private async updateStatus(runId: string, status: TestGenerationStatus) {
    await prisma.testGenerationRun.update({
      where: { id: runId },
      data: { status },
    });
  }

  private async log(runId: string, level: string, message: string) {
    console.log(`[test-gen:${runId}] ${level}: ${message}`);
    await prisma.testGenerationLog.create({
      data: { runId, level, message },
    });
  }

  private async withProgressHeartbeat<T>(
    runId: string,
    step: string,
    fn: () => Promise<T>,
    job?: Job<TestGenerationJobData>,
    intervalMs = 30_000,
  ): Promise<T> {
    await this.log(runId, 'info', step);
    void this.touchJobLock(job);
    const timer = setInterval(() => {
      void this.log(runId, 'info', `${step} — still in progress…`);
      void this.touchJobLock(job);
    }, intervalMs);
    try {
      return await fn();
    } finally {
      clearInterval(timer);
    }
  }

  private async touchJobLock(job?: Job<TestGenerationJobData>): Promise<void> {
    if (!job) return;
    try {
      await job.updateProgress(Date.now());
    } catch {
      // Best effort.
    }
  }
}
