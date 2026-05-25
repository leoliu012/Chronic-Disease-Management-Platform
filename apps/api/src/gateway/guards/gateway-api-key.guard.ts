/**
 * gateway-api-key.guard.ts
 *
 * 简单的 API-Key 校验，专门给入站网关接口（FHIR / HIS Event REST）用。
 *
 * 为什么不复用 JwtAuthGuard：
 *   - HIS / 集成平台 一般不会去医院的 Keycloak 拿 access_token，
 *     业界更常见的做法是给对方一个长期密钥 (X-Gateway-Api-Key)，
 *     在医院内网 + 双向 TLS 之外再加一层身份口令。
 *   - 这些接口在 controller 上用了 @Public() 跳过全局 JwtAuthGuard，
 *     再叠加本 guard 实现"对外部系统"维度的鉴权。
 *
 * Fail-closed:
 *   - 如果环境变量 GATEWAY_API_KEY 没设置，所有请求都会被拒绝，
 *     强制运维同学显式开启。
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

const HEADER_NAME = 'x-gateway-api-key';

@Injectable()
export class GatewayApiKeyGuard implements CanActivate {
  private readonly logger = new Logger('GatewayApiKeyGuard');

  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.GATEWAY_API_KEY;
    if (!expected || expected.trim().length === 0) {
      this.logger.error(
        'GATEWAY_API_KEY env var is not configured — refusing inbound gateway request (fail-closed).',
      );
      throw new UnauthorizedException(
        'Gateway API key is not configured on the server',
      );
    }

    const req = context.switchToHttp().getRequest<Request>();
    const received =
      (req.headers[HEADER_NAME] as string | undefined) ??
      (req.headers[HEADER_NAME.toUpperCase()] as string | undefined);

    if (!received || received.trim().length === 0) {
      throw new UnauthorizedException(
        `Missing ${HEADER_NAME} header for inbound gateway request`,
      );
    }

    if (!constantTimeEqual(received.trim(), expected.trim())) {
      this.logger.warn(
        `Invalid gateway api key received from ${req.ip ?? 'unknown'} on ${req.method} ${req.path}`,
      );
      throw new UnauthorizedException('Invalid gateway api key');
    }

    return true;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
