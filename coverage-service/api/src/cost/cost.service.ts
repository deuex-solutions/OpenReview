import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

export interface ModelCostBreakdown {
  provider: string;
  modelName: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface PrCostBreakdown {
  prNumber: number;
  prRunId: string;
  calls: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface RepositoryCostSummary {
  repositoryId: string;
  githubRepo: string;
  totalCalls: number;
  totalTokens: number;
  estimatedCostUsd: number;
  byModel: ModelCostBreakdown[];
  byPr: PrCostBreakdown[];
}

export interface GlobalStats {
  totalRepositories: number;
  totalPrRuns: number;
  totalTestGenerationRuns: number;
  totalLlmCalls: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

@Injectable()
export class CostService {
  constructor(private readonly prisma: PrismaService) {}

  async getRepositorySummary(repositoryId: string): Promise<RepositoryCostSummary> {
    const repo = await this.prisma.repository.findUniqueOrThrow({
      where: { id: repositoryId },
    });

    // Fetch all LLM usage records for this repository — via PR runs
    const records = await this.prisma.llmUsageRecord.findMany({
      where: {
        OR: [
          {
            prRun: { repositoryId },
          },
          {
            testGenerationRun: { repositoryId },
          },
        ],
      },
      include: {
        prRun: { select: { prNumber: true, id: true } },
        testGenerationRun: { select: { prNumber: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Aggregate by model
    const modelMap = new Map<string, ModelCostBreakdown>();
    for (const r of records) {
      const key = `${r.provider}::${r.modelName}`;
      const existing = modelMap.get(key) ?? {
        provider: r.provider,
        modelName: r.modelName,
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      };
      existing.calls += 1;
      existing.promptTokens += r.promptTokens;
      existing.completionTokens += r.completionTokens;
      existing.totalTokens += r.totalTokens;
      existing.estimatedCostUsd += r.estimatedCostUsd ?? 0;
      modelMap.set(key, existing);
    }

    // Aggregate by PR
    const prMap = new Map<string, PrCostBreakdown>();
    for (const r of records) {
      const prRunId = r.prRunId ?? r.testGenerationRun?.prNumber?.toString() ?? 'unknown';
      const prNumber = r.prRun?.prNumber ?? r.testGenerationRun?.prNumber ?? 0;
      const key = r.prRunId ?? `tg-pr-${prNumber}`;
      const existing = prMap.get(key) ?? {
        prNumber,
        prRunId: r.prRunId ?? '',
        calls: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      };
      void prRunId;
      existing.calls += 1;
      existing.totalTokens += r.totalTokens;
      existing.estimatedCostUsd += r.estimatedCostUsd ?? 0;
      prMap.set(key, existing);
    }

    const totalTokens = records.reduce((s, r) => s + r.totalTokens, 0);
    const estimatedCostUsd = records.reduce((s, r) => s + (r.estimatedCostUsd ?? 0), 0);

    return {
      repositoryId,
      githubRepo: repo.githubRepo,
      totalCalls: records.length,
      totalTokens,
      estimatedCostUsd,
      byModel: [...modelMap.values()].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd),
      byPr: [...prMap.values()].sort((a, b) => b.prNumber - a.prNumber),
    };
  }

  async getGlobalStats(): Promise<GlobalStats> {
    const [totalRepositories, totalPrRuns, totalTestGenerationRuns, usageAgg] =
      await Promise.all([
        this.prisma.repository.count(),
        this.prisma.pullRequestRun.count(),
        this.prisma.testGenerationRun.count(),
        this.prisma.llmUsageRecord.aggregate({
          _count: { id: true },
          _sum: { totalTokens: true, estimatedCostUsd: true },
        }),
      ]);

    return {
      totalRepositories,
      totalPrRuns,
      totalTestGenerationRuns,
      totalLlmCalls: usageAgg._count.id,
      totalTokens: usageAgg._sum.totalTokens ?? 0,
      estimatedCostUsd: usageAgg._sum.estimatedCostUsd ?? 0,
    };
  }
}
