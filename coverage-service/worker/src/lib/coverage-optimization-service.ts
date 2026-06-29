import type {
  ChangedFile,
  DiffCoverageReport,
  GeneratedTest,
} from '@openreview/coverage-lib';
import type { OptimizationStopReason } from '@openreview/coverage-lib';
import {
  extractBaselineMetrics,
  formatGapSummary,
  gapsToChangedFiles,
  getCoverageGaps,
  getEffectiveCoverage,
  getMaxFilesPerIteration,
  getMaxOptimizationIterations,
  getMinCoverageGain,
  getTargetDiffCoveragePercent,
  meetsThreshold,
  pathsMatch,
  prioritizeCoverageGaps,
  shouldStopForStagnation,
} from '@openreview/coverage-lib';

import { prisma } from './prisma';

export interface OptimizationRunContext {
  prRunId: string;
  runDir: string;
  sourceFiles: ChangedFile[];
  sourcePaths: string[];
  baseRef: string;
  headBranch: string;
  testCommand: string;
  repoPackages: string[];
  useCoveragePackageOnly: boolean;
  useAutoJsCoverage: boolean;
  pythonTestPaths: string[];
  jsTestPaths: string[];
  hasLlm: boolean;
}

export interface GenerateTestOutcome {
  test: GeneratedTest | null;
  passed: boolean;
  attempts: number;
  declaredDeps: string[];
  repairAttempts: number;
  failureReason?: string;
}

export interface OptimizationCallbacks {
  log: (level: string, message: string) => Promise<void>;
  updateStatus: (status: string) => Promise<void>;
  runCoverage: (
    coverageCommand: string,
    report: DiffCoverageReport,
  ) => Promise<{ report: DiffCoverageReport; coverageXml: string }>;
  buildPostCoverageCommand: (passingTestPaths: string[]) => string;
  generateTestForFile: (
    file: ChangedFile,
    report: DiffCoverageReport,
    options: {
      generationMode: 'NEW_TEST_FILE' | 'COVERAGE_GAP';
      iterationNumber: number;
      previousGeneratedContent?: string;
    },
  ) => Promise<GenerateTestOutcome>;
  getSourceLineCount: (filePath: string) => Promise<number>;
  isConfigExportFile: (filePath: string) => Promise<boolean>;
  installTestDeps: (
    tests: GeneratedTest[],
    declaredDeps: string[],
  ) => Promise<void>;
}

export interface OptimizationResult {
  afterReport: DiffCoverageReport;
  generatedTests: GeneratedTest[];
  generatedTestResults: { filePath: string; passed: boolean | null }[];
  totalGenerationAttempts: number;
  stopReason: OptimizationStopReason | null;
  iterationSummaries: Array<{
    iteration: number;
    coverageBefore: number;
    coverageAfter: number | null;
    coverageGain: number | null;
    generatedTests: number;
    failedTests: number;
    stopReason?: string | null;
  }>;
}

export class CoverageOptimizationService {
  private readonly targetPercent = getTargetDiffCoveragePercent();
  private readonly maxIterations = getMaxOptimizationIterations();
  private readonly minGain = getMinCoverageGain();
  private readonly maxFilesPerIteration = getMaxFilesPerIteration();

