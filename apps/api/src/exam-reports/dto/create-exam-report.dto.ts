import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateExamReportDto {
  @IsString()
  patientId: string;

  @IsOptional()
  @IsString()
  externalExamId?: string;

  @IsString()
  examType: string;

  @IsString()
  examName: string;

  @IsDateString()
  examTime: string;

  @IsOptional()
  @IsString()
  departmentName?: string;

  @IsOptional()
  @IsString()
  finding?: string;

  @IsOptional()
  @IsString()
  conclusion?: string;

  @IsOptional()
  @IsString()
  reportUrl?: string;

  @IsOptional()
  @IsString()
  sourceSystem?: string;

  @IsOptional()
  rawData?: any;
}
