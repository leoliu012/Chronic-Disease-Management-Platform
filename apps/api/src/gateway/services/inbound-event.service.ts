/**
 * inbound-event.service.ts
 *
 * 网关统一摄取层 — 所有通道（FHIR / HIS Event / HL7 / 中间表）
 * 解析后都把 NormalizedEvent 喂给 ingest()。
 *
 * 这一层只做两件事：
 *   1. 在已有的 IntegrationSyncBatch / IntegrationSyncRecord 表中留下完整审计
 *   2. 幂等检查：同一 (channel, eventId) 重复提交时直接返回 "duplicated"
 *
 * 接收到事件时把 IntegrationSyncRecord.promotionStatus 默认置为 PENDING
 * （旧的 IntegrationsService.mockSync* 仍写 NOT_REQUIRED，因为它直接落主表）。
 *
 * 如果该来源 IntegrationSource.autoPromote = true，写完审计后立刻同步调用
 * IntegrationPromoteService.promoteRecord()。否则就静静等管理员在【接口中心】
 * 点「入库」按钮。冲突永远不会污染主数据 — promote 内部全程 fail-safe。
 *
 * autoPromote 是 gateway-promote-pipeline 引入的扩展点；不打开时网关行为保持
 * 与之前完全一致，方便上线时灰度放量。
 */

import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import {
  IntegrationPromotionStatus,
  IntegrationRecordStatus,
  IntegrationSyncStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GATEWAY_SOURCE_CODE, GatewayChannel } from '../gateway.constants';
import { NormalizedEvent } from '../interfaces/normalized-event.interface';
import { GatewaySourceRegistryService } from './gateway-source-registry.service';
import { IntegrationPromoteService } from './integration-promote.service';

export interface IngestResult {
  status: 'ACCEPTED' | 'DUPLICATED' | 'FAILED';
  batchId: string;
  recordId: string;
  message?: string;
  /** 当 autoPromote 命中并执行完后，回带 promote 结果，便于客户端立刻看到风险预警 */
  promote?: {
    outcome: string;
    localTargetType?: string;
    localTargetId?: string;
    message?: string;
    generatedRiskAlertId?: string;
    generatedTaskId?: string;
  };
}

export interface BulkIngestResult {
  batchId: string;
  total: number;
  accepted: number;
  duplicated: number;
  failed: number;
  records: IngestResult[];
}