  async run(
    ctx: OptimizationRunContext,
    beforeReport: DiffCoverageReport,
    callbacks: OptimizationCallbacks,
  ): Promise<OptimizationResult> {
    const baselineMetrics = extractBaselineMetrics(beforeReport);
    let currentReport = beforeReport;
    let currentCoverage = getEffectiveCoverage(
      baselineMetrics.diffCoverage,
      baselineMetrics.overallCoverage,
    );

    const generatedTests: GeneratedTest[] = [];
    const generatedTestResults: { filePath: string; passed: boolean | null }[] =
      [];
    const failureCounts = new Map<string, number>();
    const sourceLineCounts = new Map<string, number>();
    const recentGains: number[] = [];
    const iterationSummaries: OptimizationResult['iterationSummaries'] = [];
    let totalGenerationAttempts = 0;
    let stopReason: OptimizationStopReason | null = null;
    let iteration = 0;

    if (!ctx.hasLlm) {
      return {
        afterReport: currentReport,
        generatedTests,
        generatedTestResults,
        totalGenerationAttempts: 0,
        stopReason: 'no_llm',
        iterationSummaries,
      };
    }

    while (
      !meetsThreshold(currentCoverage, this.targetPercent) &&
      iteration < this.maxIterations
    ) {
      const gapsReport = getCoverageGaps(currentReport, this.targetPercent);

      // Include config/prompt export files even when baseline import coverage looks complete
      const configExportFiles: ChangedFile[] = [];
      for (const file of ctx.sourceFiles) {
        if (await callbacks.isConfigExportFile(file.path)) {
          const inGaps = gapsReport.files.some((g) =>
            pathsMatch(g.file, file.path),
          );
          if (!inGaps) {
            gapsReport.files.push({
              file: file.path,
              coverage: 100,
              uncoveredLines: [],
              uncoveredPercentage: 0,
              complexity: 0,
            });
            configExportFiles.push(file);
          }
        }
      }

      if (
        gapsReport.totalUncoveredLines === 0 &&
        configExportFiles.length === 0
      ) {
        stopReason = 'no_gaps';
        break;
      }

      for (const gap of gapsReport.files) {
        if (!sourceLineCounts.has(gap.file)) {
          sourceLineCounts.set(
            gap.file,
            await callbacks.getSourceLineCount(gap.file),
          );
        }
      }

      const prioritized = prioritizeCoverageGaps(gapsReport.files, {
        failureCounts,
        sourceLineCounts,
      });

      let filesToProcess = gapsToChangedFiles(prioritized, ctx.sourceFiles);
      for (const cf of configExportFiles) {
        if (!filesToProcess.some((f) => pathsMatch(f.path, cf.path))) {
          filesToProcess.push(cf);
        }
      }
      filesToProcess = filesToProcess.slice(0, this.maxFilesPerIteration);

      if (filesToProcess.length === 0) {
        stopReason = 'no_gaps';
        break;
      }

      const coverageBefore = currentCoverage;
      const iterationRecord = await prisma.coverageIteration.create({
        data: {
          prRunId: ctx.prRunId,
          iteration,
          coverageBefore,
        },
      });

      for (const gap of prioritized.slice(0, this.maxFilesPerIteration)) {
        await prisma.coverageGap.create({
          data: {
            iterationId: iterationRecord.id,
            filePath: gap.file,
            coverage: gap.coverage,
            missingLines: gap.uncoveredLines,
            priority: gap.priority ?? 0,
          },
        });
      }

      const selectedNames = filesToProcess.map((f) => f.path).join(', ');
      await callbacks.log(
        'info',
        [
          `Iteration ${iteration}`,
          `Coverage Before: ${coverageBefore.toFixed(1)}%`,
          `Target: ${this.targetPercent}%`,
          `Files Selected: ${selectedNames}`,
          `Missing Lines:`,
          formatGapSummary(
            prioritized.filter((g) =>
              filesToProcess.some((f) => pathsMatch(f.path, g.file)),
            ),
          ),
        ].join('\n'),
      );

      await callbacks.updateStatus('GENERATING_TESTS');

      let iterGenerated = 0;
      let iterFailed = 0;
      const iterDeclaredDeps: string[] = [];

      for (const file of filesToProcess) {
        const gap = prioritized.find((g) => pathsMatch(g.file, file.path));
        const hasPriorArtifact = generatedTests.some((t) =>
          pathsMatch(t.targetFile, file.path),
        );
        const existingArtifact = await prisma.generatedTestArtifact.findFirst({
          where: { prRunId: ctx.prRunId, targetFile: file.path },
          orderBy: { createdAt: 'desc' },
        });

        const generationMode =
          hasPriorArtifact || existingArtifact
            ? 'COVERAGE_GAP'
            : 'NEW_TEST_FILE';

        await callbacks.log(
          'info',
          `Generating tests for ${file.path} (mode: ${generationMode}, diff coverage ${gap?.coverage?.toFixed(1) ?? 'n/a'}%, uncovered: ${gap?.uncoveredLines.join(',') ?? 'config export'})`,
        );

        try {
          const outcome = await callbacks.generateTestForFile(
            file,
            currentReport,
            {
              generationMode,
              iterationNumber: iteration,
              previousGeneratedContent: existingArtifact?.content,
            },
          );

          totalGenerationAttempts += outcome.attempts;
          iterDeclaredDeps.push(...outcome.declaredDeps);

          if (outcome.test) {
            iterGenerated++;
            const existingIdx = generatedTests.findIndex(
              (t) => t.targetFile === outcome.test!.targetFile,
            );
            if (existingIdx >= 0) {
              generatedTests[existingIdx] = outcome.test;
            } else {
              generatedTests.push(outcome.test);
            }

            const resultIdx = generatedTestResults.findIndex(
              (r) => r.filePath === outcome.test!.filePath,
            );
            const resultEntry = {
              filePath: outcome.test.filePath,
              passed: outcome.passed,
            };
            if (resultIdx >= 0) {
              generatedTestResults[resultIdx] = resultEntry;
            } else {
              generatedTestResults.push(resultEntry);
            }

            if (!outcome.passed) {
              iterFailed++;
              failureCounts.set(
                file.path,
                (failureCounts.get(file.path) ?? 0) + 1,
              );
            }
          } else {
            iterFailed++;
            failureCounts.set(
              file.path,
              (failureCounts.get(file.path) ?? 0) + 1,
            );
          }
        } catch (err) {
          iterFailed++;
          failureCounts.set(
            file.path,
            (failureCounts.get(file.path) ?? 0) + 1,
          );
          await callbacks.log(
            'warn',
            `Test generation failed for ${file.path}: ${(err as Error).message}`,
          );
        }
      }

      await callbacks.log(
        'info',
        `Generated Tests: ${iterGenerated}\nPassing: ${iterGenerated - iterFailed}\nFailed: ${iterFailed}`,
      );

      const passingPaths = generatedTestResults
        .filter((t) => t.passed)
        .map((t) => t.filePath);

      if (passingPaths.length > 0) {
        await callbacks.updateStatus('RECALCULATING');
        await callbacks.log(
          'info',
          'Recalculating coverage after generated tests (passing tests only)',
        );

        if (iterDeclaredDeps.length > 0) {
          await callbacks.installTestDeps(generatedTests, iterDeclaredDeps);
        }

        const postCommand = callbacks.buildPostCoverageCommand(passingPaths);
        const postResult = await callbacks.runCoverage(
          postCommand,
          currentReport,
        );
        currentReport = postResult.report;
        currentCoverage = getEffectiveCoverage(
          extractBaselineMetrics(currentReport).diffCoverage,
          extractBaselineMetrics(currentReport).overallCoverage,
        );
      }

      const coverageGain = currentCoverage - coverageBefore;
      recentGains.push(coverageGain);

      await prisma.coverageIteration.update({
        where: { id: iterationRecord.id },
        data: {
          coverageAfter: currentCoverage,
          coverageGain,
          generatedTests: iterGenerated,
          failedTests: iterFailed,
        },
      });

      iterationSummaries.push({
        iteration,
        coverageBefore,
        coverageAfter: currentCoverage,
        coverageGain,
        generatedTests: iterGenerated,
        failedTests: iterFailed,
      });

      await callbacks.log(
        'info',
        `Coverage After: ${currentCoverage.toFixed(1)}%\nGain: ${coverageGain >= 0 ? '+' : ''}${coverageGain.toFixed(1)}%`,
      );

      if (meetsThreshold(currentCoverage, this.targetPercent)) {
        stopReason = 'target_reached';
        await prisma.coverageIteration.update({
          where: { id: iterationRecord.id },
          data: { stopReason: 'target_reached' },
        });
        break;
      }

      if (shouldStopForStagnation(recentGains, this.minGain)) {
        stopReason = 'plateau';
        await prisma.coverageIteration.update({
          where: { id: iterationRecord.id },
          data: { stopReason: 'plateau' },
        });
        await callbacks.log(
          'info',
          'Coverage plateau reached — stopping optimization',
        );
        break;
      }

      iteration++;
    }

    if (
      !stopReason &&
      iteration >= this.maxIterations &&
      !meetsThreshold(currentCoverage, this.targetPercent)
    ) {
      stopReason = 'max_iterations';
    }

    return {
      afterReport: currentReport,
      generatedTests,
      generatedTestResults,
      totalGenerationAttempts,
      stopReason,
      iterationSummaries,
    };
  }
}
