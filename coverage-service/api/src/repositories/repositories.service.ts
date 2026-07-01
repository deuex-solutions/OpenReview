import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { CreateRepositoryDto } from './dto/create-repository.dto';

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

  /**
   * Called by the installation webhook handler to store (or clear) the
   * GitHub App installation ID for a given repo. Creates the repo record
   * automatically when the app is installed on a new repo that has not yet
   * been manually registered.
   */
  async upsertByGithubRepo(
    githubRepo: string,
    installationId: string | null,
  ) {
    return this.prisma.repository.upsert({
      where: { githubRepo },
      update: { githubInstallationId: installationId },
      create: {
        githubRepo,
        githubInstallationId: installationId,
      },
    });
  }

  /**
   * Resolves the installation ID for a given repo — used by the worker
   * so each repo authenticates with its own installation token.
   */
  async resolveInstallationId(githubRepo: string): Promise<string | null> {
    const repo = await this.prisma.repository.findFirst({
      where: { githubRepo },
      select: { githubInstallationId: true },
    });
    return repo?.githubInstallationId ?? null;
  }
}

