import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * POST /patient-app/identity/lookup
 *
 * 患者在小程序绑定入口里输入院内号 / 手机号 / 身份证后四位后，
 * 后端按 ChronicLead → Patient → HIS 的顺序搜索匹配。
 *
 * 不再接受扫码二维码携带的 leadId —— 扫码直达同意书的入口已移除。
 */
export class IdentityLookupDto {
  /** @deprecated New mini-program flow identifies the user via x-mini-session-token. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  demoOpenId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  hospitalPatientId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^1\d{10}$/, { message: 'phone 必须是 11 位手机号' })
  phone?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'idCardLast4 必须是 4 位数字' })
  idCardLast4?: string;
}
