import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { DataSource, DiseaseType, RiskLevel } from '@prisma/client';

export class CreateDiseaseProfileDto {
  @IsEnum(DiseaseType)
  diseaseType!: DiseaseType;

  @IsOptional()
  @IsDateString()
  diagnosisDate?: string;

  @IsOptional()
  @IsString()
  diseaseStage?: string;

  @IsOptional()
  @IsString()
  complications?: string;

  @IsOptional()
  @IsString()
  comorbidities?: string;

  @IsOptional()
  @IsEnum(RiskLevel)
  riskLevel?: RiskLevel;

  @IsOptional()
  @IsEnum(DataSource)
  dataSource?: DataSource;
}
