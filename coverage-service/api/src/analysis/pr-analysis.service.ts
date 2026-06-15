import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

export interface TriggerAnalysisInput {
  repositoryId: string;
  prNumber: number;
  headBranch: string;
  headSha: string;
  baseBranch: string;
}

@Injectable()
export class PrAnalysisService {
  private readonly logger = new Logger(PrAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async trigger(input: TriggerAnalysisInput) {
    const repository = await this.prisma.repository.findUnique({
      where: { id: input.repositoryId },
    });
    if (!repository) {
      throw new NotFoundException('Repository not found');
    }

    const prRun = await this.prisma.pullRequestRun.create({
      data: {
        repositoryId: repository.id,
        prNumber: input.prNumber,
        headBranch: input.headBranch,
        headSha: input.headSha,
        baseBranch: input.baseBranch,
        status: 'PENDING',
      },
    });

    await this.queue.enqueuePrAnalysis({
      prRunId: prRun.id,
      repositoryId: repository.id,
      prNumber: input.prNumber,
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      headSha: input.headSha,
    });

    this.logger.log(
      `Enqueued PR analysis for ${repository.githubRepo}#${input.prNumber}`,
    );

    return {
      prRunId: prRun.id,
      status: 'enqueued' as const,
      repository: repository.githubRepo,
      prNumber: input.prNumber,
    };
  }
}
