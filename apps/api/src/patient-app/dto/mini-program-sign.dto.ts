import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class MiniProgramSignDto {
  /**
   * 必填：小程序里待签约的 ChronicLead.id（由 lookup 接口返回给前端）。
   */
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  leadId!: string;

  /**
   * 必填：患者点了「同意」按钮 = true。任何 false 或缺失值都会被服务端拒绝。
   */
  @IsBoolean()
  consentAccepted!: boolean;

  /**
   * 知情同意协议版本号（前端硬编码 / 通过配置接口拉取）。
   * 写入 ChronicLead.consentRef 作为审计证据。
   */
  @IsString()
  @MaxLength(32)
  consentVersion!: string;

  /**
   * 微信端的可信标识（demoOpenId / openId）。
   * 在 MVP 阶段直接复用 PatientAppService.normalizeDemoOpenId 的逻辑。
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  demoOpenId?: string;

  /**
   * 可选：患者在小程序里补充的真实姓名 / 手机号。若线索快照里已经有，可不传。
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  patientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  patientPhone?: string;
}
