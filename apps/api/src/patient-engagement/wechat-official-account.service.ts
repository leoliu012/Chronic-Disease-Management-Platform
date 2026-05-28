import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import type { HospitalWechatOfficialAccount } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HospitalWechatOfficialAccountService } from './hospital-wechat-account.service';
import { decryptSecret, encryptSecret } from './secret-crypto.util';

export type WechatSendInput = {
  hospitalTenantId: string;
  patientId: string;
  openId: string;
  messageType: string;
  title: string;
  content: string;
  linkUrl: string;
  formLinkId?: string;
};

export type WechatSendResult = {
  ok: boolean;
  providerMessageId?: string;
  errorMessage?: string;
  errorCode?: number;
  templateId?: string | null;
  mocked: boolean;
};

export type WechatOAuthExchangeResult = {
  success: boolean;
  openId?: string;
  unionId?: string;
  errorMessage?: string;
  errorCode?: number;
  mocked: boolean;
};

/**
 * WechatOfficialAccountService (v2.1)
 * ------------------------------------
 * 每家医院独立服务号. 真实接入版.
 *
 *   - access_token DB-backed cache (一医院一行 HospitalWechatOfficialAccount).
 *   - sendTemplateMessage 遇 errcode=40001/42001 自动 invalidate token 重试一次.
 *   - OAuth code 换 openId 走 sns/oauth2/access_token.
 *
 * 错误码处理 (v2.1):
 *   40001 / 42001  access_token 无效/过期  →  清缓存重拉 + 重发一次
 *   40037          模板 ID 不合法          →  直接 FAILED, 不重试
 *   43004          用户未关注              →  FAILED, 上层 SMS fallback
 *   45009          API 调用次数超限        →  FAILED, 记日志
 *   其它           原文返回                →  FAILED
 *
 * 仍保留 WECHAT_OFFICIAL_ACCOUNT_MOCK=true 路径用于开发, 写一致的 PatientOutboundMessage.
 *
 * 并发刷 access_token: 用一个 process-local 的 promise map 简单去重.
 *   prod 多实例下偶尔会有 2x 刷 token 请求, WeChat 端会返回同一个 token, 没事.
 */
@Injectable()
export class WechatOfficialAccountService {
  private readonly logger = new Logger('WechatOfficialAccount');
  private readonly tokenRefreshInflight = new Map<string, Promise<string | null>>();

  constructor(
    private readonly accounts: HospitalWechatOfficialAccountService,
    private readonly prisma: PrismaService,
  ) {}

  isMock(): boolean {
    return String(process.env.WECHAT_OFFICIAL_ACCOUNT_MOCK || 'true').toLowerCase() === 'true';
  }

  private templateIdFor(
    account: {
      templateQuestionnaireId: string | null;
      templateVitalId: string | null;
      templateMedicationId: string | null;
      templateHospitalVisitId: string | null;
    },
    messageType: string,
  ): string | null {
    switch (messageType) {
      case 'QUESTIONNAIRE_REMINDER':
        return account.templateQuestionnaireId;
      case 'VITAL_RECHECK_REMINDER':
        return account.templateVitalId;
      case 'MEDICATION_REMINDER':
        return account.templateMedicationId;
      case 'HOSPITAL_VISIT_REMINDER':
        return account.templateHospitalVisitId;
      default:
        return null;
    }
  }

  async tenantCanReceiveWechat(hospitalTenantId: string): Promise<boolean> {
    const account = await this.accounts.getAccountForTenant(hospitalTenantId);
    return Boolean(account && account.isEnabled && account.isVerified && account.appId);
  }

  async getAppIdForTenant(hospitalTenantId: string): Promise<string | null> {
    const account = await this.accounts.getAccountForTenant(hospitalTenantId);
    return account?.appId ?? null;
  }

  // ---------------------------------------------------------------------------
  // access_token cache
  // ---------------------------------------------------------------------------

