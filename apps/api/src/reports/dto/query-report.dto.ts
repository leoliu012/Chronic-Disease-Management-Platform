import { IsDateString, IsOptional, IsString } from 'class-validator';

export class QueryReportDto {
  @IsOptional()
  @IsString()
  nurseId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
