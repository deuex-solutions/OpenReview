import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface StoredFileCoverage {
  file: string;
  lineCoveragePercent: number;
  diffCoveragePercent: number | null;
  uncoveredLines: number[];
}

@Injectable()
export class PrRunsService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(id: string) {
    const run = await this.prisma.pullRequestRun.findUnique({
      where: { id },
      include: {
        repository: true,
        coverageResult: true,
        generatedTests: true,
        executionLogs: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!run) throw new NotFoundException('PR run not found');
    return this.formatRun(run);
  }

  findByRepository(repositoryId: string) {
    return this.prisma.pullRequestRun.findMany({
      where: { repositoryId },
      orderBy: { startedAt: 'desc' },
      include: { coverageResult: true },
    });
  }

  private formatRun(run: Awaited<ReturnType<typeof this.findOneRaw>>) {
    const result = run.coverageResult;
    const beforeFiles = this.parseStoredFileCoverage(result?.beforeFileCoverage);
    const afterFiles = this.parseStoredFileCoverage(result?.afterFileCoverage);

    return {
      id: run.id,
      repository: run.repository.githubRepo,
      prNumber: run.prNumber,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      coverageBefore: result?.beforeCoverage ?? null,
      coverageAfter: result?.afterCoverage ?? null,
      diffCoverageBefore: result?.diffCoverageBefore ?? null,
      diffCoverageAfter: result?.diffCoverageAfter ?? null,
      fileCoverage: this.mergeFileCoverage(beforeFiles, afterFiles),
      generatedTestsCount: result?.generatedTestsCount ?? 0,
      filesImproved: result?.filesImproved ?? [],
      executionStatus: result?.executionStatus ?? 'SKIPPED',
      workflowSummary: result?.workflowSummary ?? null,
      generatedTestFiles: run.generatedTests.map((t) => ({
        id: t.id,
        filePath: t.filePath,
        targetFile: t.targetFile,
        passed: t.passed,
        downloadUrl: `/pr-runs/${run.id}/tests/${t.id}`,
      })),
      logs: run.executionLogs.map((l) => ({
        level: l.level,
        message: l.message,
        createdAt: l.createdAt,
      })),
    };
  }

  private parseStoredFileCoverage(value: unknown): StoredFileCoverage[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is StoredFileCoverage =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as StoredFileCoverage).file === 'string',
    );
  }

  private mergeFileCoverage(
    before: StoredFileCoverage[],
    after: StoredFileCoverage[],
  ): Array<{
    file: string;
    before: {
      lineCoveragePercent: number;
      diffCoveragePercent: number | null;
      uncoveredLines: number[];
    } | null;
    after: {
      lineCoveragePercent: number;
      diffCoveragePercent: number | null;
      uncoveredLines: number[];
    } | null;
  }> {
    const files = new Set([
      ...before.map((f) => f.file),
      ...after.map((f) => f.file),
    ]);

    const toSnapshot = (entry: StoredFileCoverage | undefined) =>
      entry
        ? {
            lineCoveragePercent: entry.lineCoveragePercent,
            diffCoveragePercent: entry.diffCoveragePercent,
            uncoveredLines: entry.uncoveredLines,
          }
        : null;

    return [...files].map((file) => ({
      file,
      before: toSnapshot(before.find((f) => f.file === file)),
      after: toSnapshot(after.find((f) => f.file === file)),
    }));
  }

  private async findOneRaw(id: string) {
    const run = await this.prisma.pullRequestRun.findUnique({
      where: { id },
      include: {
        repository: true,
        coverageResult: true,
        generatedTests: true,
        executionLogs: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!run) throw new NotFoundException('PR run not found');
    return run;
  }
}
