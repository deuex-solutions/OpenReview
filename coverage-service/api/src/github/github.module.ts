import { Global, Module } from '@nestjs/common';

import { RepositoriesModule } from '../repositories/repositories.module';

import { GitHubService } from './github.service';

@Global()
@Module({
  imports: [RepositoriesModule],
  providers: [GitHubService],
  exports: [GitHubService],
})
export class GitHubModule {}
