import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export type MiniProgramContext = {
  miniProgramAppId: string;
  miniProgramOpenId: string;
  miniProgramUnionId?: string | null;
};

type Code2SessionResult = {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
};

@Injectable()
export class WechatMiniProgramService {
  private readonly logger = new Logger(WechatMiniProgramService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get appId() {
    return process.env.WECHAT_MINI_PROGRAM_APP_ID || '';
  }

  private get appSecret() {
    return process.env.WECHAT_MINI_PROGRAM_APP_SECRET || '';
  }

  private get mockEnabled() {
    return String(process.env.WECHAT_MINI_PROGRAM_MOCK || '').toLowerCase() === 'true';
  }

  private get sessionSecret() {
    return process.env.MINI_PROGRAM_SESSION_SECRET || process.env.JWT_SECRET || 'dev_only_change_me';
  }

  private get ttlMinutes() {
    const raw = Number(process.env.MINI_PROGRAM_SESSION_TTL_MINUTES || 30);
    return Number.isFinite(raw) && raw > 0 ? raw : 30;
  }

  private hashToken(token: string) {
    return crypto.createHmac('sha256', this.sessionSecret).update(token).digest('hex');
  }

  private createToken() {
    return crypto.randomBytes(32).toString('base64url');
  }

  async exchangeCodeForOpenId(code: string): Promise<MiniProgramContext> {
    const safeCode = String(code || '').trim();
    if (!safeCode) {
      throw new BadRequestException('Missing wx.login code');
    }

    if (this.mockEnabled) {
      return {
        miniProgramAppId: this.appId || 'mock-mini-program-app',
        miniProgramOpenId: `mock-mini-openid-${crypto.createHash('sha256').update(safeCode).digest('hex').slice(0, 24)}`,
        miniProgramUnionId: null,
      };
    }

    if (!this.appId || !this.appSecret) {
      throw new BadRequestException('Missing WECHAT_MINI_PROGRAM_APP_ID or WECHAT_MINI_PROGRAM_APP_SECRET');
    }

    const url =
      'https://api.weixin.qq.com/sns/jscode2session' +
      `?appid=${encodeURIComponent(this.appId)}` +
      `&secret=${encodeURIComponent(this.appSecret)}` +
      `&js_code=${encodeURIComponent(safeCode)}` +
      '&grant_type=authorization_code';

    const response = await fetch(url);
    const data = (await response.json()) as Code2SessionResult;

    if (data.errcode) {
      this.logger.warn(`jscode2session failed: ${data.errcode} ${data.errmsg || ''}`);
      throw new BadRequestException(`微信小程序登录失败: ${data.errcode} ${data.errmsg || ''}`);
    }

    if (!data.openid) {
      throw new BadRequestException('微信小程序登录失败: missing openid');
    }

    return {
      miniProgramAppId: this.appId,
      miniProgramOpenId: data.openid,
      miniProgramUnionId: data.unionid ?? null,
    };
  }

  async createAuthSession(ctx: MiniProgramContext) {
    const token = this.createToken();
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + this.ttlMinutes * 60 * 1000);

    await this.prisma.miniProgramAuthSession.create({
      data: {
        miniProgramAppId: ctx.miniProgramAppId,
        miniProgramOpenId: ctx.miniProgramOpenId,
        miniProgramUnionId: ctx.miniProgramUnionId ?? undefined,
        tokenHash,
        expiresAt,
      },
    });

    return { miniSessionToken: token, expiresAt };
  }

  async requireContextFromToken(miniSessionToken?: string | null): Promise<MiniProgramContext> {
    const token = String(miniSessionToken || '').trim();
    if (!token) {
      throw new UnauthorizedException('Missing x-mini-session-token');
    }

    const session = await this.prisma.miniProgramAuthSession.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });

    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid or expired mini session');
    }

    await this.prisma.miniProgramAuthSession.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      miniProgramAppId: session.miniProgramAppId,
      miniProgramOpenId: session.miniProgramOpenId,
      miniProgramUnionId: session.miniProgramUnionId,
    };
  }
}
