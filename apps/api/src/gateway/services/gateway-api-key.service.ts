/**
 * gateway-api-key.service.ts
 *
 * gateway-production-hardening: 每家医院/每个外部系统一个独立 API key.
 *
 * 为什么不再依赖全局 GATEWAY_API_KEY:
 *   - 一旦泄漏只能整体轮换, 影响所有医院, 等保评审过不了
 *   - 无法回答"是哪家医院 / 哪个外部系统 / 哪个 IP 发的"
 *   - 出问题时无法吊销单一通道
 *
 * 本服务负责:
 *   - 生成 key (返回明文一次, 仅持久化 sha256, 类似 GitHub PAT 体验)
 *   - 校验 key (常量时间比较, 同步刷新 lastUsedAt / lastUsedIp / usageCount)
 *   - 吊销 key (revokedAt + revokedBy + revokedReason)
 *
 * Key 格式:  gwk_<prefix>_<secret>
 *   prefix  : 12 字符随机, 用于在数据库中快速定位 (UNIQUE)
 *   secret  : 32 字符随机, 仅以 sha256 形式持久化
 *
 * 兼容性:
 *   - 没有任何 GatewayApiKey 行 且 GATEWAY_API_KEY 环境变量已设置时,
 *     旧的全局 key 仍然可用 (dev / 单机演示场景), 通道默认归到第一个
 *     IntegrationSource 上, 由 Guard 层处理.
 *   - 一旦插入了任何一条 GatewayApiKey, 该来源就强制启用新机制,
 *     全局 key 在该来源上不再生效.
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { GatewayApiKey, Prisma } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

/** 用户输入的 header 必须以这个前缀开头. */
export const API_KEY_HEADER_PREFIX = 'gwk_';

export interface IssueApiKeyInput {
  sourceId: string;
  description?: string;
  ipAllowlist?: string[];
  createdBy?: string;
}

export interface IssueApiKeyResult {
  id: string;
  sourceId: string;
  prefix: string;
  /** 完整 key, 仅在创建时返回一次, 不在 DB 中明文留存. */
  fullKey: string;
  description?: string | null;
  ipAllowlist: string[];
  createdAt: Date;
}

export interface VerifyApiKeyResult {
  apiKey: GatewayApiKey;
  sourceId: string;
}

@Injectable()
export class GatewayApiKeyService {
  private readonly logger = new Logger('GatewayApiKeyService');

  constructor(private readonly prisma: PrismaService) {}

  /* ----------------------------------------------------------------- */
  /*  Issue / revoke                                                    */
  /* ----------------------------------------------------------------- */

  async issue(input: IssueApiKeyInput): Promise<IssueApiKeyResult> {
    const source = await this.prisma.integrationSource.findUnique({
      where: { id: input.sourceId },
    });
    if (!source) {
      throw new NotFoundException(`Integration source ${input.sourceId} not found`);
    }

    const prefix = this.generatePrefix();
    const secret = this.generateSecret();
    const fullKey = `${API_KEY_HEADER_PREFIX}${prefix}_${secret}`;
    const keyHash = this.hashSecret(secret);

    // 校验 IP allowlist (CIDR 语法)
    const ipAllowlist = (input.ipAllowlist ?? []).map((cidr) =>
      cidr.trim(),
    );
    for (const cidr of ipAllowlist) {
      if (!this.isValidCidr(cidr)) {
        throw new BadRequestException(`Invalid CIDR in ipAllowlist: ${cidr}`);
      }
    }

    const row = await this.prisma.gatewayApiKey.create({
      data: {
        sourceId: input.sourceId,
        prefix,
        keyHash,
        description: input.description,
        ipAllowlist,
        createdBy: input.createdBy,
      },
    });

    this.logger.log(
      `Issued API key id=${row.id} prefix=${prefix} source=${source.code} by=${input.createdBy ?? 'system'}`,
    );

    return {
      id: row.id,
      sourceId: row.sourceId,
      prefix: row.prefix,
      fullKey,
      description: row.description,
      ipAllowlist: row.ipAllowlist,
      createdAt: row.createdAt,
    };
  }

