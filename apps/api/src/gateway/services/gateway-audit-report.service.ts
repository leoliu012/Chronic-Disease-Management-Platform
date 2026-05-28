/**
 * gateway-audit-report.service.ts
 *
 * gateway-production-hardening: 等保 / 三级等保 评审需要的审计报表.
 *
 * 不发明新表 — 全部基于:
 *   - IntegrationSyncRecord  (审计 + promote 流水)
 *   - GatewayApiKey          (每家医院使用情况, lastUsedAt / usageCount / lastUsedIp)
 *   - AuditLog               (操作人轨迹)
 *
 * 提供:
 *   - getOverview(): 时间窗内, 按 source 聚合的 accepted/promoted/conflict/failed/retry-exhausted 计数
 *   - getTopFailures(): 时间窗内 top N 个失败/冲突原因
 *   - getApiKeyUsage(): 每把 key 的最近使用情况 + IP, 用来证明 "权责对应"
 *   - exportCsv(): 把上面三块合成 CSV, 直接交评审材料
 */

import { Injectable } from '@nestjs/common';
import { IntegrationPromotionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditReportWindow {
  from: Date;
  to: Date;
  sourceId?: string;
}

@Injectable()
export class GatewayAuditReportService {
  constructor(private readonly prisma: PrismaService) {}

  /* ----------------------------------------------------------------- */
  /*  Time-window normalization                                         */
  /* ----------------------------------------------------------------- */

  resolveWindow(input: { from?: string; to?: string; sourceId?: string }): AuditReportWindow {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const from = input.from ? new Date(input.from) : defaultFrom;
    const to = input.to ? new Date(input.to) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new Error('Invalid from/to timestamp');
    }
    return { from, to, sourceId: input.sourceId };
  }

  /* ----------------------------------------------------------------- */
  /*  Overview (per-source counts)                                       */
  /* ----------------------------------------------------------------- */

  async getOverview(window: AuditReportWindow) {
    const baseWhere: Prisma.IntegrationSyncRecordWhereInput = {
      createdAt: { gte: window.from, lte: window.to },
      ...(window.sourceId ? { sourceId: window.sourceId } : {}),
    };

    const [bySource, totalByStatus, sources] = await Promise.all([
      this.prisma.integrationSyncRecord.groupBy({
        by: ['sourceId', 'promotionStatus'],
        _count: { _all: true },
        where: baseWhere,
      }),
      this.prisma.integrationSyncRecord.groupBy({
        by: ['promotionStatus'],
        _count: { _all: true },
        where: baseWhere,
      }),
      this.prisma.integrationSource.findMany({
        where: window.sourceId ? { id: window.sourceId } : undefined,
        orderBy: { code: 'asc' },
      }),
    ]);

    // 推进重试耗尽: promotionStatus=FAILED AND nextRetryAt IS NULL
    // AND promotionAttempts >= 1 (区分于一次都没跑过的)
    const retryExhausted = await this.prisma.integrationSyncRecord.findMany({
      where: {
        ...baseWhere,
        promotionStatus: IntegrationPromotionStatus.FAILED,
        nextRetryAt: null,
        promotionAttempts: { gte: 1 },
      },
      orderBy: { lastFailedAt: 'desc' },
      take: 20,
      include: { source: true },
    });

    const totals: Record<string, number> = {};
    for (const row of totalByStatus) {
      totals[row.promotionStatus] = row._count._all;
    }

    return {
      window: {
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        sourceId: window.sourceId ?? null,
      },
      totals,
      sources: sources.map((s) => {
        const counts: Record<string, number> = {};
        for (const row of bySource.filter((r) => r.sourceId === s.id)) {
          counts[row.promotionStatus] = row._count._all;
        }
        return {
          id: s.id,
          code: s.code,
          name: s.name,
          counts,
        };
      }),
      retryExhausted: retryExhausted.map((r) => ({
        recordId: r.id,
        sourceName: r.source?.name,
        sourceCode: r.source?.code,
        externalRecordType: r.externalRecordType,
        externalRecordId: r.externalRecordId,
        attempts: r.promotionAttempts,
        lastFailedAt: r.lastFailedAt?.toISOString() ?? null,
        lastFailureReason: r.lastFailureReason,
      })),
    };
  }

  /* ----------------------------------------------------------------- */
  /*  Top failure reasons                                                */
  /* ----------------------------------------------------------------- */

  async getTopFailures(window: AuditReportWindow, limit = 20) {
    const rows = await this.prisma.integrationSyncRecord.findMany({
      where: {
        createdAt: { gte: window.from, lte: window.to },
        ...(window.sourceId ? { sourceId: window.sourceId } : {}),
        promotionStatus: {
          in: [IntegrationPromotionStatus.FAILED, IntegrationPromotionStatus.CONFLICT],
        },
      },
      select: {
        promotionMessage: true,
        promotionStatus: true,
        lastFailureReason: true,
      },
      take: 5000, // hard cap so this stays bounded
    });

    // 形如 "[REASON] human-readable text" 抽取 REASON 标签作 bucket key
    const counts = new Map<string, { reason: string; count: number; status: string }>();
    for (const r of rows) {
      const message = r.lastFailureReason ?? r.promotionMessage ?? '';
      const m = /^\[([A-Z_]+)\]/.exec(message);
      const reason = m ? m[1] : 'UNCATEGORIZED';
      const key = `${r.promotionStatus}:${reason}`;
      const cur = counts.get(key);
      if (cur) cur.count += 1;
      else counts.set(key, { reason, count: 1, status: r.promotionStatus });
    }
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /* ----------------------------------------------------------------- */
  /*  Api key usage                                                      */
  /* ----------------------------------------------------------------- */

  async getApiKeyUsage(window: AuditReportWindow) {
    const keys = await this.prisma.gatewayApiKey.findMany({
      where: window.sourceId ? { sourceId: window.sourceId } : undefined,
      orderBy: [{ revokedAt: 'asc' }, { lastUsedAt: 'desc' }],
      include: { source: true },
    });
    return keys.map((k) => ({
      id: k.id,
      sourceCode: k.source?.code,
      sourceName: k.source?.name,
      prefix: k.prefix,
      description: k.description,
      ipAllowlist: k.ipAllowlist,
      usageCount: k.usageCount,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      lastUsedIp: k.lastUsedIp,
      revokedAt: k.revokedAt?.toISOString() ?? null,
      revokedReason: k.revokedReason,
      createdAt: k.createdAt.toISOString(),
      // 用在时间窗内还活跃过吗
      activeInWindow:
        !!k.lastUsedAt &&
        k.lastUsedAt >= window.from &&
        k.lastUsedAt <= window.to,
    }));
  }

  /* ----------------------------------------------------------------- */
  /*  CSV export                                                         */
  /* ----------------------------------------------------------------- */

  async exportCsv(window: AuditReportWindow): Promise<string> {
    const [overview, failures, keys] = await Promise.all([
      this.getOverview(window),
      this.getTopFailures(window),
      this.getApiKeyUsage(window),
    ]);

    const lines: string[] = [];
    lines.push('# Gateway 审计报表');
    lines.push(`# 时间窗: ${overview.window.from} ~ ${overview.window.to}`);
    lines.push(`# Source filter: ${overview.window.sourceId ?? '(全部)'}`);
    lines.push('');

    lines.push('## 一、按来源汇总');
    lines.push('source_code,source_name,PENDING,PROMOTED,CONFLICT,FAILED,NOT_REQUIRED');
    for (const s of overview.sources) {
      lines.push(
        [
          csv(s.code),
          csv(s.name),
          s.counts.PENDING ?? 0,
          s.counts.PROMOTED ?? 0,
          s.counts.CONFLICT ?? 0,
          s.counts.FAILED ?? 0,
          s.counts.NOT_REQUIRED ?? 0,
        ].join(','),
      );
    }
    lines.push('');

    lines.push('## 二、Top 失败 / 冲突原因');
    lines.push('promotion_status,reason,count');
    for (const f of failures) {
      lines.push([csv(f.status), csv(f.reason), f.count].join(','));
    }
    lines.push('');

    lines.push('## 三、API Key 使用情况');
    lines.push(
      'source_code,key_prefix,description,ip_allowlist,usage_count,last_used_at,last_used_ip,revoked_at,active_in_window',
    );
    for (const k of keys) {
      lines.push(
        [
          csv(k.sourceCode),
          csv(k.prefix),
          csv(k.description ?? ''),
          csv(k.ipAllowlist.join('|')),
          k.usageCount,
          csv(k.lastUsedAt ?? ''),
          csv(k.lastUsedIp ?? ''),
          csv(k.revokedAt ?? ''),
          k.activeInWindow ? 'YES' : 'NO',
        ].join(','),
      );
    }
    lines.push('');

    lines.push('## 四、推进重试耗尽的 record');
    lines.push('source_code,record_id,external_type,external_id,attempts,last_failed_at,reason');
    for (const r of overview.retryExhausted) {
      lines.push(
        [
          csv(r.sourceCode ?? ''),
          csv(r.recordId),
          csv(r.externalRecordType),
          csv(r.externalRecordId),
          r.attempts,
          csv(r.lastFailedAt ?? ''),
          csv(r.lastFailureReason ?? ''),
        ].join(','),
      );
    }
    lines.push('');
    return lines.join('\n');
  }
}

function csv(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
