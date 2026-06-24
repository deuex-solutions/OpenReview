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
  GitHubProvider} from '@openreview/coverage-lib';
import {
  pathsMatch,
  detectFramework,
  detectLanguage,
  getAnalyzerForFile,
  extractExportedSymbols,
  computeDiffCoverageFromGit,
  parseCoberturaXml,
  getTestThresholdPercent,
  getMaxGenerationAttempts,
  extractBaselineMetrics,
  getEffectiveCoverage,
  meetsThreshold,
  applyCoverageThreshold,
  selectFilesForGeneration,
  classifyCoverageBlockers,
  buildWorkflowSummary,
  prepareTestFileContext,
} from '@openreview/coverage-lib';
import type { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';

import {
  buildJsCoverageCommand,
  buildJsTestCommand,
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
import { detectRepoSetup, setupPythonRepo } from '../lib/repo-setup';
import { cleanupDir, findCoverageXml, runCommand } from '../lib/shell';

export class PrAnalysisProcessor {
  private readonly repoProvider = createRepositoryProvider();
  private readonly coverageProvider = createCoverageProviderFromEnv();
  private readonly llmProvider = createLLMProvider();
  private readonly workDir = process.env.WORK_DIR ?? '/tmp/pr-coverage-runs';
  private readonly testThresholdPercent = getTestThresholdPercent();
  private readonly maxGenerationAttempts = getMaxGenerationAttempts();
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

      const rawInstallCommand =
        repository.installCommand?.trim() || repoSetup.installCommand;
      const installCommand = rawInstallCommand
        ? repoSetup.wrapCommand(rawInstallCommand)
        : null;
      if (installCommand) {
        await this.log(
          data.prRunId,
          'info',
          `Installing dependencies: ${installCommand}`,
        );
        const installResult = await this.withProgressHeartbeat(
          data.prRunId,
          'Installing dependencies',
          () => runCommand(installCommand, runDir),
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
      const useCoveragePackageOnly = repoSetup.isPython;
      const useAutoJsCoverage = repoSetup.isJavaScript;

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

      const filesNeedingTests = selectFilesForGeneration(
        beforeCoverageResult.report,
        sourceFiles,
        this.testThresholdPercent,
      ).slice(0, 10);

      await this.log(
        data.prRunId,
        'info',
        `${filesNeedingTests.length} file(s) with coverage gaps selected for test generation`,
      );

      const generatedTests: GeneratedTest[] = [];
      const generatedTestResults: { filePath: string; passed: boolean | null }[] =
        [];
      const declaredTestDeps: string[] = [];
      let totalGenerationAttempts = 0;

      if (filesNeedingTests.length > 0 && this.hasLlmConfigured()) {
        await this.updateStatus(data.prRunId, 'GENERATING_TESTS');
        const llmProviderName = (process.env.LLM_PROVIDER ?? 'openai') as
          | 'openai'
          | 'anthropic'
          | 'local';
        await this.log(
          data.prRunId,
          'info',
          `Test generation: ${llmProviderName} / ${resolveTestGenerationModel(llmProviderName)}`,
        );

        for (const file of filesNeedingTests) {
          const fileDiff =
            beforeCoverageResult.report.fileCoverage.find((f) =>
              pathsMatch(f.file, file.path),
            )?.diffCoveragePercent ?? null;
          await this.log(
            data.prRunId,
            'info',
            `Generating tests for ${file.path} (diff coverage ${fileDiff ?? 'n/a'}%, full PR branch source)`,
          );
          try {
            const framework = detectFramework(runDir, detectLanguage(file.path), testCommand);
            const testCtx = await prepareTestFileContext(
              this.repoProvider,
              runDir,
              file.path,
              framework,
            );
            if (testCtx.isUpdatingExistingTest) {
              await this.log(
                data.prRunId,
                'info',
                `Updating existing test file: ${testCtx.testOutputPath}`,
              );
            }

            const outcome = await this.generateAndValidateTest({
              prRunId: data.prRunId,
              runDir,
              file,
              baseRef,
              headBranch,
              testCommand,
              report: beforeCoverageResult.report,
              repoPackages,
              repoSetup,
              sourcePaths,
              useCoveragePackageOnly,
              useAutoJsCoverage,
              logs,
            });

            totalGenerationAttempts += outcome.attempts;

            if (outcome.test) {
              generatedTests.push(outcome.test);
              generatedTestResults.push({
                filePath: outcome.test.filePath,
                passed: outcome.passed,
              });
              declaredTestDeps.push(...outcome.declaredDeps);
            }
          } catch (err) {
            const msg = `Test generation failed for ${file.path}: ${(err as Error).message}`;
            logs.push(msg);
            await this.log(data.prRunId, 'warn', msg);
          }
        }
      } else if (!this.hasLlmConfigured()) {
        await this.log(
          data.prRunId,
          'warn',
          'No LLM API key configured; skipping test generation',
        );
      }

      let executionStatus: 'PASS' | 'FAIL' | 'SKIPPED' | 'PARTIAL' = 'SKIPPED';
      let afterCoverageResult = beforeCoverageResult;

      if (generatedTests.length > 0) {
        await this.updateStatus(data.prRunId, 'RUNNING_TESTS');

        if (repoSetup.isPython || repoSetup.isJavaScript) {
          await this.installGeneratedTestDependencies({
            prRunId: data.prRunId,
            runDir,
            repoSetup,
            rawInstallCommand,
            generatedTests,
            declaredTestDeps,
            repoPackages,
            logs,
          });
        }

        if (!useCoveragePackageOnly && !useAutoJsCoverage) {
          const runTestsCommand = repoSetup.wrapCommand(testCommand);
          await this.log(
            data.prRunId,
            'info',
            `Running generated tests: ${runTestsCommand}`,
          );
          const testResult = await runCommand(runTestsCommand, runDir);
          logs.push(testResult.stdout, testResult.stderr);
          const passed = testResult.exitCode === 0;

          await prisma.generatedTestArtifact.updateMany({
            where: { prRunId: data.prRunId },
            data: { passed },
          });

          for (const entry of generatedTestResults) {
            entry.passed = passed;
          }

          if (!passed) {
            const output = `${testResult.stdout}\n${testResult.stderr}`.slice(
              -2000,
            );
            await this.log(
              data.prRunId,
              'error',
              `Generated tests failed execution (exit ${testResult.exitCode}): ${output}`,
            );
          }
        }

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

        const generatedTestPaths = generatedTests.map((t) => t.filePath);
        await this.updateStatus(data.prRunId, 'RECALCULATING');
        await this.log(
          data.prRunId,
          'info',
          'Recalculating coverage after generated tests',
        );

        // Run only generated tests for post-coverage — pre-existing broken tests
        // (e.g. src/**/__test__ with bad ESM imports) must not fail the recalc.
        const postTestPaths = useCoveragePackageOnly
          ? generatedTestPaths.length > 0
            ? generatedTestPaths
            : pythonTestPaths
          : useAutoJsCoverage
            ? generatedTestPaths.length > 0
              ? generatedTestPaths
              : jsTestPaths
            : generatedTestPaths;
        const postCoverageCommand = useCoveragePackageOnly
          ? repoSetup.wrapCommand(
              buildPythonCoverageCommand(sourcePaths, postTestPaths, runDir),
            )
          : useAutoJsCoverage
            ? repoSetup.wrapCommand(
                buildJsCoverageCommand(sourcePaths, postTestPaths, runDir),
              )
            : coverageCommand;

        afterCoverageResult = await this.withProgressHeartbeat(
          data.prRunId,
          'Post-test coverage command running',
          () =>
            this.runCoverage(
              data.prRunId,
              runDir,
              postCoverageCommand,
              baseRef,
              headBranch,
              sourcePaths,
              useCoveragePackageOnly,
              logs,
            ),
        );
        afterCoverageResult.report = applyCoverageThreshold(
          afterCoverageResult.report,
          this.testThresholdPercent,
        );
        await this.log(
          data.prRunId,
          'info',
          `Final coverage: ${afterCoverageResult.report.totalCoveragePercent}% total, ${afterCoverageResult.report.diffCoveragePercent ?? 'n/a'}% diff`,
        );
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
      } else {
        workflowStatus = 'threshold_not_reached';
      }

      const blockers =
        workflowStatus === 'threshold_not_reached'
          ? await classifyCoverageBlockers(
              runDir,
              afterMetrics.uncoveredLines,
              new Map(),
            )
          : [];

      if (workflowStatus === 'threshold_not_reached' && blockers.length > 0) {
        await this.log(
          data.prRunId,
          'info',
          `Classified ${blockers.length} remaining uncovered line(s) after ${totalGenerationAttempts} generation attempt(s)`,
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
          await this.coverageProvider.runDiffCoverage(
            coverageXml,
            compareRef,
            repoDir,
          ),
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
  }): Promise<{
    test: GeneratedTest | null;
    passed: boolean;
    attempts: number;
    declaredDeps: string[];
  }> {
    let lastFailureLogs = '';
    let previousContent = '';
    let lastTest: GeneratedTest | null = null;
    const declaredDeps: string[] = [];

    for (let attempt = 1; attempt <= this.maxGenerationAttempts; attempt++) {
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
      );

      if (!generated) {
        return { test: null, passed: false, attempts: attempt, declaredDeps };
      }

      // Persist LLM usage for this attempt (including repair rounds)
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
          data: { content: generated.content, filePath: generated.filePath },
        });
      } else {
        await prisma.generatedTestArtifact.create({
          data: {
            prRunId: params.prRunId,
            filePath: generated.filePath,
            targetFile: generated.targetFile,
            content: generated.content,
          },
        });
      }

      const canRunIsolated =
        params.useCoveragePackageOnly || params.useAutoJsCoverage;

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
        };
      }

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

      await this.log(
        params.prRunId,
        'info',
        `Running generated test (attempt ${attempt}/${this.maxGenerationAttempts}): ${generated.filePath}`,
      );
      const testResult = await runCommand(runTestCommand, params.runDir);
      params.logs.push(testResult.stdout, testResult.stderr);

      const passed = testResult.exitCode === 0;
      await prisma.generatedTestArtifact.updateMany({
        where: {
          prRunId: params.prRunId,
          filePath: generated.filePath,
        },
        data: { passed },
      });

      if (passed) {
        await this.log(
          params.prRunId,
          'info',
          `Generated test passed: ${generated.filePath}`,
        );
        return { test: generated, passed: true, attempts: attempt, declaredDeps };
      }

      lastFailureLogs =
        `${testResult.stdout}\n${testResult.stderr}`.slice(-4000);
      await this.log(
        params.prRunId,
        'error',
        `Generated test failed for ${generated.filePath} (attempt ${attempt}, exit ${testResult.exitCode}): ${lastFailureLogs.slice(-500)}`,
      );
    }

    return {
      test: lastTest,
      passed: false,
      attempts: this.maxGenerationAttempts,
      declaredDeps,
    };
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

    const analyzer = getAnalyzerForFile(filePath);
    const symbols = await analyzer.extractSymbols(source, filePath, []);
    const exportedSymbols = extractExportedSymbols(source, filePath);

    const testFile = await prepareTestFileContext(
      this.repoProvider,
      repoDir,
      filePath,
      framework,
    );

    const result = await this.llmProvider.generateTests({
      language,
      framework,
      file: filePath,
      diff,
      source,
      existingTests: testFile.existingTests,
      uncoveredLines: uncoveredForFile.join(', ') || 'unknown',
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
