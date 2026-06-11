/**
 * gateway-admin.controller.ts
 *
 * 给运维 / 管理员看的 "网关健康度 + 治理" 接口.
 *
 * 既有接口 (保持不变):
 *   GET  /gateway/admin/health                — HL7 listener + 中间表 poller 状态
 *   GET  /gateway/admin/recent-events         — 最近 N 条入站事件
 *   POST /gateway/admin/intermediate/poll-now — 手动触发一次中间表轮询
 *
 * gateway-production-hardening 新增 (per-system api key + 审计 + retry worker):
 *   POST   /gateway/admin/api-keys              — 为某个 IntegrationSource 签发新 key (明文仅返回一次)
 *   GET    /gateway/admin/api-keys              — 列出 (默认隐藏已吊销)
 *   DELETE /gateway/admin/api-keys/:id          — 吊销 key, 立刻生效
 *
 *   GET    /gateway/admin/audit-report          — 时间窗内 JSON 报表 (来源/失败原因/key使用情况/重试耗尽)
 *   GET    /gateway/admin/audit-report.csv      — 同样内容的 CSV, 直接交评审材料
 *
 *   GET    /gateway/admin/promotion-worker      — Retry worker 当前状态 + 上次运行结果
 *   POST   /gateway/admin/promotion-worker/run-now  — 不等下一轮 tick, 立刻扫一次
 *
 * 所有接口都走 JwtAuthGuard + RolesGuard, 仅 ADMIN / MANAGER 可见.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../security/current-user.decorator';
import { Audit } from '../../security/audit.decorator';
import type { RequestUser } from '../../security/request-user.type';
import { Roles } from '../../security/roles.decorator';
import {
  IssueApiKeyDto,
  ListApiKeysQueryDto,
  RevokeApiKeyDto,
} from '../dto/api-key.dto';
import { AuditReportQueryDto } from '../dto/audit-report-query.dto';
import { GatewayApiKeyService } from '../services/gateway-api-key.service';
import { GatewayAuditReportService } from '../services/gateway-audit-report.service';
import { GatewayPromotionWorkerService } from '../services/gateway-promotion-worker.service';
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
    private readonly apiKeys: GatewayApiKeyService,
    private readonly auditReport: GatewayAuditReportService,
    private readonly promotionWorker: GatewayPromotionWorkerService,
  ) {}

  /* ----------------------------------------------------------------- */
  /*  既有接口                                                          */
  /* ----------------------------------------------------------------- */

  @Get('health')
  async health() {
    const hasAnyKey = await this.apiKeys.hasAnyActiveKey();
    return {
      checkedAt: new Date().toISOString(),
      channels: {
        fhirRest: {
          enabled: hasAnyKey || Boolean(process.env.GATEWAY_API_KEY),
          note: hasAnyKey
            ? `${await this.countActiveKeys()} per-source GatewayApiKey row(s) active`
            : process.env.GATEWAY_API_KEY
              ? 'No per-source keys issued — falling back to legacy GATEWAY_API_KEY env (dev only).'
              : 'No per-source keys issued and no legacy GATEWAY_API_KEY — REST endpoints will reject all requests (fail-closed).',
        },
        hisEventRest: {
          enabled: hasAnyKey || Boolean(process.env.GATEWAY_API_KEY),
        },
        hl7Mllp: this.hl7.getStatus(),
        intermediateDb: this.poller.getStatus(),
        promotionWorker: this.promotionWorker.getStatus(),
        globalIpAllowlist: parseGlobalAllowlist(),
        alertWebhook: {
          configured: Boolean(process.env.GATEWAY_ALERT_WEBHOOK_URL),
        },
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

  @Audit({ mode: 'REQUIRED', action: 'RUN_GATEWAY_INTERMEDIATE_POLL', target: 'IntegrationSyncBatch' })
  @Post('intermediate/poll-now')
  @HttpCode(HttpStatus.OK)
  async pollNow() {
    const result = await this.poller.pollNow();
    return { status: 'OK', ...result };
  }

  /* ----------------------------------------------------------------- */
  /*  API Key 管理 (gateway-production-hardening)                       */
  /* ----------------------------------------------------------------- */

  @Audit({ mode: 'REQUIRED', action: 'ISSUE_GATEWAY_API_KEY', target: 'GatewayApiKey', targetIdFrom: 'response.id', detailsFrom: { sourceId: 'response.sourceId', prefix: 'response.prefix' } })
  @Post('api-keys')
  async issueApiKey(
    @Body() body: IssueApiKeyDto,
    @CurrentUser() user: RequestUser,
  ) {
    const issued = await this.apiKeys.issue({
      sourceId: body.sourceId,
      description: body.description,
      ipAllowlist: body.ipAllowlist,
      createdBy: user.id,
    });
    // 注意: fullKey 仅在此次返回, 绝不进 AuditLog
    return {
      id: issued.id,
      sourceId: issued.sourceId,
      prefix: issued.prefix,
      fullKey: issued.fullKey,
      description: issued.description,
      ipAllowlist: issued.ipAllowlist,
      createdAt: issued.createdAt,
      hint: 'Save fullKey now — it is shown only once. Use header X-Gateway-Api-Key.',
    };
  }

  @Get('api-keys')
  async listApiKeys(@Query() query: ListApiKeysQueryDto) {
    const keys = await this.apiKeys.list({
      sourceId: query.sourceId,
      includeRevoked: query.includeRevoked === true || String(query.includeRevoked) === 'true',
    });
    return {
      total: keys.length,
      items: keys.map((k) => ({
        id: k.id,
        sourceId: k.sourceId,
        sourceCode: k.source?.code,
        sourceName: k.source?.name,
        prefix: k.prefix,
        description: k.description,
        ipAllowlist: k.ipAllowlist,
        usageCount: k.usageCount,
        lastUsedAt: k.lastUsedAt,
        lastUsedIp: k.lastUsedIp,
        revokedAt: k.revokedAt,
        revokedBy: k.revokedBy,
        revokedReason: k.revokedReason,
        createdAt: k.createdAt,
        createdBy: k.createdBy,
      })),
    };
  }

  @Audit({ mode: 'REQUIRED', action: 'REVOKE_GATEWAY_API_KEY', target: 'GatewayApiKey', targetIdFrom: 'params.id', detailsFrom: { prefix: 'response.prefix' } })
  @Delete('api-keys/:id')
  async revokeApiKey(
    @Param('id') id: string,
    @Body() body: RevokeApiKeyDto,
    @CurrentUser() user: RequestUser,
  ) {
    const revoked = await this.apiKeys.revoke(id, {
      revokedBy: user.id,
      reason: body?.reason,
    });
    return {
      id: revoked.id,
      prefix: revoked.prefix,
      revokedAt: revoked.revokedAt,
      revokedReason: revoked.revokedReason,
    };
  }

  /* ----------------------------------------------------------------- */
  /*  审计报表 (gateway-production-hardening)                           */
  /* ----------------------------------------------------------------- */

  @Get('audit-report')
  async auditReportJson(@Query() query: AuditReportQueryDto) {
    const window = this.auditReport.resolveWindow(query);
    const [overview, topFailures, keyUsage] = await Promise.all([
      this.auditReport.getOverview(window),
      this.auditReport.getTopFailures(window),
      this.auditReport.getApiKeyUsage(window),
    ]);
    return { overview, topFailures, keyUsage };
  }

  @Audit({ mode: 'REQUIRED', action: 'EXPORT_GATEWAY_AUDIT_REPORT', target: 'IntegrationSyncRecord' })
  @Get('audit-report.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="gateway_audit_report.csv"',
  )
  async auditReportCsv(@Query() query: AuditReportQueryDto) {
    const window = this.auditReport.resolveWindow(query);
    return this.auditReport.exportCsv(window);
  }

  /* ----------------------------------------------------------------- */
  /*  Retry worker (gateway-production-hardening)                       */
  /* ----------------------------------------------------------------- */

  @Get('promotion-worker')
  workerStatus() {
    return this.promotionWorker.getStatus();
  }

  @Audit({ mode: 'REQUIRED', action: 'RUN_GATEWAY_PROMOTION_WORKER', target: 'IntegrationSyncRecord' })
  @Post('promotion-worker/run-now')
  @HttpCode(HttpStatus.OK)
  async workerRunNow() {
    const result = await this.promotionWorker.runOnce();
    return { status: 'OK', ...result };
  }

  /* ----------------------------------------------------------------- */

  private async countActiveKeys(): Promise<number> {
    const items = await this.apiKeys.list({ includeRevoked: false });
    return items.length;
  }
}

function parseGlobalAllowlist(): { configured: boolean; cidrs: string[] } {
  const raw = process.env.GATEWAY_GLOBAL_IP_ALLOWLIST;
  if (!raw) return { configured: false, cidrs: [] };
  const cidrs = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { configured: cidrs.length > 0, cidrs };
}

