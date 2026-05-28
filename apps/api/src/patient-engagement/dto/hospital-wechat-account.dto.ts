import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertHospitalWechatAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  originalId?: string;

  @IsString()
  @MaxLength(100)
  appId!: string;

  /** Only sent when (re-)setting the secret. Empty/undefined keeps the existing one. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  appSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  qrCodeUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  h5BaseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  oauthCallbackDomain?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  templateQuestionnaireId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  templateVitalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  templateMedicationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  templateHospitalVisitId?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  /**
   * ADMIN may explicitly mark the account as verified after the hospital has
   * passed WeChat's 服务号认证. Doctor / nurse roles can't see / set this.
   */
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  /** ADMIN cross-tenant only — when not provided, current user's tenant is used. */
  @IsOptional()
  @IsString()
  hospitalTenantId?: string;
}

export class TestSendHospitalWechatDto {
  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
  openId?: string;

  @IsOptional()
  @IsString()
  hospitalTenantId?: string;
}

export class TestAccessTokenDto {
  @IsOptional()
  @IsString()
  hospitalTenantId?: string;
}
