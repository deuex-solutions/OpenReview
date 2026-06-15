import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { PrRunsService } from './pr-runs.service';
import { QueueService } from '../queue/queue.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('pr-runs')
export class PrRunsController {
  constructor(
    private readonly prRunsService: PrRunsService,
    private readonly queue: QueueService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('repository/:repositoryId')
  findByRepository(@Param('repositoryId') repositoryId: string) {
    return this.prRunsService.findByRepository(repositoryId);
  }

  @Get(':id/tests/:testId')
  async downloadTest(
    @Param('id') prRunId: string,
    @Param('testId') testId: string,
    @Res() res: Response,
  ) {
    const artifact = await this.prisma.generatedTestArtifact.findFirst({
      where: { id: testId, prRunId },
    });
    if (!artifact) throw new NotFoundException('Test artifact not found');

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${artifact.filePath.split('/').pop()}"`,
    );
    res.send(artifact.content);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.prRunsService.findOne(id);
  }

  @Post(':id/retry')
  async retry(@Param('id') id: string) {
    const run = await this.prisma.pullRequestRun.findUnique({
      where: { id },
      include: { repository: true },
    });
    if (!run) throw new NotFoundException('PR run not found');

    await this.queue.enqueuePrAnalysis({
      prRunId: run.id,
      repositoryId: run.repositoryId,
      prNumber: run.prNumber,
      baseBranch: run.baseBranch ?? run.repository.defaultBranch,
      headBranch: run.headBranch ?? `pr-${run.prNumber}`,
      headSha: run.headSha ?? '',
    });
    return { status: 're-enqueued', prRunId: id };
  }
}
