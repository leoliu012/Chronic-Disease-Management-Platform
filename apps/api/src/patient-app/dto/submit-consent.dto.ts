import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const IDENTITY_MATCH_TYPES = [
  'CHRONIC_LEAD',
  'EXISTING_PATIENT',
  'HIS_PATIENT',
] as const;

export type IdentityMatchType = (typeof IDENTITY_MATCH_TYPES)[number];

/**
 * POST /patient-app/consent/submit
 *
 * 患者勾选并签署《知情同意与隐私授权协议》。该接口只负责落一条独立的
 * PatientConsent 同意书记录，不创建 Patient / 不提交绑定申请。
 *
 * 紧接着小程序会用返回的 consentId 调用 POST /patient-app/binding-requests
 * 完成「提交绑定申请」——签署同意书与提交绑定申请是患者端同一连续流程的两步。
 */
export class SubmitConsentDto {
  /** @deprecated New mini-program flow identifies the user via x-mini-session-token. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  demoOpenId?: string;

  /**
   * 患者点了「同意」= true。任何 false / 缺失都会被拒绝。
   */
  @IsBoolean()
  consentAccepted!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  consentVersion?: string;

  /**
   * 本次匹配到的对象类型，来自 identity/lookup 的返回。
   */
  @IsIn(IDENTITY_MATCH_TYPES)
  matchType!: IdentityMatchType;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  chronicLeadId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  patientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  hospitalPatientId?: string;

  /**
   * 知情同意书正文快照（前端把当前展示给患者的协议全文回传，便于事后举证）。
   */
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  consentTextSnapshot?: string;
}
