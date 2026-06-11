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

export class UpdateVitalMonitoringPlanDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsIn(['DAY', 'WEEK', 'MONTH'])
  frequencyUnit?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  timesPerUnit?: number;

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

  /** Persisted operational SLA after a missed-measurement event. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10080)
  missedFollowUpDueWithinMinutes?: number;

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
