import { IsInt, Min } from 'class-validator';

export class TriggerAnalysisDto {
  @IsInt()
  @Min(1)
  prNumber!: number;
}
