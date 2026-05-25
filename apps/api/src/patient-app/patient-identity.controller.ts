/**
 * patient-identity.controller.ts —— 患者端统一身份核验与知情同意 HTTP 端口
 *
 * patient-self-consent-bind 设计：
 *   所有患者统一通过小程序绑定入口完成
 *     搜索院内信息 → 确认身份 → 签署知情同意书 → 提交绑定申请。
 *
 *   - POST /patient-app/identity/lookup  按 ChronicLead → Patient → HIS 顺序搜索
 *   - POST /patient-app/consent/submit   保存独立的 PatientConsent 同意书记录
 *
 *   「提交绑定申请」仍走 POST /patient-app/binding-requests
 *   （见 PatientAppController），若命中邀约库则在该接口内部同步完成签约 + 建档。
 *
 * 扫码直达同意书（旧 /patient-app/chronic-lead/*）入口已移除。
 */

import { Body, Controller, Post, Req } from '@nestjs/common';
import { Public } from '../security/public.decorator';
import { PatientAppService } from './patient-app.service';
import { IdentityLookupDto } from './dto/identity-lookup.dto';
import { SubmitConsentDto } from './dto/submit-consent.dto';

type IdentityRequest = {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
};

function getIpAddress(req: IdentityRequest) {
  const forwardedFor = req.headers['x-forwarded-for'];
  return (
    Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor || req.socket?.remoteAddress
  )?.toString();
}

function getUserAgent(req: IdentityRequest) {
  const ua = req.headers['user-agent'];
  return (Array.isArray(ua) ? ua[0] : ua)?.toString();
}

@Public()
@Controller('patient-app')
export class PatientIdentityController {
  constructor(private readonly patientAppService: PatientAppService) {}

  /**
   * 搜索院内信息。返回 matchType:
   *   CHRONIC_LEAD | EXISTING_PATIENT | HIS_PATIENT | NOT_FOUND
   */
  @Post('identity/lookup')
  lookup(@Body() dto: IdentityLookupDto) {
    return this.patientAppService.lookupIdentity(dto);
  }

  /**
   * 签署知情同意书，保存独立 PatientConsent 记录。
   * 返回 consentId，供随后的 /patient-app/binding-requests 引用。
   */
  @Post('consent/submit')
  submitConsent(@Body() dto: SubmitConsentDto, @Req() req: IdentityRequest) {
    return this.patientAppService.submitConsent(
      dto,
      getIpAddress(req),
      getUserAgent(req),
    );
  }
}
