import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRepositoryDto } from './dto/create-repository.dto';

@Injectable()
export class RepositoriesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateRepositoryDto) {
    return this.prisma.repository.create({
      data: {
        githubRepo: dto.githubRepo,
        defaultBranch: dto.defaultBranch ?? 'main',
        coverageCommand: dto.coverageCommand ?? 'npx nyc --reporter=cobertura --report-dir=coverage node --test',
        testCommand: dto.testCommand ?? 'node --test',
        installCommand: dto.installCommand ?? '',
      },
    });
  }

  findAll() {
    return this.prisma.repository.findMany({
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
}
