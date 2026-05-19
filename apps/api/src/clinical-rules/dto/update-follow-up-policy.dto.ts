import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { RiskLevel } from '@prisma/client';

export class UpdateFollowUpPolicyDto {
  @IsOptional()
  @IsIn([RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.VERY_HIGH])
  riskLevel?: RiskLevel;

  @IsOptional()
  @IsString()
  followUpType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  dueWithinHours?: number;

  @IsOptional()
  @IsString()
  frequencyDescription?: string;

  @IsOptional()
  @IsString()
  taskTitle?: string;

  @IsOptional()
  @IsString()
  instruction?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