  async revoke(
    id: string,
    options: { revokedBy?: string; reason?: string } = {},
  ): Promise<GatewayApiKey> {
    const existing = await this.prisma.gatewayApiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`API key ${id} not found`);
    }
    if (existing.revokedAt) {
      return existing;
    }
    const updated = await this.prisma.gatewayApiKey.update({
      where: { id },
      data: {
        revokedAt: new Date(),
        revokedBy: options.revokedBy,
        revokedReason: options.reason,
      },
    });
    this.logger.warn(
      `Revoked API key id=${id} prefix=${existing.prefix} by=${options.revokedBy ?? 'system'} reason=${options.reason ?? '-'}`,
    );
    return updated;
  }

  async list(filter: { sourceId?: string; includeRevoked?: boolean } = {}) {
    const where: Prisma.GatewayApiKeyWhereInput = {};
    if (filter.sourceId) where.sourceId = filter.sourceId;
    if (!filter.includeRevoked) where.revokedAt = null;
    return this.prisma.gatewayApiKey.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { source: true },
    });
  }

  async hasAnyActiveKey(): Promise<boolean> {
    const count = await this.prisma.gatewayApiKey.count({ where: { revokedAt: null } });
    return count > 0;
  }

  async hasActiveKeyForSource(sourceId: string): Promise<boolean> {
    const count = await this.prisma.gatewayApiKey.count({
      where: { sourceId, revokedAt: null },
    });
    return count > 0;
  }

  /* ----------------------------------------------------------------- */
  /*  Verify (hot path — REST guard 用)                                 */
  /* ----------------------------------------------------------------- */

  /**
   * 验证收到的 header 值. 返回 null 表示验证失败 (用调用方 throw 401).
   * Side effect: 成功时更新 lastUsedAt / lastUsedIp / usageCount.
   */
  async verifyAndTrack(
    rawHeaderValue: string,
    options: { remoteIp?: string } = {},
  ): Promise<VerifyApiKeyResult | null> {
    if (!rawHeaderValue || !rawHeaderValue.startsWith(API_KEY_HEADER_PREFIX)) {
      return null;
    }

    const body = rawHeaderValue.slice(API_KEY_HEADER_PREFIX.length);
    const sep = body.indexOf('_');
    if (sep < 0) return null;
    const prefix = body.slice(0, sep);
    const secret = body.slice(sep + 1);
    if (!prefix || !secret) return null;

    const row = await this.prisma.gatewayApiKey.findUnique({ where: { prefix } });
    if (!row) return null;
    if (row.revokedAt) return null;

    const computed = this.hashSecret(secret);
    if (!this.constantTimeEqualHex(computed, row.keyHash)) return null;

    // 异步 fire-and-forget 更新使用统计, 不阻塞请求.
    // 用 .catch() 而不是 await, 因为审计写失败也不应该让合法请求 401.
    this.prisma.gatewayApiKey
      .update({
        where: { id: row.id },
        data: {
          lastUsedAt: new Date(),
          lastUsedIp: options.remoteIp,
          usageCount: { increment: 1 },
        },
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to update GatewayApiKey.lastUsedAt id=${row.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

    return { apiKey: row, sourceId: row.sourceId };
  }

  /* ----------------------------------------------------------------- */
  /*  Helpers                                                            */
  /* ----------------------------------------------------------------- */

  private generatePrefix(): string {
    // 12 个十六进制字符 — 容量 16^12 (≈ 281 万亿), 远大于现实部署规模
    return randomBytes(6).toString('hex');
  }

  private generateSecret(): string {
    // base64url-style 32 字符. crypto.randomBytes 提供 CSPRNG.
    return randomBytes(24).toString('base64url');
  }

  private hashSecret(secret: string): string {
    return createHash('sha256').update(secret, 'utf8').digest('hex');
  }

  private constantTimeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    const aBuf = Buffer.from(a, 'hex');
    const bBuf = Buffer.from(b, 'hex');
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }

  /** 极简 CIDR 语法校验. 真正的网段匹配在 cidr-match.util.ts 里. */
  private isValidCidr(cidr: string): boolean {
    if (!cidr) return false;
    const slash = cidr.indexOf('/');
    if (slash < 0) {
      // 允许写裸 IP, 视为 /32 (v4) 或 /128 (v6)
      return this.isValidIp(cidr);
    }
    const ip = cidr.slice(0, slash);
    const mask = Number.parseInt(cidr.slice(slash + 1), 10);
    if (!this.isValidIp(ip)) return false;
    if (!Number.isFinite(mask) || mask < 0) return false;
    const isV6 = ip.includes(':');
    return mask <= (isV6 ? 128 : 32);
  }

  private isValidIp(ip: string): boolean {
    // IPv4
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      return ip.split('.').every((p) => {
        const n = Number.parseInt(p, 10);
        return n >= 0 && n <= 255;
      });
    }
    // 极简 IPv6 校验 — 业务上 IP allowlist 99% 都是 IPv4 局域网网段
    if (ip.includes(':')) {
      return /^[0-9a-fA-F:]+$/.test(ip) && ip.length <= 39;
    }
    return false;
  }
}
