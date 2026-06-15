import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RepositoriesService } from './repositories.service';
import { CreateRepositoryDto } from './dto/create-repository.dto';

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
