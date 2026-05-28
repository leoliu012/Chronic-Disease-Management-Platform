import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type { HospitalWechatOfficialAccount, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
} from './secret-crypto.util';

export type AccountSummary = {
  hospitalTenantId: string;
  accountName: string | null;
  originalId: string | null;
  appIdMasked: string;
  hasAppSecret: boolean;
  appSecretMasked: string;
  qrCodeUrl: string | null;
  h5BaseUrl: string | null;
  oauthCallbackDomain: string | null;
  templateQuestionnaireId: string | null;
  templateVitalId: string | null;
  templateMedicationId: string | null;
  templateHospitalVisitId: string | null;
  isEnabled: boolean;
  isVerified: boolean;
  lastTokenRefreshAt: Date | null;
  accessTokenExpiresAt: Date | null;
  configured: boolean;
};

/**
 * HospitalWechatOfficialAccountService
 * -------------------------------------
 * Per-hospital service account 配置的 CRUD + 运维操作.
 *
 * appSecret 落库前必须 encryptSecret(); 出库时按需 decryptSecret().
 * 普通医生 / 护士看不到 appSecret 明文, 只能看见 ****.
 */
@Injectable()
export class HospitalWechatOfficialAccountService {
  private readonly logger = new Logger('HospitalWechatOfficialAccount');

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // tenant helpers
  // ---------------------------------------------------------------------------

  /** Resolve which tenant the caller is operating on (ADMIN may target others). */
  resolveTargetTenantId(args: {
    role: UserRole;
    callerTenantId: string | null;
    requestedTenantId?: string | null;
  }): string {
    if (args.role === ('ADMIN' as UserRole)) {
      const candidate = args.requestedTenantId || args.callerTenantId;
      if (!candidate) {
        throw new BadRequestException(
          'ADMIN 需要在请求中明确指定 hospitalTenantId, 或绑定到一个具体医院.',
        );
      }
      return candidate;
    }
    // non-admin: must operate on their own tenant
    if (args.requestedTenantId && args.requestedTenantId !== args.callerTenantId) {
      throw new ForbiddenException('无权配置其它医院的服务号');
    }
    if (!args.callerTenantId) {
      throw new ForbiddenException('当前用户未绑定任何医院, 无法配置服务号.');
    }
    return args.callerTenantId;
  }

  // ---------------------------------------------------------------------------
  // queries
  // ---------------------------------------------------------------------------

  async getAccountForTenant(hospitalTenantId: string): Promise<HospitalWechatOfficialAccount | null> {
    return this.prisma.hospitalWechatOfficialAccount.findUnique({
      where: { hospitalTenantId },
    });
  }

  async getSummary(hospitalTenantId: string): Promise<AccountSummary> {
    const row = await this.getAccountForTenant(hospitalTenantId);
    if (!row) {
      return {
        hospitalTenantId,
        accountName: null,
        originalId: null,
        appIdMasked: '',
        hasAppSecret: false,
        appSecretMasked: '',
        qrCodeUrl: null,
        h5BaseUrl: null,
        oauthCallbackDomain: null,
        templateQuestionnaireId: null,
        templateVitalId: null,
        templateMedicationId: null,
        templateHospitalVisitId: null,
        isEnabled: false,
        isVerified: false,
        lastTokenRefreshAt: null,
        accessTokenExpiresAt: null,
        configured: false,
      };
    }
    return {
      hospitalTenantId: row.hospitalTenantId,
      accountName: row.accountName,
      originalId: row.originalId,
      appIdMasked: maskSecret(row.appId),
      hasAppSecret: Boolean(row.appSecretEncrypted),
      appSecretMasked: row.appSecretEncrypted ? '****' : '',
      qrCodeUrl: row.qrCodeUrl,
      h5BaseUrl: row.h5BaseUrl,
      oauthCallbackDomain: row.oauthCallbackDomain,
      templateQuestionnaireId: row.templateQuestionnaireId,
      templateVitalId: row.templateVitalId,
      templateMedicationId: row.templateMedicationId,
      templateHospitalVisitId: row.templateHospitalVisitId,
      isEnabled: row.isEnabled,
      isVerified: row.isVerified,
      lastTokenRefreshAt: row.lastTokenRefreshAt,
      accessTokenExpiresAt: row.accessTokenExpiresAt,
      configured: true,
    };
  }

  // ---------------------------------------------------------------------------
  // upsert
  // ---------------------------------------------------------------------------

