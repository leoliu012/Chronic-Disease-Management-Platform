import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { IDENTITY_MATCH_TYPES } from './submit-consent.dto';
import type { IdentityMatchType } from './submit-consent.dto';

/**
 * POST /patient-app/binding-requests —— 提交绑定申请
 *
 * 统一入口：患者在小程序里搜索院内信息 → 确认身份 → 签署知情同意书 → 提交绑定申请。
 *
 * 如果 matchType = CHRONIC_LEAD，本接口内部会同步完成：
 *   ChronicLead.sign() → create Patient → create DiseaseProfile
 *   → generate follow-up tasks → create PatientBindingRequest
 *
 * 如果 matchType = EXISTING_PATIENT（或不传，兼容旧逻辑），仅创建绑定申请，
 * 等护士在 Web 端审核通过后签发患者端会话。
 */
export class CreatePatientBindingRequestDto {
  @IsString()
  @MaxLength(128)
  demoOpenId!: string;

  @IsString()
  @MaxLength(32)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  hospitalPatientId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/)
  idCardLast4?: string;

  /**
   * 本次匹配到的对象类型，来自 identity/lookup。不传时默认按 EXISTING_PATIENT 处理。
   */
  @IsOptional()
  @IsIn(IDENTITY_MATCH_TYPES)
  matchType?: IdentityMatchType;

  /**
   * matchType = CHRONIC_LEAD 时必填：邀约库线索 id。
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  chronicLeadId?: string;

  /**
   * consent/submit 返回的同意书记录 id。患者端流程里必传，
   * 后端会校验该同意书有效并回填 patientId / bindingRequestId。
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  consentId?: string;

  /**
   * 可选：患者在小程序里补充的真实姓名（线索快照缺姓名时用于建档）。
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  patientName?: string;
}
