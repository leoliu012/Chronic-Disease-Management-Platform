/**
 * gateway-admin.controller.ts
 *
 * 给运维 / 管理员看的"网关健康度"接口：
 *
 *   GET  /gateway/admin/health            — HL7 listener + 中间表 poller 状态
 *   GET  /gateway/admin/recent-events     — 最近 N 条入站事件（来自 IntegrationSyncRecord）
 *   POST /gateway/admin/intermediate/poll-now  — 手动触发一次中间表轮询
 *
 * 这些接口走 JwtAuthGuard + RolesGuard，仅 ADMIN / MANAGER 可见，
 * 故意 不 @Public()。
 */

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../security/roles.decorator';
import { Hl7ListenerService } from '../services/hl7-listener.service';
import { InboundEventService } from '../services/inbound-event.service';
import { IntermediatePollerService } from '../services/intermediate-poller.service';

@Controller('gateway/admin')
@Roles(UserRole.ADMIN, UserRole.MANAGER)
export class GatewayAdminController {
  constructor(
    private readonly hl7: Hl7ListenerService,
    private readonly poller: IntermediatePollerService,
    private readonly inbound: InboundEventService,
  ) {}

  @Get('health')
  health() {
    return {
      checkedAt: new Date().toISOString(),
      channels: {
        fhirRest: {
          enabled: Boolean(process.env.GATEWAY_API_KEY),
          note: process.env.GATEWAY_API_KEY
            ? 'GATEWAY_API_KEY configured'
            : 'GATEWAY_API_KEY missing — REST endpoints will reject all requests (fail-closed)',
        },
        hisEventRest: {
          enabled: Boolean(process.env.GATEWAY_API_KEY),
        },
        hl7Mllp: this.hl7.getStatus(),
        intermediateDb: this.poller.getStatus(),
      },
    };
  }

  @Get('recent-events')
  async recentEvents(@Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : 50;
    const safe = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 50;
    const items = await this.inbound.getRecentEvents(safe);
    return { total: items.length, items };
  }

  @Post('intermediate/poll-now')
  @HttpCode(HttpStatus.OK)
  async pollNow() {
    const result = await this.poller.pollNow();
    return {
      status: 'OK',
      ...result,
    };
  }
}