  async upsert(args: {
    hospitalTenantId: string;
    accountName?: string;
    originalId?: string;
    appId: string;
    appSecret?: string;
    qrCodeUrl?: string;
    h5BaseUrl?: string;
    oauthCallbackDomain?: string;
    templateQuestionnaireId?: string;
    templateVitalId?: string;
    templateMedicationId?: string;
    templateHospitalVisitId?: string;
    isEnabled?: boolean;
    isVerified?: boolean;
  }): Promise<HospitalWechatOfficialAccount> {
    if (!args.hospitalTenantId) throw new BadRequestException('hospitalTenantId is required');
    if (!args.appId) throw new BadRequestException('appId is required');

    // Validate the tenant exists — Prisma will throw a Postgres FK error otherwise,
    // but we'd rather surface a clean 400.
    const tenant = await this.prisma.hospitalTenant.findUnique({
      where: { id: args.hospitalTenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException(`HospitalTenant ${args.hospitalTenantId} not found`);

    const existing = await this.prisma.hospitalWechatOfficialAccount.findUnique({
      where: { hospitalTenantId: args.hospitalTenantId },
    });

    // appSecret rules:
    //   create:    required
    //   update:    only re-encrypt if provided; otherwise keep the previous ciphertext
    let appSecretEncrypted: string | undefined;
    if (args.appSecret && args.appSecret.trim().length > 0) {
      appSecretEncrypted = encryptSecret(args.appSecret.trim());
    } else if (!existing) {
      throw new BadRequestException('首次配置时必须提供 appSecret');
    }

    const data = {
      accountName: args.accountName,
      originalId: args.originalId,
      appId: args.appId,
      ...(appSecretEncrypted ? { appSecretEncrypted } : {}),
      qrCodeUrl: args.qrCodeUrl,
      h5BaseUrl: args.h5BaseUrl,
      oauthCallbackDomain: args.oauthCallbackDomain,
      templateQuestionnaireId: args.templateQuestionnaireId,
      templateVitalId: args.templateVitalId,
      templateMedicationId: args.templateMedicationId,
      templateHospitalVisitId: args.templateHospitalVisitId,
      isEnabled: args.isEnabled ?? existing?.isEnabled ?? false,
      isVerified: args.isVerified ?? existing?.isVerified ?? false,
    };

    if (existing) {
      return this.prisma.hospitalWechatOfficialAccount.update({
        where: { hospitalTenantId: args.hospitalTenantId },
        data,
      });
    }
    return this.prisma.hospitalWechatOfficialAccount.create({
      data: {
        hospitalTenantId: args.hospitalTenantId,
        ...data,
        appSecretEncrypted: appSecretEncrypted!,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // access_token (cache lives in DB column; in production swap for Redis)
  // ---------------------------------------------------------------------------

  /**
   * Test fetching access_token for a tenant.
   *
   * v2.1 fix (Problem 4): mock 模式直接返回 success, 不依赖 appSecret 能解出.
   * 这样 demo seed 里的占位密文不会卡住调试.
   */
  async testAccessToken(hospitalTenantId: string): Promise<{
    ok: boolean;
    mocked: boolean;
    message: string;
    expiresInSec?: number;
  }> {
    const account = await this.getAccountForTenant(hospitalTenantId);
    if (!account) {
      return { ok: false, mocked: false, message: '尚未配置服务号' };
    }

    // Mock-first — bypass secret decryption entirely.
    if (this.isMock()) {
      const token = 'mock-access-token-' + crypto.randomBytes(8).toString('hex');
      const expiresAt = new Date(Date.now() + 7100 * 1000);
      await this.prisma.hospitalWechatOfficialAccount.update({
        where: { hospitalTenantId },
        data: {
          accessTokenEncrypted: encryptSecret(token),
          accessTokenExpiresAt: expiresAt,
          lastTokenRefreshAt: new Date(),
        },
      });
      return { ok: true, mocked: true, message: 'mock access_token 已生成', expiresInSec: 7100 };
    }

    // Production path — actually call WeChat.
    const appSecret = decryptSecret(account.appSecretEncrypted);
    if (!appSecret) {
      return { ok: false, mocked: false, message: 'appSecret 解密失败 — 请重新填写' };
    }
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(account.appId)}&secret=${encodeURIComponent(appSecret)}`;
    try {
      const res = await fetch(url, { method: 'GET' });
      const json: any = await res.json();
      if (json.errcode && json.errcode !== 0) {
        return { ok: false, mocked: false, message: `[wx ${json.errcode}] ${json.errmsg || ''}` };
      }
      const token: string = String(json.access_token || '');
      const expiresInSec: number = Number(json.expires_in || 7200);
      if (!token) {
        return { ok: false, mocked: false, message: '微信未返回 access_token' };
      }
      const expiresAt = new Date(Date.now() + Math.max(60, expiresInSec - 100) * 1000);
      await this.prisma.hospitalWechatOfficialAccount.update({
        where: { hospitalTenantId },
        data: {
          accessTokenEncrypted: encryptSecret(token),
          accessTokenExpiresAt: expiresAt,
          lastTokenRefreshAt: new Date(),
        },
      });
      return { ok: true, mocked: false, message: 'access_token 已刷新', expiresInSec };
    } catch (e) {
      return { ok: false, mocked: false, message: `网络请求失败: ${(e as Error).message}` };
    }
  }

  isMock(): boolean {
    return String(process.env.WECHAT_OFFICIAL_ACCOUNT_MOCK || 'true').toLowerCase() === 'true';
  }
}


