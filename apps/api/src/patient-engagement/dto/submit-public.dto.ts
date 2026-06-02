import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class IdentityCheckDto {
  @IsOptional()
  @IsString()
  phoneLast4?: string;

  @IsOptional()
  @IsString()
  idCardLast4?: string;

  @IsOptional()
  @IsString()
  birthDate?: string;
}

export class SubmitPublicQuestionnaireDto {
  @IsOptional()
  @IsString()
  formSessionToken?: string;

  @IsObject()
  answers!: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  score?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class SubmitPublicVitalDto {
  @IsOptional()
  @IsString()
  formSessionToken?: string;

  @IsString()
  vitalType!: string;

  @IsOptional()
  @IsNumber()
  value?: number;

  @IsOptional()
  @IsNumber()
  systolic?: number;

  @IsOptional()
  @IsNumber()
  diastolic?: number;

  @IsString()
  unit!: string;

  @IsOptional()
  @IsString()
  measuredAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class SubmitPublicMedicationCheckInDto {
  @IsOptional()
  @IsString()
  formSessionToken?: string;

  // Optional for care-reminder H5 links: medicationId is embedded in
  // PatientFormLink.payload by the reminder worker, so elderly users only
  // need to tap "我已服药 / 今天未服药".
  @IsOptional()
  @IsString()
  medicationId?: string;

  @IsBoolean()
  taken!: boolean;

  @IsOptional()
  @IsString()
  checkedAt?: string;

  @IsOptional()
  @IsString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class SubmitPublicHospitalVisitDto {
  @IsOptional()
  @IsString()
  formSessionToken?: string;

  @IsString()
  action!: string; // WILL_VISIT / ARRIVED / CANNOT_VISIT / REFUSED

  @IsOptional()
  @IsString()
  note?: string;
}

export class WechatOAuthCallbackDto {
  @IsString()
  code!: string;

  @IsString()
  state!: string;
}
