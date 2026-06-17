import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

export interface TriggerTestGenerationInput {
  repositoryId: string;
  prNumber: number;
  filePath?: string;
  headBranch: string;
  baseBranch: string;
}

@Injectable()
export class TestGenerationService {
  private readonly logger = new Logger(TestGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async trigger(input: TriggerTestGenerationInput) {
    if (!this.hasLlmConfigured()) {
      throw new ServiceUnavailableException(
        'No LLM API key configured for test generation',
      );
    }

    if (input.filePath && !this.isEligibleSourceFile(input.filePath)) {
      throw new BadRequestException(
        'filePath must be a source file (.ts, .js, .py, etc.), not a test file',
      );
    }

    const repository = await this.prisma.repository.findUnique({
      where: { id: input.repositoryId },
    });
    if (!repository) {
      throw new NotFoundException('Repository not found');
    }

    const run = await this.prisma.testGenerationRun.create({
      data: {
        repositoryId: repository.id,
        prNumber: input.prNumber,
        targetFile: input.filePath ?? '',
        headBranch: input.headBranch,
        baseBranch: input.baseBranch,
        status: 'PENDING',
      },
    });

    await this.queue.enqueueTestGeneration({
      runId: run.id,
      repositoryId: repository.id,
      prNumber: input.prNumber,
      targetFile: input.filePath,
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
    });

    this.logger.log(
      input.filePath
        ? `Enqueued test generation for ${repository.githubRepo}#${input.prNumber} — ${input.filePath}`
        : `Enqueued test generation for ${repository.githubRepo}#${input.prNumber} — auto-pick from diff coverage`,
    );

    return {
      runId: run.id,
      status: 'enqueued' as const,
      repository: repository.githubRepo,
      prNumber: input.prNumber,
      filePath: input.filePath ?? null,
      autoPick: !input.filePath,
      pollUrl: `/test-generation-runs/${run.id}`,
    };
  }

  async findOne(id: string) {
    const run = await this.prisma.testGenerationRun.findUnique({
      where: { id },
      include: {
        repository: true,
        generatedTest: true,
        executionLogs: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!run) throw new NotFoundException('Test generation run not found');

    return {
      id: run.id,
      status: run.status,
      repository: run.repository.githubRepo,
      prNumber: run.prNumber,
      targetFile: run.targetFile || null,
      autoPick: !run.targetFile,
      attempts: run.attempts,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      generatedTest: run.generatedTest
        ? {
            fileName: run.generatedTest.filePath.split('/').pop()!,
            content: run.generatedTest.content,
          }
        : null,
      logs: run.executionLogs.map((log) => ({
        level: log.level,
        message: log.message,
        createdAt: log.createdAt,
      })),
    };
  }

  private isEligibleSourceFile(filePath: string): boolean {
    if (!/\.(ts|tsx|js|jsx|py)$/.test(filePath)) return false;
    if (filePath.includes('.test.') || filePath.includes('.spec.')) return false;
    if (filePath.startsWith('test_')) return false;
    return true;
  }

  private hasLlmConfigured(): boolean {
    const provider = process.env.LLM_PROVIDER ?? 'openai';
    if (provider === 'anthropic') {
      return !!process.env.ANTHROPIC_API_KEY?.trim();
    }
    if (provider === 'local') return !!process.env.LOCAL_LLM_URL?.trim();
    return !!process.env.OPENAI_API_KEY?.trim();
  }
}
