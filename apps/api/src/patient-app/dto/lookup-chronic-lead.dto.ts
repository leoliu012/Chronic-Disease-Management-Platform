import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class LookupChronicLeadDto {
  /**
   * 患者扫描门诊医生桌面上贴的签约二维码时，二维码 URL 中携带的
   * leadId / hospitalPatientId 之类的参数。
   *
   * 小程序后端必须把以下任一组合发上来：
   *  - leadId (最快)
   *  - hospitalPatientId
   *  - phone + idCardLast4
   *  - phone + hospitalPatientId
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  leadId?: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(128)
  demoOpenId?: string;
}
