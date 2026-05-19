import { IsEnum } from 'class-validator';
import { RiskLevel } from '@prisma/client';

export class UpdateRiskLevelDto {
  @IsEnum(RiskLevel)
  riskLevel!: RiskLevel;
}
