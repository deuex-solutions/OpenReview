import { Injectable, NotFoundException } from '@nestjs/common';

import type { PrismaService } from '../prisma/prisma.service';

import type { CreateRepositoryDto } from './dto/create-repository.dto';

@Injectable()
export class RepositoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent registration. Re-POSTing the same `githubRepo` returns the
   * existing row instead of failing with a Prisma unique-constraint 500.
   * We intentionally do NOT mutate stored commands on re-POST — operators
   * can edit a repo's config through a separate path if/when we add one.
   */
  create(dto: CreateRepositoryDto) {
    return this.prisma.repository.upsert({
      where: { githubRepo: dto.githubRepo },
      update: {},
      create: {
        githubRepo: dto.githubRepo,
        defaultBranch: dto.defaultBranch ?? 'main',
        coverageCommand:
          dto.coverageCommand ??
          'npx nyc --reporter=cobertura --report-dir=coverage node --test',
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
