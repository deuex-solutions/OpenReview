import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import type { CreateRepositoryDto } from './dto/create-repository.dto';
import type { RepositoriesService } from './repositories.service';

@Controller('repositories')
export class RepositoriesController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Post()
  create(@Body() dto: CreateRepositoryDto) {
    return this.repositoriesService.create(dto);
  }

  @Get()
  findAll() {
    return this.repositoriesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.repositoriesService.findOne(id);
  }
}
