/**
 * gateway-promotion-worker.service.ts
 *
 * gateway-production-hardening: GATEWAY_PROMOTION_WORKER_ENABLED 真正接上.
 *
 * 在医院网关环境里, 网络抖动 / 老 HIS 半夜重启 / Prisma 连接池被打满
 * 都会让 IntegrationPromoteService 短暂失败. 没有重试的话, 这些 record
 * 就永远卡在 promotionStatus = FAILED 里, 运维只能手动逐条点击重试.
 *
 * 这个 worker 做的事:
 *   1. 定时扫描 promotionStatus = FAILED AND nextRetryAt <= now
 *      AND promotionAttempts < maxAttempts 的记录
 *   2. 调 IntegrationPromoteService.promoteRecord() 重新尝试
 *   3. 失败再次失败 -> 加 attempts, 按指数退避算下次 nextRetryAt
 *      (60s, 120s, 240s, ... cap 在 60min)
 *   4. attempts 达到 maxAttempts 后, 把 nextRetryAt 清空,
 *      并通过 GatewayAlertService 发告警 (RETRY_EXHAUSTED)
 *
 * 设计:
 *   - setInterval (复用 IntermediatePollerService 的同款模式), 不引 @nestjs/schedule
 *   - 单实例锁 (inFlight 标志) 避免上一轮没跑完时启动下一轮
 *   - 每轮 batch size 限制为 50, 避免一波突刺把 DB 压满
 *   - 不阻塞 Promote 的同步路径: 仅当 promote 失败时, integration-promote
 *     会顺手填上 retry 元数据; worker 只负责"扫"和"再试"
 *
 * 关掉:
 *   - GATEWAY_PROMOTION_WORKER_ENABLED 非 'true' 时整体不启动 (默认关)
 */

import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  forwardRef,
} from '@nestjs/common';
import { IntegrationPromotionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GatewayAlertService } from './gateway-alert.service';
import { IntegrationPromoteService } from './integration-promote.service';

const DEFAULT_INTERVAL_MS = 60 * 1000; // 1 min
const DEFAULT_MAX_ATTEMPTS = 6; // 1+2+4+8+16+32 = 63 min total exposure
const DEFAULT_BATCH = 50;
const MAX_BACKOFF_MS = 60 * 60 * 1000; // 1 hr cap

