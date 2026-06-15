import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateRepositoryDto {
  @IsString()
  @IsNotEmpty()
  githubRepo!: string;

  @IsString()
  @IsOptional()
  defaultBranch?: string;

  @IsString()
  @IsOptional()
  coverageCommand?: string;

  @IsString()
  @IsOptional()
  testCommand?: string;

  @IsString()
  @IsOptional()
  installCommand?: string;
}
