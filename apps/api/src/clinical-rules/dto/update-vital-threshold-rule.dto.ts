import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { RiskLevel } from '@prisma/client';

export class UpdateVitalThresholdRuleDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsIn(['GTE', 'GT', 'LTE', 'LT', 'BETWEEN', 'OUTSIDE_RANGE'])
  operator?: string;

  @IsOptional()
  @IsNumber()
  thresholdValue?: number;

  @IsOptional()
  @IsNumber()
  thresholdValueMax?: number | null;

  @IsOptional()
  @IsIn([RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.VERY_HIGH])
  riskLevel?: RiskLevel;

  @IsOptional()
  @IsString()
  alertTitle?: string;

  @IsOptional()
  @IsString()
  alertDescription?: string;

  @IsOptional()
  @IsString()
  followUpAction?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