  /** Return a fresh access_token (refreshing if needed), or null on failure. */
  async getAccessToken(hospitalTenantId: string, forceRefresh = false): Promise<string | null> {
    const account = await this.accounts.getAccountForTenant(hospitalTenantId);
    if (!account) return null;

    if (!forceRefresh && account.accessTokenEncrypted && account.accessTokenExpiresAt) {
      const ms = account.accessTokenExpiresAt.getTime() - Date.now();
      if (ms > 5 * 60 * 1000) {
        const cached = decryptSecret(account.accessTokenEncrypted);
        if (cached) return cached;
      }
    }

    // dedup concurrent refresh per tenant
    const existing = this.tokenRefreshInflight.get(hospitalTenantId);
    if (existing) return existing;

    const p = this.refreshAccessTokenNow(account).finally(() => {
      this.tokenRefreshInflight.delete(hospitalTenantId);
    });
    this.tokenRefreshInflight.set(hospitalTenantId, p);
    return p;
  }

  private async refreshAccessTokenNow(
    account: HospitalWechatOfficialAccount,
  ): Promise<string | null> {
    if (this.isMock()) {
      const token = 'mock-access-token-' + crypto.randomBytes(8).toString('hex');
      const expiresAt = new Date(Date.now() + 7100 * 1000);
      await this.prisma.hospitalWechatOfficialAccount.update({
        where: { hospitalTenantId: account.hospitalTenantId },
        data: {
          accessTokenEncrypted: encryptSecret(token),
          accessTokenExpiresAt: expiresAt,
          lastTokenRefreshAt: new Date(),
        },
      });
      return token;
    }
    const appSecret = decryptSecret(account.appSecretEncrypted);
    if (!appSecret) {
      this.logger.warn(`access_token refresh skipped: appSecret decrypt failed for tenant ${account.hospitalTenantId}`);
      return null;
    }
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(account.appId)}&secret=${encodeURIComponent(appSecret)}`;
    try {
      const res = await fetch(url, { method: 'GET' });
      const json: any = await res.json();
      if (json.errcode && json.errcode !== 0) {
        this.logger.warn(
          `access_token refresh failed for tenant ${account.hospitalTenantId}: errcode=${json.errcode} ${json.errmsg}`,
        );
        return null;
      }
      const token: string = String(json.access_token || '');
      const expiresInSec: number = Number(json.expires_in || 7200);
      if (!token) return null;
      const expiresAt = new Date(Date.now() + Math.max(60, expiresInSec - 100) * 1000);
      await this.prisma.hospitalWechatOfficialAccount.update({
        where: { hospitalTenantId: account.hospitalTenantId },
        data: {
          accessTokenEncrypted: encryptSecret(token),
          accessTokenExpiresAt: expiresAt,
          lastTokenRefreshAt: new Date(),
        },
      });
      return token;
    } catch (e) {
      this.logger.warn(`access_token network failure tenant=${account.hospitalTenantId}: ${(e as Error).message}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // sendTemplateMessage
  // ---------------------------------------------------------------------------

  async sendTemplateMessage(input: WechatSendInput): Promise<WechatSendResult> {
    const account = await this.accounts.getAccountForTenant(input.hospitalTenantId);
    if (!account) {
      return { ok: false, errorMessage: '该医院尚未配置本院微信服务号', mocked: false, templateId: null };
    }
    if (!account.isEnabled) {
      return { ok: false, errorMessage: '本院服务号当前未启用', mocked: false, templateId: null };
    }
    if (!account.isVerified) {
      return { ok: false, errorMessage: '本院服务号尚未完成认证 (isVerified=false)', mocked: false, templateId: null };
    }
    const templateId = this.templateIdFor(account, input.messageType);

    if (this.isMock()) {
      const providerMessageId =
        'mock-wx-' +
        crypto
          .createHash('sha1')
          .update(`${input.hospitalTenantId}:${input.openId}:${Date.now()}`)
          .digest('hex')
          .slice(0, 16);
      this.logger.log(
        `[mock-wx] tenant=${input.hospitalTenantId} appId=${account.appId} -> openId=${input.openId} type=${input.messageType}`,
      );
      return { ok: true, providerMessageId, mocked: true, templateId: templateId ?? null };
    }

    if (!templateId) {
      return {
        ok: false,
        errorMessage: `本院服务号未配置该模板 (${input.messageType})`,
        mocked: false,
        templateId: null,
      };
    }

    // Build template_data payload — minimal but compatible.
    const data: Record<string, { value: string }> = {
      first: { value: input.title.slice(0, 200) },
      keyword1: { value: input.content.slice(0, 200) },
      remark: { value: '点击下方链接打开任务' },
    };

    const send = async (token: string) => {
      const url = `https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${encodeURIComponent(token)}`;
      const body = {
        touser: input.openId,
        template_id: templateId,
        url: input.linkUrl || undefined,
        data,
      };
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json: any = await res.json();
        return json;
      } catch (e) {
        return { errcode: -1, errmsg: (e as Error).message };
      }
    };