@Injectable()
export class InboundEventService {
  private readonly logger = new Logger('GatewayInboundEvent');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sourceRegistry: GatewaySourceRegistryService,
    /**
     * 与 IntegrationPromoteService 之间是单向依赖（promote 也只回读
     * IntegrationSyncRecord），但 Nest 在某些启动顺序下仍可能把它判为环，
     * 用 forwardRef 留个保险。
     */
    @Inject(forwardRef(() => IntegrationPromoteService))
    private readonly promoter: IntegrationPromoteService,
  ) {}

  /**
   * 摄取单条 NormalizedEvent。
   * 内部会自动起一个 batchSize=1 的批次（适合实时推送场景：REST / HL7）。
   */
  async ingestSingle(event: NormalizedEvent): Promise<IngestResult> {
    const source = await this.sourceRegistry.getSourceForChannel(event.channel);
    const batch = await this.prisma.integrationSyncBatch.create({
      data: {
        sourceId: source.id,
        batchType: event.channel,
        status: IntegrationSyncStatus.RUNNING,
        startedAt: new Date(),
      },
    });
    const result = await this.writeRecord(source.id, batch.id, event);

    // gateway-promote-pipeline: 如果该来源开启了自动 promote 且本条接收成功，立刻推进
    if (
      source.autoPromote &&
      result.status === 'ACCEPTED' &&
      result.recordId
    ) {
      try {
        const promoteResult = await this.promoter.promoteRecord(result.recordId);
        result.promote = {
          outcome: promoteResult.outcome,
          localTargetType: promoteResult.localTargetType,
          localTargetId: promoteResult.localTargetId,
          message: promoteResult.message,
          generatedRiskAlertId: promoteResult.generatedRiskAlertId,
          generatedTaskId: promoteResult.generatedTaskId,
        };
      } catch (err) {
        // 不能让 autoPromote 把审计写入也炸掉 — 审计已经成功
        this.logger.warn(
          `autoPromote failed for record ${result.recordId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await this.finalizeBatch(batch.id, [result]);
    return result;
  }

  /**
   * 摄取一批 NormalizedEvent，所有事件归入同一个批次（适合 Cron / Bundle）。
   */
  async ingestBatch(
    channel: GatewayChannel,
    events: NormalizedEvent[],
    options?: { batchType?: string },
  ): Promise<BulkIngestResult> {
    const source = await this.sourceRegistry.getSourceForChannel(channel);
    const batch = await this.prisma.integrationSyncBatch.create({
      data: {
        sourceId: source.id,
        batchType: options?.batchType ?? channel,
        status: IntegrationSyncStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    const results: IngestResult[] = [];
    for (const ev of events) {
      const r = await this.writeRecord(source.id, batch.id, ev);
      if (source.autoPromote && r.status === 'ACCEPTED' && r.recordId) {
        try {
          const promoteResult = await this.promoter.promoteRecord(r.recordId);
          r.promote = {
            outcome: promoteResult.outcome,
            localTargetType: promoteResult.localTargetType,
            localTargetId: promoteResult.localTargetId,
            message: promoteResult.message,
            generatedRiskAlertId: promoteResult.generatedRiskAlertId,
            generatedTaskId: promoteResult.generatedTaskId,
          };
        } catch (err) {
          this.logger.warn(
            `autoPromote failed for record ${r.recordId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      results.push(r);
    }
    await this.finalizeBatch(batch.id, results);

    const counts = results.reduce(
      (acc, r) => {
        if (r.status === 'ACCEPTED') acc.accepted += 1;
        else if (r.status === 'DUPLICATED') acc.duplicated += 1;
        else acc.failed += 1;
        return acc;
      },
      { accepted: 0, duplicated: 0, failed: 0 },
    );

    return {
      batchId: batch.id,
      total: results.length,
      accepted: counts.accepted,
      duplicated: counts.duplicated,
      failed: counts.failed,
      records: results,
    };
  }

  /* ------------------------------------------------------------------------ */

  private externalVersion(event: NormalizedEvent): string {
    const version = String(event.externalVersion ?? 'v1').trim();
    return version || 'v1';
  }

  private idempotencyKey(sourceId: string, event: NormalizedEvent): string {
    return [sourceId, event.resourceType, event.eventId, this.externalVersion(event)].join('\u001f');
  }

  private async recordSkippedDuplicate(
    sourceId: string,
    batchId: string,
    event: NormalizedEvent,
    existingId: string,
  ): Promise<IngestResult> {
    const skipped = await this.prisma.integrationSyncRecord.create({
      data: {
        sourceId,
        batchId,
        externalRecordType: event.resourceType,
        externalRecordId: event.eventId,
        externalVersion: this.externalVersion(event),
        status: IntegrationRecordStatus.SKIPPED,
        errorMessage: `Duplicate of record ${existingId}`,
        rawData: this.toJson(event.rawPayload),
        normalizedData: this.toJson(event.normalizedPayload),
        promotionStatus: IntegrationPromotionStatus.NOT_REQUIRED,
        promotionMessage: '审计层已存在等价事件，不再 promote。',
      },
    });
    return {
      status: 'DUPLICATED',
      batchId,
      recordId: skipped.id,
      message: '相同 eventId 与 externalVersion 已存在，已跳过',
    };
  }

  private async writeRecord(
    sourceId: string,
    batchId: string,
    event: NormalizedEvent,
  ): Promise<IngestResult> {
    const idempotencyKey = this.idempotencyKey(sourceId, event);
    const externalVersion = this.externalVersion(event);
    const existing = await this.prisma.integrationSyncRecord.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      this.logger.debug(
        `Duplicate event ignored: channel=${event.channel} resource=${event.resourceType} id=${event.eventId} version=${externalVersion}`,
      );
      return this.recordSkippedDuplicate(sourceId, batchId, event, existing.id);
    }

    try {
      const created = await this.prisma.integrationSyncRecord.create({
        data: {
          sourceId,
          batchId,
          externalRecordType: event.resourceType,
          externalRecordId: event.eventId,
          externalVersion,
          idempotencyKey,
          status: IntegrationRecordStatus.SUCCESS,
          rawData: this.toJson(event.rawPayload),
          normalizedData: this.toJson({
            channel: event.channel,
            triggerEvent: event.triggerEvent,
            externalVersion,
            patient: event.patient,
            payload: event.normalizedPayload,
            receivedAt: event.receivedAt.toISOString(),
          }),
          promotionStatus: IntegrationPromotionStatus.PENDING,
          promotionMessage: '已接收，等待 promote 到主数据。',
        },
      });

      this.logger.log(
        `Ingested ${event.channel} ${event.resourceType} ${event.eventId}@${externalVersion} → record ${created.id}`,
      );
      return { status: 'ACCEPTED', batchId, recordId: created.id };
    } catch (err) {
      // A competing request may have won after our optimistic read. The unique
      // canonical key converts the race into a deterministic SKIPPED audit row.
      if ((err as { code?: string })?.code === 'P2002') {
        const winner = await this.prisma.integrationSyncRecord.findUnique({
          where: { idempotencyKey },
          select: { id: true },
        });
        if (winner) return this.recordSkippedDuplicate(sourceId, batchId, event, winner.id);
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to persist event ${event.channel}/${event.eventId}@${externalVersion}: ${errorMessage}`,
      );
      const failed = await this.prisma.integrationSyncRecord.create({
        data: {
          sourceId,
          batchId,
          externalRecordType: event.resourceType,
          externalRecordId: event.eventId,
          externalVersion,
          status: IntegrationRecordStatus.FAILED,
          errorMessage,
          rawData: this.toJson(event.rawPayload),
          promotionStatus: IntegrationPromotionStatus.NOT_REQUIRED,
        },
      });
      return { status: 'FAILED', batchId, recordId: failed.id, message: errorMessage };
    }
  }

  private async finalizeBatch(batchId: string, results: IngestResult[]): Promise<void> {
    const total = results.length;
    const successCount = results.filter((r) => r.status === 'ACCEPTED' || r.status === 'DUPLICATED').length;
    const failedCount = results.filter((r) => r.status === 'FAILED').length;
    const status =
      failedCount === 0
        ? IntegrationSyncStatus.SUCCESS
        : successCount === 0
          ? IntegrationSyncStatus.FAILED
          : IntegrationSyncStatus.PARTIAL_FAILED;

    await this.prisma.integrationSyncBatch.update({
      where: { id: batchId },
      data: {
        status,
        totalCount: total,
        successCount,
        failedCount,
        finishedAt: new Date(),
        message: `网关同步完成：接收 ${total} 条，成功 ${successCount} 条，失败 ${failedCount} 条。`,
      },
    });
  }

  private toJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) return undefined;
    try {
      // 经过一次 JSON 往返避免 Date / undefined 让 Prisma 报错
      return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    } catch {
      return { _serializeError: 'Could not serialize raw payload' } as Prisma.InputJsonValue;
    }
  }

  /* ------------------------------------------------------------------------ */
  /*  查询接口（admin 用）                                                     */
  /* ------------------------------------------------------------------------ */

  /**
   * 最近若干条网关事件（跨四个通道）。供 GatewayAdminController 暴露给前端。
   */
  async getRecentEvents(limit = 50) {
    const sourceCodes = Object.values(GATEWAY_SOURCE_CODE);
    return this.prisma.integrationSyncRecord.findMany({
      where: {
        source: {
          code: { in: sourceCodes as unknown as string[] },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { source: true, batch: true },
    });
  }
}
