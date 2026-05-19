import { IsEnum, IsOptional, IsString } from 'class-validator';
import { RiskLevel } from '@prisma/client';

export class CreateRiskAlertDto {
  @IsString()
  riskType!: string;

  @IsEnum(RiskLevel)
  riskLevel!: RiskLevel;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  triggerRule?: string;

  @IsOptional()
  @IsString()
  sourceVitalRecordId?: string;
}
