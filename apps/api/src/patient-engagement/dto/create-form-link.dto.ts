import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Base body shared by all "create-and-optionally-send" engagement requests.
 *
 * The concrete controller decides the `type` (QUESTIONNAIRE / VITAL_RECHECK /
 * MEDICATION_CHECKIN / HOSPITAL_VISIT_CONFIRM) based on its own route. The DTO
 * here is intentionally permissive — every endpoint extends it for the fields
 * it cares about (e.g. questionnaireType, vitalType, medicationId, ...).
 */
export class CreateFormLinkDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  expiresInHours?: number;

  @IsOptional()
  @IsString()
  taskId?: string;

  @IsOptional()
  @IsString()
  riskAlertId?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  send?: boolean;

  @IsOptional()
  @IsString()
  preferredChannel?: string; // WECHAT_OFFICIAL_ACCOUNT / SMS / MANUAL_COPY / AUTO

  @IsOptional()
  @IsBoolean()
  requiresIdentityCheck?: boolean;
}

export class CreateQuestionnaireLinkDto extends CreateFormLinkDto {
  @IsString()
  questionnaireType!: string;
}

export class CreateVitalRecheckLinkDto extends CreateFormLinkDto {
  @IsString()
  vitalType!: string; // BLOOD_PRESSURE / BLOOD_GLUCOSE / WEIGHT / SPO2 / HEART_RATE / ...
}

export class CreateMedicationCheckInLinkDto extends CreateFormLinkDto {
  @IsString()
  medicationId!: string;

  @IsOptional()
  @IsString()
  scheduledAt?: string;
}

export class CreateHospitalVisitConfirmLinkDto extends CreateFormLinkDto {
  @IsOptional()
  @IsString()
  hospitalVisitReminderId?: string;

  @IsString()
  reason!: string;
}

export class RevokeFormLinkDto {
  @IsString()
  reason!: string;
}
