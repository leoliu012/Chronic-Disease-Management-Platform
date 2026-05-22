import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class GetClinicalContextDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  trendDays?: number = 7;

  @IsOptional()
  @IsInt()
  @Min(1)
  historyLimit?: number = 5;
}