@Injectable()
export class GatewayPromotionWorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('GatewayPromotionWorker');
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private lastRunAt: Date | null = null;
  private lastRunSummary: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => IntegrationPromoteService))
    private readonly promoter: IntegrationPromoteService,
    private readonly alerts: GatewayAlertService,
  ) {}

  /* ----------------------------------------------------------------- */

  onApplicationBootstrap() {
    if (process.env.GATEWAY_PROMOTION_WORKER_ENABLED !== 'true') {
      this.logger.log(
        'Promotion worker disabled (set GATEWAY_PROMOTION_WORKER_ENABLED=true to enable).',
      );
      return;
    }
    const interval = Number(
      process.env.GATEWAY_PROMOTION_WORKER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
    );
    // 启动延迟 10s, 避免和模块初始化竞争
    setTimeout(() => {
      this.tick().catch((err) => this.logger.error(`Initial tick failed: ${err.message}`));
      this.timer = setInterval(() => {
        this.tick().catch((err) => this.logger.error(`Scheduled tick failed: ${err.message}`));
      }, interval);
    }, 10_000);
    this.logger.log(
      `Promotion worker scheduled (interval=${interval}ms, maxAttempts=${this.maxAttempts}, batch=${this.batchSize}).`,
    );
  }

  async onApplicationShutdown() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /* ----------------------------------------------------------------- */

  getStatus() {
    return {
      enabled: process.env.GATEWAY_PROMOTION_WORKER_ENABLED === 'true',
      running: this.timer !== null,
      inFlight: this.inFlight,
      intervalMs: Number(
        process.env.GATEWAY_PROMOTION_WORKER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
      ),
      maxAttempts: this.maxAttempts,
      batchSize: this.batchSize,
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      lastRunSummary: this.lastRunSummary,
    };
  }

  /** 手动触发一次扫描, 给运维用. */
  async runOnce(): Promise<{ scanned: number; retried: number; exhausted: number }> {
    return this.tick();
  }

  /* ----------------------------------------------------------------- */

  private get maxAttempts(): number {
    const v = Number(process.env.GATEWAY_PROMOTION_WORKER_MAX_ATTEMPTS);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_ATTEMPTS;
  }
  private get batchSize(): number {
    const v = Number(process.env.GATEWAY_PROMOTION_WORKER_BATCH);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_BATCH;
  }

  private async tick(): Promise<{ scanned: number; retried: number; exhausted: number }> {
    if (this.inFlight) {
      this.logger.debug('Skipping tick: previous run still in flight.');
      return { scanned: 0, retried: 0, exhausted: 0 };
    }
    this.inFlight = true;
    this.lastRunAt = new Date();
    let retried = 0;
    let exhausted = 0;

    try {
      const now = new Date();
      const records = await this.prisma.integrationSyncRecord.findMany({
        where: {
          promotionStatus: IntegrationPromotionStatus.FAILED,
          // nextRetryAt is NULL 表示"已被标记为耗尽"或"还未排过重试" —
          // 已耗尽的不要再扫. 这里我们排除 nextRetryAt=null.
          nextRetryAt: { lte: now, not: null },
          promotionAttempts: { lt: this.maxAttempts },
        },
        orderBy: { nextRetryAt: 'asc' },
        take: this.batchSize,
        include: { source: true },
      });

      for (const record of records) {
        const result = await this.promoter.promoteRecord(record.id);
        if (result.outcome === 'PROMOTED' || result.outcome === 'ALREADY_PROMOTED') {
          // 成功 — IntegrationPromoteService 自己在成功路径上把 retry metadata 清零
          retried += 1;
          continue;
        }
        if (result.outcome === 'CONFLICT') {
          // 冲突已经移到 CONFLICT 队列, 不再属于 retry 范围
          retried += 1;
          continue;
        }
        // 仍然 FAILED — 走退避或耗尽
        const wasExhausted = await this.scheduleNextRetryOrExhaust(record.id, record.promotionAttempts);
        retried += 1;
        if (wasExhausted) {
          exhausted += 1;
          await this.alerts.emit(
            {
              kind: 'RETRY_EXHAUSTED',
              severity: 'error',
              title: `Gateway promote 重试耗尽: ${record.externalRecordType}`,
              summary:
                `record=${record.id} source=${record.source?.code ?? '-'} ` +
                `attempts=${record.promotionAttempts + 1}/${this.maxAttempts} ` +
                `lastError=${truncate(result.message ?? '', 200)}`,
              context: {
                recordId: record.id,
                sourceCode: record.source?.code,
                externalRecordType: record.externalRecordType,
                externalRecordId: record.externalRecordId,
                attempts: record.promotionAttempts + 1,
                lastError: result.message,
              },
            },
            `RETRY_EXHAUSTED:${record.id}`,
          );
        }
      }

      this.lastRunSummary = `scanned=${records.length} retried=${retried} exhausted=${exhausted}`;
      if (records.length > 0) {
        this.logger.log(`tick done — ${this.lastRunSummary}`);
      }
      return { scanned: records.length, retried, exhausted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`tick failed: ${message}`);
      this.lastRunSummary = `error: ${message}`;
      return { scanned: 0, retried, exhausted };
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * 失败之后排下次重试. 如果 attempts+1 已达上限, 把 nextRetryAt 清空表示
   * "耗尽, 不再自动重试" 并返回 true.
   */
  private async scheduleNextRetryOrExhaust(
    recordId: string,
    currentAttempts: number,
  ): Promise<boolean> {
    const nextAttempts = currentAttempts + 1;
    if (nextAttempts >= this.maxAttempts) {
      await this.prisma.integrationSyncRecord.update({
        where: { id: recordId },
        data: {
          promotionAttempts: nextAttempts,
          nextRetryAt: null,
          lastFailedAt: new Date(),
        },
      });
      return true;
    }
    // 指数退避: 60s * 2^(attempts-1), cap 在 1h
    const backoffMs = Math.min(60_000 * Math.pow(2, currentAttempts), MAX_BACKOFF_MS);
    const next = new Date(Date.now() + backoffMs);
    await this.prisma.integrationSyncRecord.update({
      where: { id: recordId },
      data: {
        promotionAttempts: nextAttempts,
        nextRetryAt: next,
        lastFailedAt: new Date(),
      },
    });
    return false;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/**
 * 给 IntegrationPromoteService 用的辅助 — promote 失败后立刻让该 record
 * 进入"待重试"状态 (attempts=1, nextRetryAt=now+60s, lastFailureReason).
 *
 * 放在这里而不是 IntegrationPromoteService 内, 是为了让 worker 和 promote
 * 共享 "首次失败" 的语义.
 */
export async function markRecordForRetry(
  prisma: PrismaService,
  recordId: string,
  errorMessage: string,
): Promise<void> {
  const existing = await prisma.integrationSyncRecord.findUnique({
    where: { id: recordId },
    select: { promotionAttempts: true },
  });
  const attempts = existing?.promotionAttempts ?? 0;
  await prisma.integrationSyncRecord.update({
    where: { id: recordId },
    data: {
      // 首次失败 attempts=1, nextRetryAt=60s 后. worker 会接管后续退避.
      promotionAttempts: attempts === 0 ? 1 : attempts,
      nextRetryAt: attempts === 0 ? new Date(Date.now() + 60_000) : undefined,
      lastFailedAt: new Date(),
      lastFailureReason: errorMessage.slice(0, 1000),
    } satisfies Prisma.IntegrationSyncRecordUpdateInput,
  });
}
