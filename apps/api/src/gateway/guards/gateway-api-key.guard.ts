/**
 * gateway-api-key.guard.ts
 *
 * gateway-production-hardening: 入站网关接口 (FHIR / HIS Event REST) 的身份口令.
 *
 * 校验顺序 (任何一步失败立刻 401/403, fail-closed):
 *   1. 全局 GATEWAY_GLOBAL_IP_ALLOWLIST 命中 (空或未设视为 "未配置, 跳过这一关")
 *   2. 取 header `X-Gateway-Api-Key`
 *   3. 如果 header 形如 `gwk_<prefix>_<secret>` -> 走 GatewayApiKeyService.verifyAndTrack
 *      - 校验 prefix 是否存在 / 是否吊销 / sha256(secret) 是否匹配
 *      - 校验远端 IP 是否落在该 key 的 ipAllowlist 内 (空 = 放行)
 *      - 成功后把 IntegrationSource 写到 req.gatewaySource, 让下游审计 / promote 用
 *   4. 否则 (header 不带 gwk_ 前缀) 走 legacy GATEWAY_API_KEY 比对
 *      - 仅在 NODE_ENV != 'production' 时允许 (生产强制走第 3 步)
 *      - 这条路径不知道是哪个 source, 不写 req.gatewaySource
 *
 * 兼容:
 *   - 既有 dev 环境的 GATEWAY_API_KEY 变量不动, 升级零摩擦
 *   - 一旦在某个 IntegrationSource 上签了第一把 GatewayApiKey, 该 source
 *     的请求就强制要带 gwk_ 前缀
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  API_KEY_HEADER_PREFIX,
  GatewayApiKeyService,
} from '../services/gateway-api-key.service';
import { ipInCidrList, normalizeIp } from '../utils/cidr-match.util';
import { resolveClientIp } from '../../security/client-ip.util';

const HEADER_NAME = 'x-gateway-api-key';

/** 在请求对象上挂的额外字段, 给下游审计 / promote 拿到 source 上下文用. */
export interface GatewayRequestContext {
  sourceId?: string;
  apiKeyId?: string;
  apiKeyPrefix?: string;
  remoteIp?: string;
}
declare module 'express-serve-static-core' {
  interface Request {
    gateway?: GatewayRequestContext;
  }
}

@Injectable()
export class GatewayApiKeyGuard implements CanActivate {
  private readonly logger = new Logger('GatewayApiKeyGuard');

  constructor(private readonly apiKeyService: GatewayApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const remoteIp = this.extractIp(req);

    // ── 1. Global IP allowlist (env-level) ─────────────────────────
    const globalAllowlist = this.parseGlobalAllowlist();
    if (globalAllowlist.length > 0) {
      if (!remoteIp) {
        this.logger.warn(
          `Rejecting request: global allowlist set but could not determine remote IP (${req.method} ${req.path})`,
        );
        throw new ForbiddenException('Remote IP could not be determined');
      }
      if (!ipInCidrList(remoteIp, globalAllowlist)) {
        this.logger.warn(
          `Rejecting request: remote IP ${remoteIp} not in GATEWAY_GLOBAL_IP_ALLOWLIST (${req.method} ${req.path})`,
        );
        throw new ForbiddenException(`Remote IP ${remoteIp} is not in the allowlist`);
      }
    }

    // ── 2. Header presence ─────────────────────────────────────────
    const received =
      (req.headers[HEADER_NAME] as string | undefined) ??
      (req.headers[HEADER_NAME.toUpperCase()] as string | undefined);
    if (!received || received.trim().length === 0) {
      throw new UnauthorizedException(
        `Missing ${HEADER_NAME} header for inbound gateway request`,
      );
    }
    const headerValue = received.trim();

    // ── 3. Per-source key (new mechanism) ──────────────────────────
    if (headerValue.startsWith(API_KEY_HEADER_PREFIX)) {
      const verified = await this.apiKeyService.verifyAndTrack(headerValue, {
        remoteIp: remoteIp ?? undefined,
      });
      if (!verified) {
        this.logger.warn(
          `Invalid per-source api key from ${remoteIp ?? 'unknown'} on ${req.method} ${req.path}`,
        );
        throw new UnauthorizedException('Invalid gateway api key');
      }
      // Per-key IP allowlist
      const keyAllowlist = verified.apiKey.ipAllowlist ?? [];
      if (keyAllowlist.length > 0) {
        if (!remoteIp) {
          throw new ForbiddenException('Remote IP could not be determined');
        }
        if (!ipInCidrList(remoteIp, keyAllowlist)) {
          this.logger.warn(
            `IP ${remoteIp} not in allowlist for api key ${verified.apiKey.prefix} (${req.method} ${req.path})`,
          );
          throw new ForbiddenException(
            `Remote IP ${remoteIp} is not in this api key's allowlist`,
          );
        }
      }
      // 写到请求上下文, 给下游审计 / promote / source-routing 用
      req.gateway = {
        sourceId: verified.sourceId,
        apiKeyId: verified.apiKey.id,
        apiKeyPrefix: verified.apiKey.prefix,
        remoteIp: remoteIp ?? undefined,
      };
      return true;
    }

    // ── 4. Legacy global key (dev fallback only) ──────────────────
    if (process.env.NODE_ENV === 'production') {
      throw new UnauthorizedException(
        'Legacy GATEWAY_API_KEY is not accepted in production — please issue a per-source key (gwk_*) via /gateway/admin/api-keys',
      );
    }
    const legacyExpected = process.env.GATEWAY_API_KEY;
    if (!legacyExpected || legacyExpected.trim().length === 0) {
      this.logger.error(
        'No per-source api key matched and GATEWAY_API_KEY env var is not set — fail-closed.',
      );
      throw new UnauthorizedException('Gateway api key is not configured on the server');
    }
    if (!constantTimeEqual(headerValue, legacyExpected.trim())) {
      this.logger.warn(
        `Invalid legacy gateway api key from ${remoteIp ?? 'unknown'} on ${req.method} ${req.path}`,
      );
      throw new UnauthorizedException('Invalid gateway api key');
    }
    req.gateway = { remoteIp: remoteIp ?? undefined };
    return true;
  }

  /* ----------------------------------------------------------------- */

  private extractIp(req: Request): string | null {
    return resolveClientIp(req as any).clientIp;
  }

  private parseGlobalAllowlist(): string[] {
    const raw = process.env.GATEWAY_GLOBAL_IP_ALLOWLIST;
    if (!raw) return [];
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
