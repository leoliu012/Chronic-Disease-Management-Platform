import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AlertStatus, RiskLevel } from '@prisma/client';

export class QueryRiskAlertsDto {
  @IsOptional()
  @IsEnum(AlertStatus)
  status?: AlertStatus;

  @IsOptional()
  @IsEnum(RiskLevel)
  riskLevel?: RiskLevel;


  @IsOptional()
  @IsString()
  hospitalTenantId?: string;

  @IsOptional()
  @IsString()
  riskType?: string;
}


