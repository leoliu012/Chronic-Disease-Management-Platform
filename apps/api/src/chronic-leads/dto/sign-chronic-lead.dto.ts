import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { LeadConsentSource } from '@prisma/client';

export class SignChronicLeadDto {
  @IsEnum(LeadConsentSource)
  consentSource!: LeadConsentSource;

  /**
   * 签约证据引用。一般是「电话邀约 / 患者口头同意 / 时间戳」或微信小程序签约时的
   * openId + 知情同意版本号。**必填**，便于事后追溯。
   */
  @IsString()
  @MinLength(4)
  @MaxLength(500)
  consentRef!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  overrideName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  overridePhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  overrideHospitalPatientId?: string;
}