    let token = await this.getAccessToken(input.hospitalTenantId);
    if (!token) return { ok: false, errorMessage: '无法获取本院 access_token', mocked: false, templateId };

    let resp = await send(token);
    if (resp.errcode === 40001 || resp.errcode === 42001) {
      // token invalid/expired — refresh and retry once
      token = await this.getAccessToken(input.hospitalTenantId, true);
      if (!token) return { ok: false, errorMessage: 'access_token 刷新失败', mocked: false, templateId };
      resp = await send(token);
    }

    if (!resp || resp.errcode === undefined) {
      return { ok: false, errorMessage: '微信返回为空', mocked: false, templateId };
    }
    if (resp.errcode === 0) {
      return {
        ok: true,
        providerMessageId: String(resp.msgid ?? ''),
        mocked: false,
        templateId,
      };
    }

    // Friendlier error messages for common codes.
    const human = (() => {
      switch (resp.errcode) {
        case 40001: case 42001: return 'access_token 多次刷新仍失败';
        case 40037: return '模板 ID 在本院公众号下不存在';
        case 43004: return '患者未关注本院服务号';
        case 45009: return '本院公众号 API 调用次数超限';
        case 48001: return '本院公众号无 send_template 权限 (未认证服务号?)';
        default: return resp.errmsg || `errcode ${resp.errcode}`;
      }
    })();

    return {
      ok: false,
      errorMessage: `[wx ${resp.errcode}] ${human}`,
      errorCode: Number(resp.errcode),
      mocked: false,
      templateId,
    };
  }

  // ---------------------------------------------------------------------------
  // OAuth — 网页授权
  // ---------------------------------------------------------------------------

  async buildOAuthAuthorizeUrl(args: {
    hospitalTenantId: string;
    state: string;
    callbackUrl: string;
    scope?: 'snsapi_base' | 'snsapi_userinfo';
  }): Promise<string | null> {
    const account = await this.accounts.getAccountForTenant(args.hospitalTenantId);
    if (!account || !account.appId) return null;
    const scope = args.scope ?? 'snsapi_base';
    const encoded = encodeURIComponent(args.callbackUrl);
    return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${account.appId}&redirect_uri=${encoded}&response_type=code&scope=${scope}&state=${args.state}#wechat_redirect`;
  }

  async exchangeCodeForOpenId(args: {
    hospitalTenantId: string;
    code: string;
  }): Promise<WechatOAuthExchangeResult> {
    const account = await this.accounts.getAccountForTenant(args.hospitalTenantId);
    if (!account) {
      return { success: false, errorMessage: '医院尚未配置服务号', mocked: false };
    }
    if (this.isMock()) {
      const openId =
        'mock-openid-' +
        crypto.createHash('sha1').update(`${args.hospitalTenantId}:${args.code}`).digest('hex').slice(0, 20);
      return { success: true, openId, mocked: true };
    }
    const appSecret = decryptSecret(account.appSecretEncrypted);
    if (!appSecret) {
      return { success: false, errorMessage: '本院 appSecret 解密失败', mocked: false };
    }
    const url = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${encodeURIComponent(account.appId)}&secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(args.code)}&grant_type=authorization_code`;
    try {
      const res = await fetch(url, { method: 'GET' });
      const json: any = await res.json();
      if (json.errcode && json.errcode !== 0) {
        return {
          success: false,
          errorMessage: `[wx ${json.errcode}] ${json.errmsg || ''}`,
          errorCode: Number(json.errcode),
          mocked: false,
        };
      }
      if (!json.openid) {
        return { success: false, errorMessage: '微信未返回 openid', mocked: false };
      }
      return {
        success: true,
        openId: String(json.openid),
        unionId: json.unionid ? String(json.unionid) : undefined,
        mocked: false,
      };
    } catch (e) {
      return { success: false, errorMessage: (e as Error).message, mocked: false };
    }
  }
}
