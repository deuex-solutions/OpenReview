import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

import type {
  PrAnalysisJobData,
  GeneratedTest,
  GeneratedTestWithUsage,
  PrRunStatus,
  ChangedFile,
  CoverageWorkflowSummary,
  DiffCoverageReport,
  LlmUsage,
  GitHubProvider,
} from '@openreview/coverage-lib';
import {
  pathsMatch,
  detectFramework,
  detectLanguage,
  getAnalyzerForFile,
  extractExportedSymbols,
  computeDiffCoverageFromGit,
  parseCoberturaXml,
  getTargetDiffCoveragePercent,
  getMaxGenerationAttempts,
  getMaxRepairAttempts,
  extractBaselineMetrics,
  getEffectiveCoverage,
  meetsThreshold,
  applyCoverageThreshold,
  resolveDiffCoverageReport,
  classifyCoverageBlockers,
  buildWorkflowSummary,
  prepareTestFileContext,
  isConfigOrPromptExportFile,
  isComplexServiceFile,
  suggestSmokeTestExports,
  GenerationMode,
} from '@openreview/coverage-lib';
import type { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';

import {
  buildJsCoverageCommand,
  buildJsTestCommand,
  collectJsTestPaths,
  prepareJsTestHarness,
} from '../lib/js-coverage';
import { prisma } from '../lib/prisma';
import {
  createCoverageProviderFromEnv,
  createLLMProvider,
  createRepositoryProvider,
} from '../lib/providers';
import {
  buildPythonCoverageCommand,
  buildPythonTestCommand,
  collectPythonTestPaths,
} from '../lib/python-coverage';
import {
  buildPipInstallCommand,
  buildNpmInstallCommand,
  collectRepoPackages,
  collectTestRunDependencies,
  parseGeneratedTestContent,
} from '../lib/repo-packages';
import type { RepoSetup} from '../lib/repo-setup';
import { detectRepoSetup, setupPythonRepo, hasJsSourcePaths, defaultJsToolsInstallCommand } from '../lib/repo-setup';
import { cleanupDir, findCoverageXml, runCommand } from '../lib/shell';
import {
  CoverageOptimizationService,
  type GenerateTestOutcome,
} from '../lib/coverage-optimization-service';
import { TestRepairService } from '../lib/test-repair-service';

export class PrAnalysisProcessor {
  private readonly repoProvider = createRepositoryProvider();
  private readonly coverageProvider = createCoverageProviderFromEnv();
  private readonly llmProvider = createLLMProvider();
  private readonly optimizationService = new CoverageOptimizationService();
  private readonly testRepairService = new TestRepairService();
  private readonly workDir = process.env.WORK_DIR ?? '/tmp/pr-coverage-runs';
  private readonly testThresholdPercent = getTargetDiffCoveragePercent();
  private readonly maxGenerationAttempts = getMaxGenerationAttempts();
  private readonly maxRepairAttempts = getMaxRepairAttempts();
  private activeJob?: Job<PrAnalysisJobData>;

  async process(
    data: PrAnalysisJobData,
    job?: Job<PrAnalysisJobData>,
  ): Promise<void> {
    const runDir = join(this.workDir, data.prRunId, randomUUID());
    const logs: string[] = [];
    this.activeJob = job;

    try {
      await this.updateStatus(data.prRunId, 'CLONING');

      const repository = await prisma.repository.findUniqueOrThrow({
        where: { id: data.repositoryId },
      });

      const github = this.repoProvider as GitHubProvider;
      const pr = await github.getPullRequest(
        repository.githubRepo,
        data.prNumber,
      );
      const headRepo = pr.headRepo;
      const headBranch = pr.headBranch;
      const baseBranch = pr.baseBranch;
      const isFork = headRepo !== repository.githubRepo;
      const baseRef = isFork
        ? `upstream/${baseBranch}`
        : `origin/${baseBranch}`;

      await this.log(
        data.prRunId,
        'info',
        `Starting PR analysis for #${data.prNumber} (${headBranch} → ${baseBranch})`,
      );

      const repoUrl = `https://github.com/${headRepo}.git`;
      await mkdir(runDir, { recursive: true });
      await this.log(data.prRunId, 'info', `Work directory: ${runDir}`);

      await this.withProgressHeartbeat(
        data.prRunId,
        `Cloning ${headRepo} (branch: ${headBranch})`,
        () =>
          this.repoProvider.clone({
            repoUrl,
            targetDir: runDir,
            branch: headBranch,
          }),
      );
      await this.log(
        data.prRunId,
        'info',
        `Repository cloned to: ${runDir} (cleaned up after run unless KEEP_WORK_DIR=1)`,
      );


      await this.withProgressHeartbeat(
        data.prRunId,
        `Fetching and checking out PR #${data.prNumber}`,
        () =>
          this.repoProvider.checkoutPR({
            repoDir: runDir,
            prNumber: data.prNumber,
            baseBranch,
            headBranch,
            upstreamRepo: isFork ? repository.githubRepo : undefined,
          }),
      );
      await this.log(data.prRunId, 'info', `Checked out branch ${headBranch}`);

      let repoSetup = detectRepoSetup(runDir);
      if (repoSetup.isPython) {
        await this.log(
          data.prRunId,
          'info',
          'Creating Python virtualenv (.pr-coverage-venv)',
        );
        repoSetup = await setupPythonRepo(runDir, repoSetup);
        await this.log(data.prRunId, 'info', 'Python virtualenv ready');
      }

      await this.updateStatus(data.prRunId, 'ANALYZING');
      await this.log(data.prRunId, 'info', 'Analyzing changed files in PR');
      const changedFiles = await this.repoProvider.getChangedFiles(
        runDir,
        baseRef,
        headBranch,
      );

      const sourceFiles = changedFiles.filter(
        (f) =>
          f.status !== 'deleted' &&
          /\.(ts|tsx|js|jsx|py)$/.test(f.path) &&
          !f.path.includes('.test.') &&
          !f.path.includes('.spec.') &&
          !f.path.startsWith('test_'),
      );

      await this.log(
        data.prRunId,
        'info',
        `Found ${changedFiles.length} changed file(s), ${sourceFiles.length} source file(s) eligible for analysis`,
      );

      const sourcePaths = sourceFiles.map((f) => f.path);
      const hasJsSourceChanges = hasJsSourcePaths(sourcePaths);
      const hasPySourceChanges = sourceFiles.some((f) => f.path.endsWith('.py'));
      const useAutoJsCoverage = repoSetup.isJavaScript || hasJsSourceChanges;
      const useCoveragePackageOnly =
        repoSetup.isPython && hasPySourceChanges && !hasJsSourceChanges;

      const rawInstallCommand =
        repository.installCommand?.trim() || repoSetup.installCommand;
      let installCommand = rawInstallCommand
        ? repoSetup.wrapCommand(rawInstallCommand)
        : null;
      if (!installCommand && useAutoJsCoverage) {
        installCommand = repoSetup.wrapCommand(
          repoSetup.installCommand ?? defaultJsToolsInstallCommand(),
        );
      }
      if (installCommand) {
        await this.log(
          data.prRunId,
          'info',
          `Installing dependencies: ${installCommand}`,
        );
        const installResult = await this.withProgressHeartbeat(
          data.prRunId,
          'Installing dependencies',
          () => runCommand(installCommand!, runDir),
        );
        if (installResult.exitCode !== 0) {
          const output = `${installResult.stdout}\n${installResult.stderr}`.slice(
            -2000,
          );
          throw new Error(
            `Dependency install failed (exit ${installResult.exitCode}): ${output}`,
          );
        }
        await this.log(data.prRunId, 'info', 'Dependencies installed successfully');
      }

      const repoPackages = await collectRepoPackages(runDir);
      if (repoPackages.length > 0) {
        await this.log(
          data.prRunId,
          'info',
          `Repository packages: ${repoPackages.join(', ')}`,
        );
      }

      let pythonTestPaths: string[] = [];
      let jsTestPaths: string[] = [];
      let coverageCommand: string;
      let testCommand: string;
      let beforeCoverageResult: Awaited<ReturnType<typeof this.runCoverage>>;

      if (useCoveragePackageOnly) {
        pythonTestPaths = await collectPythonTestPaths(
          runDir,
          changedFiles,
          sourcePaths,
          this.repoProvider,
        );
        coverageCommand = repoSetup.wrapCommand(
          buildPythonCoverageCommand(sourcePaths, pythonTestPaths, runDir),
        );
        testCommand = repoSetup.wrapCommand(
          buildPythonTestCommand(sourcePaths, pythonTestPaths, runDir),
        );
      } else if (useAutoJsCoverage) {
        jsTestPaths = await collectJsTestPaths(
          runDir,
          changedFiles,
          sourcePaths,
          this.repoProvider,
        );
        coverageCommand = repoSetup.wrapCommand(
          buildJsCoverageCommand(sourcePaths, jsTestPaths, runDir),
        );
        testCommand = repoSetup.wrapCommand(
          buildJsTestCommand(sourcePaths, jsTestPaths, runDir),
        );
      } else {
        coverageCommand = repoSetup.wrapCommand(repository.coverageCommand);
        testCommand = repoSetup.wrapCommand(repository.testCommand);
      }

      if (useCoveragePackageOnly && sourcePaths.length === 0) {
        await this.updateStatus(data.prRunId, 'RUNNING_COVERAGE');
        await this.log(
          data.prRunId,
          'info',
          'No eligible Python source files changed; skipping coverage run',
        );
        beforeCoverageResult = {
          report: {
            diffCoveragePercent: 100,
            totalCoveragePercent: 0,
            uncoveredLines: [],
            filesWithPoorCoverage: [],
            fileCoverage: [],
            rawOutput: '',
          },
          coverageXml: '',
        };
      } else {
        await this.updateStatus(data.prRunId, 'RUNNING_COVERAGE');
        await this.log(
          data.prRunId,
          'info',
          useCoveragePackageOnly
            ? `Running PR-scoped coverage on ${sourcePaths.length} file(s): ${coverageCommand}`
            : useAutoJsCoverage
              ? `Running c8 coverage on ${sourcePaths.length} file(s): ${coverageCommand}`
              : `Running initial coverage: ${coverageCommand}`,
        );

        if (useAutoJsCoverage) {
          prepareJsTestHarness(runDir, sourcePaths, jsTestPaths);
        }

        beforeCoverageResult = await this.withProgressHeartbeat(
          data.prRunId,
          'Coverage command running',
          () =>
            this.runCoverage(
              data.prRunId,
              runDir,
              coverageCommand,
              baseRef,
              headBranch,
              sourcePaths,
              useCoveragePackageOnly,
              logs,
            ),
        );
      }
      beforeCoverageResult.report = applyCoverageThreshold(
        beforeCoverageResult.report,
        this.testThresholdPercent,
      );

      const baselineMetrics = extractBaselineMetrics(
        beforeCoverageResult.report,
      );
      const baselineEffective = getEffectiveCoverage(
        baselineMetrics.diffCoverage,
        baselineMetrics.overallCoverage,
      );

      await this.log(
        data.prRunId,
        'info',
        `Baseline coverage: ${baselineMetrics.overallCoverage}% overall, ${baselineMetrics.diffCoverage ?? 'n/a'}% diff (effective: ${baselineEffective.toFixed(1)}%, threshold: ${this.testThresholdPercent}%)`,
      );

      if (meetsThreshold(baselineEffective, this.testThresholdPercent)) {
        const workflowSummary = buildWorkflowSummary({
          status: 'threshold_met',
          thresholdPercent: this.testThresholdPercent,
          thresholdReached: true,
          attempts: 0,
          generatedTests: [],
          coverageBefore: baselineMetrics,
          coverageAfter: baselineMetrics,
          blockers: [],
        });

        await this.log(
          data.prRunId,
          'info',
          'Coverage threshold already met; skipping test generation',
        );

        await this.persistCoverageResult({
          prRunId: data.prRunId,
          beforeReport: beforeCoverageResult.report,
          afterReport: beforeCoverageResult.report,
          sourceFiles,
          generatedTestsCount: 0,
          executionStatus: 'SKIPPED',
          workflowSummary,
        });

        await this.updateStatus(data.prRunId, 'COMPLETED');
        await prisma.pullRequestRun.update({
          where: { id: data.prRunId },
          data: { completedAt: new Date() },
        });
        await this.log(
          data.prRunId,
          'info',
          `PR analysis completed: ${workflowSummary.status}`,
        );
        return;
      }

      if (this.hasLlmConfigured()) {
        await this.log(
          data.prRunId,
          'info',
          `Starting coverage optimization (target: ${this.testThresholdPercent}% diff coverage)`,
        );
      }

      const optimizationResult = await this.optimizationService.run(
        {
          prRunId: data.prRunId,
          runDir,
          sourceFiles,
          sourcePaths,
          baseRef,
          headBranch,
          testCommand,
          repoPackages,
          useCoveragePackageOnly,
          useAutoJsCoverage,
          pythonTestPaths,
          jsTestPaths,
          hasLlm: this.hasLlmConfigured(),
        },
        beforeCoverageResult.report,
        {
          log: (level, message) => this.log(data.prRunId, level, message),
          updateStatus: (status) =>
            this.updateStatus(data.prRunId, status as PrRunStatus),
          runCoverage: async (coverageCommand, _prevReport) => {
            const result = await this.withProgressHeartbeat(
              data.prRunId,
              'Post-test coverage command running',
              () =>
                this.runCoverage(
                  data.prRunId,
                  runDir,
                  coverageCommand,
                  baseRef,
                  headBranch,
                  sourcePaths,
                  useCoveragePackageOnly,
                  logs,
                ),
            );
            result.report = applyCoverageThreshold(
              result.report,
              this.testThresholdPercent,
            );
            return result;
          },
          buildPostCoverageCommand: (passingTestPaths) => {
            const postTestPaths = useCoveragePackageOnly
              ? passingTestPaths.length > 0
                ? passingTestPaths
                : pythonTestPaths
              : useAutoJsCoverage
                ? passingTestPaths.length > 0
                  ? passingTestPaths
                  : jsTestPaths
                : passingTestPaths;
            if (useAutoJsCoverage) {
              prepareJsTestHarness(runDir, sourcePaths, postTestPaths);
            }
            return useCoveragePackageOnly
              ? repoSetup.wrapCommand(
                  buildPythonCoverageCommand(sourcePaths, postTestPaths, runDir),
                )
              : useAutoJsCoverage
                ? repoSetup.wrapCommand(
                    buildJsCoverageCommand(sourcePaths, postTestPaths, runDir),
                  )
                : repoSetup.wrapCommand(repository.coverageCommand);
          },
          generateTestForFile: async (file, report, options) =>
            this.generateAndValidateTest({
              prRunId: data.prRunId,
              runDir,
              file,
              baseRef,
              headBranch,
              testCommand,
              report,
              repoPackages,
              repoSetup,
              sourcePaths,
              useCoveragePackageOnly,
              useAutoJsCoverage,
              logs,
              generationMode: options.generationMode,
              previousGeneratedContent: options.previousGeneratedContent,
            }),
          getSourceLineCount: async (filePath) => {
            const content = await this.repoProvider.getFileContent(
              runDir,
              filePath,
            );
            return content ? content.split('\n').length : 0;
          },
          isConfigExportFile: async (filePath) => {
            const content = await this.repoProvider.getFileContent(
              runDir,
              filePath,
            );
            return content ? isConfigOrPromptExportFile(content) : false;
          },
          installTestDeps: async (tests, declaredDeps) => {
            if (repoSetup.isPython || repoSetup.isJavaScript) {
              await this.installGeneratedTestDependencies({
                prRunId: data.prRunId,
                runDir,
                repoSetup,
                rawInstallCommand: rawInstallCommand,
                generatedTests: tests,
                declaredTestDeps: declaredDeps,
                repoPackages,
                logs,
              });
            }
          },
        },
      );

      const generatedTests = optimizationResult.generatedTests;
      const generatedTestResults = optimizationResult.generatedTestResults;
      const totalGenerationAttempts = optimizationResult.totalGenerationAttempts;
      let afterCoverageResult = {
        report: optimizationResult.afterReport,
        coverageXml: beforeCoverageResult.coverageXml,
      };

      if (generatedTests.length > 0) {
        await this.updateStatus(data.prRunId, 'RUNNING_TESTS');
        await this.log(
          data.prRunId,
          'info',
          `Optimization complete: ${generatedTestResults.filter((t) => t.passed).length} passing, ${generatedTestResults.filter((t) => !t.passed).length} failed`,
        );
      } else if (!this.hasLlmConfigured()) {
        await this.log(
          data.prRunId,
          'warn',
          'No LLM API key configured; skipping test generation',
        );
      }

      let executionStatus: 'PASS' | 'FAIL' | 'SKIPPED' | 'PARTIAL' = 'SKIPPED';

      if (generatedTestResults.length > 0) {
        const passingTests = generatedTestResults.filter((t) => t.passed).length;
        const failingTests = generatedTestResults.filter((t) => !t.passed).length;

        executionStatus =
          failingTests === 0
            ? 'PASS'
            : passingTests === 0
              ? 'FAIL'
              : 'PARTIAL';

        await this.log(
          data.prRunId,
          'info',
          `Generated test results: ${passingTests} passed, ${failingTests} failed`,
        );

        if (afterCoverageResult.report !== beforeCoverageResult.report) {
          await this.log(
            data.prRunId,
            'info',
            `Final coverage: ${afterCoverageResult.report.totalCoveragePercent}% total, ${afterCoverageResult.report.diffCoveragePercent ?? 'n/a'}% diff`,
          );
        }
      }

      const afterMetrics = extractBaselineMetrics(afterCoverageResult.report);
      const afterEffective = getEffectiveCoverage(
        afterMetrics.diffCoverage,
        afterMetrics.overallCoverage,
      );
      const allTestsPassing =
        generatedTestResults.length > 0 &&
        generatedTestResults.every((t) => t.passed);

      let workflowStatus: CoverageWorkflowSummary['status'];
      let thresholdReached = false;

      if (
        meetsThreshold(afterEffective, this.testThresholdPercent) &&
        allTestsPassing
      ) {
        workflowStatus = 'success';
        thresholdReached = true;
      } else if (optimizationResult.stopReason === 'plateau') {
        workflowStatus = 'plateau_reached';
      } else {
        workflowStatus = 'threshold_not_reached';
      }

      const blockers =
        workflowStatus === 'threshold_not_reached' ||
        workflowStatus === 'plateau_reached'
          ? await classifyCoverageBlockers(
              runDir,
              afterMetrics.uncoveredLines,
              new Map(),
            )
          : [];

      if (
        (workflowStatus === 'threshold_not_reached' ||
          workflowStatus === 'plateau_reached') &&
        blockers.length > 0
      ) {
        await this.log(
          data.prRunId,
          'info',
          `Classified ${blockers.length} remaining uncovered line(s) after ${totalGenerationAttempts} generation attempt(s) across ${optimizationResult.iterationSummaries.length} iteration(s)`,
        );
      }

      const workflowSummary = buildWorkflowSummary({
        status: workflowStatus,
        thresholdPercent: this.testThresholdPercent,
        thresholdReached,
        attempts: totalGenerationAttempts,
        generatedTests: generatedTestResults,
        coverageBefore: baselineMetrics,
        coverageAfter: afterMetrics,
        blockers,
        optimizationIterations: optimizationResult.iterationSummaries,
        stopReason: optimizationResult.stopReason,
      });

      await this.persistCoverageResult({
        prRunId: data.prRunId,
        beforeReport: beforeCoverageResult.report,
        afterReport: afterCoverageResult.report,
        sourceFiles,
        generatedTestsCount: generatedTests.length,
        executionStatus,
        workflowSummary,
      });

      await this.updateStatus(data.prRunId, 'COMPLETED');
      await prisma.pullRequestRun.update({
        where: { id: data.prRunId },
        data: { completedAt: new Date() },
      });

      await this.log(
        data.prRunId,
        'info',
        `PR analysis completed: ${workflowSummary.status} (effective coverage ${workflowSummary.currentCoverage.toFixed(1)}% / target ${workflowSummary.targetCoverage}%)`,
      );
    } catch (err) {
      const message = (err as Error).message;
      logs.push(message);
      await this.log(data.prRunId, 'error', message);
      await this.updateStatus(data.prRunId, 'FAILED');
      await prisma.pullRequestRun.update({
        where: { id: data.prRunId },
        data: { completedAt: new Date() },
      });
      throw err;
    } finally {
      this.activeJob = undefined;
      if (process.env.KEEP_WORK_DIR !== '1') {
        await cleanupDir(runDir);
      } else {
        console.log(`[${data.prRunId}] KEEP_WORK_DIR=1 — workspace preserved at: ${runDir}`);
      }
    }
  }

  private truncateForLog(text: string, max = 8000): string {
    const trimmed = text.trim();
    if (trimmed.length <= max) return trimmed;
    return `${trimmed.slice(0, max)}\n… (truncated, ${trimmed.length - max} chars omitted)`;
  }

  private async runCoverage(
    prRunId: string,
    repoDir: string,
    coverageCommand: string,
    compareRef: string,
    headBranch: string,
    changedSourcePaths: string[],
    useCoveragePackageOnly: boolean,
    logs: string[],
    coverageHint = 'Ensure the coverage command produces Cobertura output (e.g. coverage.xml or coverage/cobertura-coverage.xml).',
  ) {
    await this.log(
      prRunId,
      'info',
      `Coverage cwd: ${repoDir}\nCoverage command: ${coverageCommand}`,
    );

    const result = await runCommand(coverageCommand, repoDir);
    logs.push(result.stdout, result.stderr);

    await this.log(
      prRunId,
      'info',
      `Coverage command exit code: ${result.exitCode}\n${this.truncateForLog(`${result.stdout}\n${result.stderr}`)}`,
    );

    const coverageXml = findCoverageXml(repoDir);
    if (!coverageXml) {
      if (useCoveragePackageOnly) {
        logs.push(
          'No coverage.xml produced (no data collected); reporting 0% for changed files',
        );
        await this.log(
          prRunId,
          'warn',
          'No Cobertura XML found after coverage command; reporting 0% for changed files',
        );
        const report = await computeDiffCoverageFromGit(
          '',
          repoDir,
          compareRef,
          headBranch,
          changedSourcePaths,
          this.testThresholdPercent,
        );
        return { report, coverageXml: '' };
      }

      const output = `${result.stdout}\n${result.stderr}`.slice(-2000);
      throw new Error(
        `coverage.xml not found after running coverage command (exit ${result.exitCode}). ` +
          `${coverageHint}\n` +
          output,
      );
    }

    await this.log(prRunId, 'info', `Cobertura XML: ${coverageXml}`);

    try {
      const cobertura = await parseCoberturaXml(coverageXml);
      await this.log(
        prRunId,
        'info',
        `Cobertura total line coverage: ${cobertura.totalCoveragePercent.toFixed(1)}% (${cobertura.files.length} file(s) in report)`,
      );
    } catch (err) {
      await this.log(
        prRunId,
        'warn',
        `Could not parse Cobertura XML: ${(err as Error).message}`,
      );
    }

    if (result.exitCode !== 0) {
      logs.push(
        `Coverage command exited with code ${result.exitCode}; continuing with generated coverage.xml`,
      );
      await this.log(
        prRunId,
        'warn',
        `Coverage command exited with code ${result.exitCode}; continuing with ${coverageXml}`,
      );
    }

    const report = useCoveragePackageOnly
      ? await computeDiffCoverageFromGit(
          coverageXml,
          repoDir,
          compareRef,
          headBranch,
          changedSourcePaths,
          this.testThresholdPercent,
        )
      : applyCoverageThreshold(
          await resolveDiffCoverageReport({
            coverageXmlPath: coverageXml,
            repoDir,
            compareRef,
            headBranch,
            targetFiles: changedSourcePaths,
            thresholdPercent: this.testThresholdPercent,
            coverageProvider: this.coverageProvider,
          }),
          this.testThresholdPercent,
        );

    if (report.rawOutput?.trim()) {
      await this.log(
        prRunId,
        'info',
        `diff-cover output (compare ${compareRef}):\n${this.truncateForLog(report.rawOutput)}`,
      );
    }

    return { report, coverageXml };
  }

  private hasLlmConfigured(): boolean {
    const provider = process.env.LLM_PROVIDER ?? 'openai';
    if (provider === 'anthropic') return !!process.env.ANTHROPIC_API_KEY?.trim();
    if (provider === 'local') return !!process.env.LOCAL_LLM_URL?.trim();
    return !!process.env.OPENAI_API_KEY?.trim();
  }

  private async persistCoverageResult(params: {
    prRunId: string;
    beforeReport: DiffCoverageReport;
    afterReport: DiffCoverageReport;
    sourceFiles: ChangedFile[];
    generatedTestsCount: number;
    executionStatus: 'PASS' | 'FAIL' | 'SKIPPED' | 'PARTIAL';
    workflowSummary: CoverageWorkflowSummary;
  }) {
    const filesImproved = this.computeFilesImproved(
      params.beforeReport.filesWithPoorCoverage,
      params.afterReport.filesWithPoorCoverage,
    );

    const relevantPaths = params.sourceFiles.map((f) => f.path);
    const beforeFileCoverage = this.filterFileCoverage(
      params.beforeReport.fileCoverage,
      relevantPaths,
    );
    const afterFileCoverage = this.filterFileCoverage(
      params.afterReport.fileCoverage,
      relevantPaths,
    );

    await prisma.coverageResult.upsert({
      where: { prRunId: params.prRunId },
      create: {
        prRunId: params.prRunId,
        beforeCoverage: params.beforeReport.totalCoveragePercent,
        afterCoverage: params.afterReport.totalCoveragePercent,
        diffCoverageBefore: params.beforeReport.diffCoveragePercent,
        diffCoverageAfter: params.afterReport.diffCoveragePercent,
        beforeFileCoverage:
          beforeFileCoverage as unknown as Prisma.InputJsonValue,
        afterFileCoverage:
          afterFileCoverage as unknown as Prisma.InputJsonValue,
        generatedTestsCount: params.generatedTestsCount,
        filesImproved,
        executionStatus: params.executionStatus,
        workflowSummary:
          params.workflowSummary as unknown as Prisma.InputJsonValue,
      },
      update: {
        beforeCoverage: params.beforeReport.totalCoveragePercent,
        afterCoverage: params.afterReport.totalCoveragePercent,
        diffCoverageBefore: params.beforeReport.diffCoveragePercent,
        diffCoverageAfter: params.afterReport.diffCoveragePercent,
        beforeFileCoverage:
          beforeFileCoverage as unknown as Prisma.InputJsonValue,
        afterFileCoverage:
          afterFileCoverage as unknown as Prisma.InputJsonValue,
        generatedTestsCount: params.generatedTestsCount,
        filesImproved,
        executionStatus: params.executionStatus,
        workflowSummary:
          params.workflowSummary as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async installGeneratedTestDependencies(params: {
    prRunId: string;
    runDir: string;
    repoSetup: RepoSetup;
    rawInstallCommand: string | null;
    generatedTests: GeneratedTest[];
    declaredTestDeps: string[];
    repoPackages: string[];
    logs: string[];
  }) {
    const ecosystem = params.repoSetup.isJavaScript ? 'javascript' : 'python';
    const testRunDeps = collectTestRunDependencies(
      params.generatedTests.map((t) => t.content),
      params.declaredTestDeps,
      params.repoPackages,
      ecosystem,
      params.generatedTests.flatMap((t) => [t.filePath, t.targetFile]),
    );
    const extraInstall = params.repoSetup.isJavaScript
      ? buildNpmInstallCommand(testRunDeps)
      : buildPipInstallCommand(testRunDeps);
    const installParts = [
      params.repoSetup.isPython ? (params.rawInstallCommand ?? null) : null,
      extraInstall,
    ].filter((part): part is string => Boolean(part));

    if (installParts.length === 0) return;

    const testInstallCommand = params.repoSetup.wrapCommand(
      installParts.join(' && '),
    );
    await this.log(
      params.prRunId,
      'info',
      `Installing packages for generated tests: ${testInstallCommand}`,
    );
    const testInstallResult = await runCommand(testInstallCommand, params.runDir);
    params.logs.push(testInstallResult.stdout, testInstallResult.stderr);
    if (testInstallResult.exitCode !== 0) {
      const output =
        `${testInstallResult.stdout}\n${testInstallResult.stderr}`.slice(-2000);
      throw new Error(
        `Test dependency install failed (exit ${testInstallResult.exitCode}): ${output}`,
      );
    }
    await this.log(
      params.prRunId,
      'info',
      'Test dependencies installed successfully',
    );
  }

  private async generateAndValidateTest(params: {
    prRunId: string;
    runDir: string;
    file: ChangedFile;
    baseRef: string;
    headBranch: string;
    testCommand: string;
    report: DiffCoverageReport;
    repoPackages: string[];
    repoSetup: RepoSetup;
    sourcePaths: string[];
    useCoveragePackageOnly: boolean;
    useAutoJsCoverage: boolean;
    logs: string[];
    generationMode?: 'NEW_TEST_FILE' | 'COVERAGE_GAP';
    previousGeneratedContent?: string;
  }): Promise<GenerateTestOutcome> {
    let lastFailureLogs = '';
    let previousContent = '';
    let lastTest: GeneratedTest | null = null;
    const declaredDeps: string[] = [];
    let generationAttempts = 0;

    for (let attempt = 1; attempt <= this.maxGenerationAttempts; attempt++) {
      generationAttempts = attempt;
      const generated = await this.generateTestForFile(
        params.runDir,
        params.file.path,
        params.baseRef,
        params.headBranch,
        params.testCommand,
        params.report,
        params.repoPackages,
        attempt > 1
          ? {
              failureLogs: lastFailureLogs,
              previousTestContent: previousContent,
              attemptNumber: attempt,
            }
          : undefined,
        {
          generationMode: params.generationMode,
          previousGeneratedContent: params.previousGeneratedContent,
        },
      );

      if (!generated) {
        return {
          test: null,
          passed: false,
          attempts: attempt,
          declaredDeps,
          repairAttempts: 0,
        };
      }

      if (generated.usage) {
        await this.persistUsage(params.prRunId, null, generated.usage);
      }

      const parsed = parseGeneratedTestContent(generated.content);
      generated.content = parsed.content;
      declaredDeps.push(...parsed.declaredDeps);
      previousContent = generated.content;
      lastTest = generated;

      const testDir = join(
        params.runDir,
        ...generated.filePath.split('/').slice(0, -1),
      );
      await mkdir(testDir, { recursive: true });
      await writeFile(
        join(params.runDir, generated.filePath),
        generated.content,
        'utf-8',
      );

      const existingArtifact = await prisma.generatedTestArtifact.findFirst({
        where: {
          prRunId: params.prRunId,
          targetFile: generated.targetFile,
        },
      });

      if (existingArtifact) {
        await prisma.generatedTestArtifact.update({
          where: { id: existingArtifact.id },
          data: {
            content: generated.content,
            filePath: generated.filePath,
            status: 'PENDING',
          },
        });
      } else {
        await prisma.generatedTestArtifact.create({
          data: {
            prRunId: params.prRunId,
            filePath: generated.filePath,
            targetFile: generated.targetFile,
            content: generated.content,
            status: 'PENDING',
          },
        });
      }

      const canRunIsolated =
        params.useCoveragePackageOnly ||
        params.useAutoJsCoverage ||
        params.repoSetup.isJavaScript ||
        hasJsSourcePaths(params.sourcePaths);

      if (!canRunIsolated) {
        await this.log(
          params.prRunId,
          'info',
          `Generated test file: ${generated.filePath} (batch validation after all files)`,
        );
        return {
          test: generated,
          passed: false,
          attempts: attempt,
          declaredDeps,
          repairAttempts: 0,
        };
      }

      const runSingleTest = async (): Promise<{
        passed: boolean;
        output: string;
      }> => {
        if (params.repoSetup.isPython || params.repoSetup.isJavaScript) {
          await this.installGeneratedTestDependencies({
            prRunId: params.prRunId,
            runDir: params.runDir,
            repoSetup: params.repoSetup,
            rawInstallCommand: null,
            generatedTests: [generated],
            declaredTestDeps: parsed.declaredDeps,
            repoPackages: params.repoPackages,
            logs: params.logs,
          });
        }

        const runTestCommand = params.repoSetup.wrapCommand(
          params.useCoveragePackageOnly
            ? buildPythonTestCommand(
                params.sourcePaths,
                [generated.filePath],
                params.runDir,
              )
            : buildJsTestCommand(
                params.sourcePaths,
                [generated.filePath],
                params.runDir,
              ),
        );

        if (params.useAutoJsCoverage || params.repoSetup.isJavaScript) {
          prepareJsTestHarness(params.runDir, params.sourcePaths, [
            generated.filePath,
          ]);
        }

        const testResult = await runCommand(runTestCommand, params.runDir);
        params.logs.push(testResult.stdout, testResult.stderr);
        const testOutput = `${testResult.stdout}\n${testResult.stderr}`;
        const noTestsRan =
          (params.useAutoJsCoverage || params.repoSetup.isJavaScript) &&
          /# tests 0\b/m.test(testOutput) &&
          testResult.exitCode === 0;

        const passed = testResult.exitCode === 0 && !noTestsRan;
        return { passed, output: testOutput };
      };

      const initialResult = await runSingleTest();

      if (initialResult.passed) {
        await this.updateArtifactStatus(
          params.prRunId,
          generated.filePath,
          true,
          0,
        );
        await this.log(
          params.prRunId,
          'info',
          `Generated test passed: ${generated.filePath}`,
        );
        return {
          test: generated,
          passed: true,
          attempts: attempt,
          declaredDeps,
          repairAttempts: 0,
        };
      }

      const noTestsRan =
        (params.useAutoJsCoverage || params.repoSetup.isJavaScript) &&
        /# tests 0\b/m.test(initialResult.output) &&
        !initialResult.output.includes('fail');

      if (noTestsRan) {
        lastFailureLogs = `node --test did not discover any tests: ${generated.filePath}\n${initialResult.output.slice(-2000)}`;
        await this.log(
          params.prRunId,
          'error',
          `Generated test reported pass but ran 0 tests for ${generated.filePath} (attempt ${attempt})`,
        );
        continue;
      }

      lastFailureLogs = initialResult.output.slice(-4000);
      break;
    }

    if (!lastTest) {
      return {
        test: null,
        passed: false,
        attempts: generationAttempts,
        declaredDeps,
        repairAttempts: 0,
      };
    }

    const repairResult = await this.testRepairService.repairUntilPassing({
      maxAttempts: this.maxRepairAttempts,
      runTest: async () => {
        const runTestCommand = params.repoSetup.wrapCommand(
          params.useCoveragePackageOnly
            ? buildPythonTestCommand(
                params.sourcePaths,
                [lastTest!.filePath],
                params.runDir,
              )
            : buildJsTestCommand(
                params.sourcePaths,
                [lastTest!.filePath],
                params.runDir,
              ),
        );
        if (params.useAutoJsCoverage || params.repoSetup.isJavaScript) {
          prepareJsTestHarness(params.runDir, params.sourcePaths, [
            lastTest!.filePath,
          ]);
        }
        const testResult = await runCommand(runTestCommand, params.runDir);
        params.logs.push(testResult.stdout, testResult.stderr);
        const testOutput = `${testResult.stdout}\n${testResult.stderr}`;
        const noTestsRan =
          (params.useAutoJsCoverage || params.repoSetup.isJavaScript) &&
          /# tests 0\b/m.test(testOutput) &&
          testResult.exitCode === 0;
        return {
          passed: testResult.exitCode === 0 && !noTestsRan,
          output: testOutput,
        };
      },
      repair: async (failureLogs, prevContent, repairAttempt) => {
        const repaired = await this.generateTestForFile(
          params.runDir,
          params.file.path,
          params.baseRef,
          params.headBranch,
          params.testCommand,
          params.report,
          params.repoPackages,
          {
            failureLogs,
            previousTestContent: prevContent,
            attemptNumber: repairAttempt,
          },
          {
            generationMode: params.generationMode ?? 'COVERAGE_GAP',
            previousGeneratedContent: params.previousGeneratedContent,
          },
        );
        if (repaired?.usage) {
          await this.persistUsage(params.prRunId, null, repaired.usage);
        }
        if (repaired) {
          lastTest = { ...repaired, content: parseGeneratedTestContent(repaired.content).content };
        }
        return repaired;
      },
      writeTest: async (content) => {
        await writeFile(
          join(params.runDir, lastTest!.filePath),
          content,
          'utf-8',
        );
        await prisma.generatedTestArtifact.updateMany({
          where: {
            prRunId: params.prRunId,
            filePath: lastTest!.filePath,
          },
          data: { content },
        });
      },
      log: async (message) => {
        await this.log(params.prRunId, 'info', message);
      },
    });

    await this.updateArtifactStatus(
      params.prRunId,
      lastTest.filePath,
      repairResult.passed,
      repairResult.repairAttempts,
      repairResult.failureReason,
    );

    if (repairResult.passed) {
      await this.log(
        params.prRunId,
        'info',
        `Generated test passed after ${repairResult.repairAttempts} repair attempt(s): ${lastTest.filePath}`,
      );
    } else {
      await this.log(
        params.prRunId,
        'error',
        `Generated test failed after ${repairResult.repairAttempts} repair attempt(s): ${lastTest.filePath}`,
      );
    }

    return {
      test: lastTest,
      passed: repairResult.passed,
      attempts: generationAttempts,
      declaredDeps,
      repairAttempts: repairResult.repairAttempts,
      failureReason: repairResult.failureReason,
    };
  }

  private async updateArtifactStatus(
    prRunId: string,
    filePath: string,
    passed: boolean,
    repairAttempts: number,
    failureReason?: string,
  ) {
    await prisma.generatedTestArtifact.updateMany({
      where: { prRunId, filePath },
      data: {
        passed,
        status: passed ? 'PASSING' : 'FAILED',
        repairAttempts,
        failureReason: failureReason ?? null,
      },
    });
  }

  private async generateTestForFile(
    repoDir: string,
    filePath: string,
    compareRef: string,
    headBranch: string,
    testCommand: string,
    report: DiffCoverageReport,
    repoPackages: string[],
    repair?: {
      failureLogs: string;
      previousTestContent: string;
      attemptNumber: number;
    },
    options?: {
      generationMode?: 'NEW_TEST_FILE' | 'COVERAGE_GAP';
      previousGeneratedContent?: string;
    },
  ): Promise<GeneratedTestWithUsage | null> {
    const source = await this.repoProvider.getFileContent(repoDir, filePath);
    if (!source) return null;

    const language = detectLanguage(filePath);
    const framework = detectFramework(repoDir, language, testCommand);

    const { stdout: diff } = await runCommand(
      `git diff ${compareRef}...${headBranch} -- ${filePath}`,
      repoDir,
    );

    const uncoveredForFile = report.uncoveredLines
      .filter((l) => pathsMatch(l.file, filePath))
      .map((l) => l.line);

    const fileCoverageEntry = report.fileCoverage.find((f) =>
      pathsMatch(f.file, filePath),
    );
    const fileDiffCoverage = fileCoverageEntry?.diffCoveragePercent ?? null;
    const fileUncoveredLines =
      fileCoverageEntry?.uncoveredLines.length
        ? fileCoverageEntry.uncoveredLines
        : uncoveredForFile;

    const analyzer = getAnalyzerForFile(filePath);
    const symbols = await analyzer.extractSymbols(source, filePath, fileUncoveredLines);
    const exportedSymbols = extractExportedSymbols(source, filePath);

    const testFile = await prepareTestFileContext(
      this.repoProvider,
      repoDir,
      filePath,
      framework,
    );

    const isConfigExport = isConfigOrPromptExportFile(source);
    const isComplexService = isComplexServiceFile(source);
    const smokeExports = isConfigExport ? suggestSmokeTestExports(source) : [];

    const generationMode =
      options?.generationMode === 'COVERAGE_GAP'
        ? GenerationMode.COVERAGE_GAP
        : testFile.isUpdatingExistingTest || options?.previousGeneratedContent
          ? GenerationMode.COVERAGE_GAP
          : GenerationMode.NEW_TEST_FILE;

    const coverageReport = fileCoverageEntry
      ? `File: ${filePath}\nDiff coverage: ${fileDiffCoverage?.toFixed(1) ?? 'n/a'}%\nUncovered lines: ${fileUncoveredLines.join(', ')}`
      : undefined;

    const result = await this.llmProvider.generateTests({
      language,
      framework,
      file: filePath,
      diff,
      source,
      existingTests: testFile.existingTests,
      uncoveredLines: fileUncoveredLines.join(', ') || 'unknown',
      symbols,
      repoPackages,
      useFullSource: true,
      fileDiffCoverage,
      exportedSymbols,
      failureLogs: repair?.failureLogs,
      previousTestContent: repair?.previousTestContent,
      attemptNumber: repair?.attemptNumber,
      testOutputPath: testFile.testOutputPath,
      isUpdatingExistingTest: testFile.isUpdatingExistingTest,
      generationMode,
      previousGeneratedTests: options?.previousGeneratedContent,
      coverageReport,
      isConfigExportFile: isConfigExport,
      isComplexServiceFile: isComplexService,
      smokeTestExports: smokeExports,
    });
    return result;
  }

  private computeFilesImproved(before: string[], after: string[]): string[] {
    const afterSet = new Set(after);
    return before.filter((f) => !afterSet.has(f));
  }

  private filterFileCoverage<
    T extends { file: string; diffCoveragePercent: number | null },
  >(fileCoverage: T[], relevantPaths: string[]): T[] {
    if (relevantPaths.length === 0) return fileCoverage;

    return fileCoverage.filter(
      (entry) =>
        relevantPaths.some((path) => pathsMatch(entry.file, path)) ||
        entry.diffCoveragePercent !== null,
    );
  }

  private async updateStatus(
    prRunId: string,
    status: PrRunStatus,
  ) {
    await prisma.pullRequestRun.update({
      where: { id: prRunId },
      data: { status },
    });
  }

  private async persistUsage(
    prRunId: string,
    testGenerationRunId: string | null,
    usage: LlmUsage,
  ) {
    try {
      await prisma.llmUsageRecord.create({
        data: {
          prRunId,
          testGenerationRunId,
          provider: usage.provider,
          modelName: usage.modelName,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          estimatedCostUsd: usage.estimatedCostUsd,
        },
      });
    } catch (err) {
      // Non-fatal: cost tracking must not break PR analysis
      console.warn(`[${prRunId}] Failed to persist LLM usage record:`, (err as Error).message);
    }
  }

  private async log(prRunId: string, level: string, message: string) {
    console.log(`[${prRunId}] ${level}: ${message}`);
    await prisma.executionLog.create({
      data: { prRunId, level, message },
    });
  }

  /** Logs a heartbeat every 30s while long-running work (clone, coverage) is in progress. */
  private async withProgressHeartbeat<T>(
    prRunId: string,
    step: string,
    fn: () => Promise<T>,
    intervalMs = 30_000,
  ): Promise<T> {
    await this.log(prRunId, 'info', step);
    void this.touchJobLock();
    const timer = setInterval(() => {
      void this.log(prRunId, 'info', `${step} — still in progress…`);
      void this.touchJobLock();
    }, intervalMs);
    try {
      return await fn();
    } finally {
      clearInterval(timer);
    }
  }

  /** Renews the BullMQ job lock so long-running steps are not marked stalled. */
  private async touchJobLock(): Promise<void> {
    if (!this.activeJob) return;
    try {
      await this.activeJob.updateProgress(Date.now());
    } catch {
      // Best effort; worker lock renewal still runs in the background.
    }
  }
}
