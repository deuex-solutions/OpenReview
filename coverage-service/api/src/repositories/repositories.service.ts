import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRepositoryDto } from './dto/create-repository.dto';

@Injectable()
export class RepositoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(workspaceId: string, dto: CreateRepositoryDto) {
    await this.ensureWorkspace(workspaceId);
    return this.prisma.repository.create({
      data: {
        workspaceId,
        githubRepo: dto.githubRepo,
        defaultBranch: dto.defaultBranch ?? 'main',
        coverageCommand: dto.coverageCommand ?? 'npx nyc --reporter=cobertura --report-dir=coverage node --test',
        testCommand: dto.testCommand ?? 'node --test',
        installCommand: dto.installCommand ?? '',
      },
    });
  }

  findByWorkspace(workspaceId: string) {
    return this.prisma.repository.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const repo = await this.prisma.repository.findUnique({
      where: { id },
      include: {
        pullRequestRuns: {
          orderBy: { startedAt: 'desc' },
          take: 20,
          include: { coverageResult: true },
        },
      },
    });
    if (!repo) throw new NotFoundException('Repository not found');
    return repo;
  }

  async findByGithubRepo(githubRepo: string) {
    return this.prisma.repository.findFirst({
      where: { githubRepo },
    });
  }

  private async ensureWorkspace(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!ws) throw new NotFoundException('Workspace not found');
  }
}
