import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const REMINDER_TYPES = [
  'MEDICATION_CHECKIN',
  'VITAL_RECHECK',
  'QUESTIONNAIRE',
  'GENERAL_MESSAGE',
] as const;
const FREQ_UNITS = ['DAY', 'WEEK', 'MONTH'] as const;

export class CreateMedicationScheduleDto {
  @IsString()
  @MaxLength(100)
  medicationId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** e.g. ["08:00", "20:00"] — tenant timezone wall-clock. */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  scheduledTimes!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsString({ each: true })
  scheduledDays?: string[];

  @IsOptional()
  @IsIn(FREQ_UNITS as readonly string[])
  frequencyUnit?: (typeof FREQ_UNITS)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  reminderLeadMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  checkInWindowBeforeMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  checkInWindowAfterMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  escalationAfterMinutes?: number;
}

export class CreateVitalScheduleDto {
  /** BLOOD_PRESSURE / BLOOD_GLUCOSE / WEIGHT / SPO2 / HEART_RATE */
  @IsString()
  @MaxLength(40)
  vitalType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  scheduledTimes!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsString({ each: true })
  scheduledDays?: string[];

  @IsOptional()
  @IsIn(FREQ_UNITS as readonly string[])
  frequencyUnit?: (typeof FREQ_UNITS)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  reminderLeadMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  checkInWindowBeforeMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  checkInWindowAfterMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  escalationAfterMinutes?: number;

  @IsOptional()
  @IsString()
  vitalMonitoringPlanId?: string;
}

export class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  scheduledTimes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsString({ each: true })
  scheduledDays?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  reminderLeadMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  checkInWindowBeforeMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  checkInWindowAfterMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  escalationAfterMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreatePatientDirectMessageDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsString()
  @MaxLength(2000)
  content!: string;

  @IsOptional()
  @IsIn(['NORMAL', 'IMPORTANT', 'URGENT'])
  priority?: 'NORMAL' | 'IMPORTANT' | 'URGENT';

  @IsOptional()
  @IsBoolean()
  requiresAck?: boolean;

  @IsOptional()
  @IsIn(['AUTO', 'WECHAT_OFFICIAL_ACCOUNT', 'SMS', 'MANUAL_COPY'])
  preferredChannel?: 'AUTO' | 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS' | 'MANUAL_COPY';
}

export class SubmitMessageAckDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
