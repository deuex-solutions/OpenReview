import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class GenerateTestDto {
  @IsInt()
  @Min(1)
  prNumber!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  filePath?: string;
}
