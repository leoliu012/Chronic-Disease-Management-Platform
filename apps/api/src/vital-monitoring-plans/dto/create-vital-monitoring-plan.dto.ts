import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateVitalMonitoringPlanDto {
  @IsString()
  vitalType!: string;

  @IsString()
  displayName!: string;

  @IsString()
  unit!: string;

  @IsIn(['DAY', 'WEEK', 'MONTH'])
  frequencyUnit!: string;

  @IsInt()
  @Min(1)
  @Max(31)
  timesPerUnit!: number;

  @IsOptional()
  @IsArray()
  customMeasureTimes?: string[];

  @IsOptional()
  @IsArray()
  customMeasureDays?: number[];

  @IsOptional()
  @IsInt()
  @Min(0)
  reminderLeadMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  checkInWindowBeforeMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  missedWindowAfterMinutes?: number;

  @IsOptional()
  @IsString()
  sourcePreset?: string;

  @IsOptional()
  @IsString()
  evidenceBasis?: string;

  @IsOptional()
  @IsString()
  evidenceSource?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
