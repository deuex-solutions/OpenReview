import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateWorkspaceDto) {
    return this.prisma.workspace.create({ data: { name: dto.name } });
  }

  findAll() {
    return this.prisma.workspace.findMany({
      include: { repositories: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      include: {
        repositories: {
          include: {
            pullRequestRuns: {
              orderBy: { startedAt: 'desc' },
              take: 10,
              include: { coverageResult: true },
            },
          },
        },
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }
}
