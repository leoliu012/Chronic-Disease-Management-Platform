import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { DataSource } from '@prisma/client';

export class CreateMedicationDto {
  @IsString()
  medicationName!: string;

  @IsString()
  dosage!: string;

  // Backward-compatible display text. New clients should send structured fields below.
  @IsOptional()
  @IsString()
  frequency?: string;

  @IsOptional()
  @IsIn(['DAY', 'WEEK', 'MONTH'])
  frequencyUnit?: 'DAY' | 'WEEK' | 'MONTH';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  timesPerUnit?: number;

  @IsOptional()
  @IsIn(['NONE', 'BEFORE_MEAL', 'AFTER_MEAL', 'WITH_MEAL'])
  timingRelation?: 'NONE' | 'BEFORE_MEAL' | 'AFTER_MEAL' | 'WITH_MEAL';

  // Examples: ["08:00", "18:00"]. If omitted, the backend auto-spreads daytime doses.
  @IsOptional()
  @IsArray()
  customDoseTimes?: string[];

  // WEEK: 1-7 means Monday-Sunday. MONTH: 1-31 means day of month.
  @IsOptional()
  @IsArray()
  customDoseDays?: number[];

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(DataSource)
  dataSource?: DataSource;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
