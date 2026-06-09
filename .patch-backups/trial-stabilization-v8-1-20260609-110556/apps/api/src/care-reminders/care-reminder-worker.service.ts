import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { PrismaService } from '../prisma/prisma.service';
import { FormLinkService } from '../patient-engagement/form-link.service';
import { HospitalWechatOfficialAccountService } from '../patient-engagement/hospital-wechat-account.service';
import { OutboundMessageService } from '../patient-engagement/outbound-message.service';
import { WechatOfficialAccountService } from '../patient-engagement/wechat-official-account.service';
import { CareReminderOccurrenceService } from './care-reminder-occurrence.service';
import { CareReminderScheduleService } from './care-reminder-schedule.service';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_HORIZON_DAYS = 3;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 20 * 1000;
const DEFAULT_HEARTBEAT_STALE_AFTER_MS = 90 * 1000;
const DEFAULT_STUCK_SENDING_AFTER_MS = 15 * 60 * 1000;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETRY_BASE_MS = 60 * 1000;
const DEFAULT_RETRY_MAX_MS = 30 * 60 * 1000;
const DEFAULT_LOCK_HOLD_TIMEOUT_MS = 15 * 60 * 1000;
const WORKER_ADVISORY_LOCK_KEY = 739_224_891;

export type CareReminderWorkerSummary = {
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED_LOCKED' | 'SKIPPED_IN_FLIGHT';
  generated: number;
  dispatched: number;
  dispatchFailed: number;
  retried: number;
  retryScheduled: number;
  recoveredStuck: number;
  recoveredAsSent: number;
  missed: number;
  escalated: number;
  error?: string;
};

type DispatchResult = {
  dispatched: number;
  failed: number;
  retried: number;
  retryScheduled: number;
};

type RecoveryResult = {
  recoveredStuck: number;
  recoveredAsSent: number;
  retryScheduled: number;
};

/**
 * CareReminderWorkerService
 * -------------------------
 * Trial-ready reliability layer for the existing setInterval worker.
 *
 * This remains intentionally smaller than a durable queue architecture:
 *  - each round is protected by a PostgreSQL transaction advisory lock;
 *  - every replica publishes a persisted heartbeat;
 *  - every round writes durable metrics;
 *  - old SENDING rows recover after a crashed process;
 *  - failures retry with exponential backoff, then require admin replay.
 *
 * Formal provider-side exactly-once delivery still requires the planned
 * transactional outbox + BullMQ evolution. This layer prevents concurrent Nest
 * replicas from actively dispatching the same occurrence and narrows the crash
 * ambiguity window by persisting canonical artifacts before transport calls.
 */
@Injectable()
export class CareReminderWorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('CareReminderWorker');
  private readonly instanceId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private activeRunId: string | null = null;
  private lastRunAt: Date | null = null;
  private lastRunSummary: CareReminderWorkerSummary | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedules: CareReminderScheduleService,
    private readonly occurrences: CareReminderOccurrenceService,
    private readonly formLink: FormLinkService,
    private readonly outbound: OutboundMessageService,
    private readonly wechat: WechatOfficialAccountService,
    private readonly accounts: HospitalWechatOfficialAccountService,
  ) {}

  // ---------------------------------------------------------------------------
  // lifecycle + heartbeat
  // ---------------------------------------------------------------------------

  onApplicationBootstrap() {
    if (!this.enabled()) {
      this.logger.log(
        'Care-reminder worker disabled (set CARE_REMINDER_WORKER_ENABLED=true to enable).',
      );
      return;
    }

    void this.touchHeartbeat({ startup: true });
    this.heartbeatTimer = setInterval(() => {
      void this.touchHeartbeat().catch((e) =>
        this.logger.error(`heartbeat failed: ${(e as Error).message}`),
      );
    }, this.heartbeatIntervalMs());

    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.runOnce().catch((e) =>
        this.logger.error(`initial pass failed: ${(e as Error).message}`),
      );
      this.timer = setInterval(() => {
        void this.runOnce().catch((e) =>
          this.logger.error(`scheduled pass failed: ${(e as Error).message}`),
        );
      }, this.intervalMs());
    }, 5_000);

    this.logger.log(
      `Care-reminder worker ${this.instanceId} scheduled every ${this.intervalMs()}ms; ` +
        `heartbeat every ${this.heartbeatIntervalMs()}ms.`,
    );
  }

  async onApplicationShutdown() {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.timer) clearInterval(this.timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.initialTimer = null;
    this.timer = null;
    this.heartbeatTimer = null;
    if (this.enabled()) {
      try {
        await this.prisma.careReminderWorkerHeartbeat.updateMany({
          where: { instanceId: this.instanceId },
          data: { stoppedAt: new Date(), heartbeatAt: new Date() },
        });
      } catch (e) {
        this.logger.warn(`failed to persist worker shutdown heartbeat: ${(e as Error).message}`);
      }
    }
  }

  private enabled() {
    return process.env.CARE_REMINDER_WORKER_ENABLED === 'true';
  }

  private numberEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name] ?? fallback);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private intervalMs() {
    return this.numberEnv('CARE_REMINDER_WORKER_INTERVAL_MS', DEFAULT_INTERVAL_MS);
  }

  private heartbeatIntervalMs() {
    return this.numberEnv('CARE_REMINDER_WORKER_HEARTBEAT_INTERVAL_MS', DEFAULT_HEARTBEAT_INTERVAL_MS);
  }

  private heartbeatStaleAfterMs() {
    return this.numberEnv('CARE_REMINDER_WORKER_HEARTBEAT_STALE_AFTER_MS', DEFAULT_HEARTBEAT_STALE_AFTER_MS);
  }

  private stuckSendingAfterMs() {
    return this.numberEnv('CARE_REMINDER_WORKER_STUCK_SENDING_AFTER_MS', DEFAULT_STUCK_SENDING_AFTER_MS);
  }

  private maxRetries() {
    return Math.floor(this.numberEnv('CARE_REMINDER_WORKER_MAX_RETRIES', DEFAULT_MAX_RETRIES));
  }

  private retryBaseMs() {
    return this.numberEnv('CARE_REMINDER_WORKER_RETRY_BASE_MS', DEFAULT_RETRY_BASE_MS);
  }

  private retryMaxMs() {
    return this.numberEnv('CARE_REMINDER_WORKER_RETRY_MAX_MS', DEFAULT_RETRY_MAX_MS);
  }

  private lockHoldTimeoutMs() {
    return this.numberEnv('CARE_REMINDER_WORKER_LOCK_HOLD_TIMEOUT_MS', DEFAULT_LOCK_HOLD_TIMEOUT_MS);
  }

  private retryOptions(now?: Date) {
    return {
      maxRetries: this.maxRetries(),
      baseBackoffMs: this.retryBaseMs(),
      maxBackoffMs: this.retryMaxMs(),
      ...(now ? { now } : {}),
    };
  }

  private async touchHeartbeat(options?: { startup?: boolean }) {
    const now = new Date();
    await this.prisma.careReminderWorkerHeartbeat.upsert({
      where: { instanceId: this.instanceId },
      create: {
        instanceId: this.instanceId,
        startedAt: now,
        heartbeatAt: now,
        stoppedAt: null,
      },
      update: {
        heartbeatAt: now,
        stoppedAt: options?.startup ? null : undefined,
      },
    });
    if (this.activeRunId) {
      await this.prisma.careReminderWorkerRun.updateMany({
        where: { id: this.activeRunId, status: 'RUNNING' },
        data: { heartbeatAt: now },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // status / persisted observability
  // ---------------------------------------------------------------------------

  async getStatus() {
    const now = new Date();
    const heartbeatCutoff = new Date(now.getTime() - this.heartbeatStaleAfterMs());
    const stuckCutoff = new Date(now.getTime() - this.stuckSendingAfterMs());
    const [instances, recentRuns, latestSuccessfulRun, statusGroups, retryScheduled, stuckSending] =
      await Promise.all([
        this.prisma.careReminderWorkerHeartbeat.findMany({
          orderBy: { heartbeatAt: 'desc' },
          take: 25,
        }),
        this.prisma.careReminderWorkerRun.findMany({
          orderBy: { startedAt: 'desc' },
          take: 20,
        }),
        this.prisma.careReminderWorkerRun.findFirst({
          where: { status: 'SUCCEEDED' },
          orderBy: { finishedAt: 'desc' },
        }),
        this.prisma.careReminderOccurrence.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.careReminderOccurrence.count({
          where: { status: 'PENDING', nextRetryAt: { gt: now } },
        }),
        this.prisma.careReminderOccurrence.count({
          where: {
            status: 'SENDING',
            OR: [
              { sendingStartedAt: { lt: stuckCutoff } },
              { sendingStartedAt: null, updatedAt: { lt: stuckCutoff } },
            ],
          },
        }),
      ]);

    const backlogByStatus = Object.fromEntries(
      statusGroups.map((row) => [row.status, row._count._all]),
    );

    return {
      enabled: this.enabled(),
      instanceId: this.instanceId,
      running: this.timer !== null || this.initialTimer !== null,
      inFlight: this.inFlight,
      intervalMs: this.intervalMs(),
      heartbeatIntervalMs: this.heartbeatIntervalMs(),
      heartbeatStaleAfterMs: this.heartbeatStaleAfterMs(),
      stuckSendingAfterMs: this.stuckSendingAfterMs(),
      maxRetries: this.maxRetries(),
      retryBaseMs: this.retryBaseMs(),
      retryMaxMs: this.retryMaxMs(),
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      lastRunSummary: this.lastRunSummary,
      latestSuccessfulRunAt: latestSuccessfulRun?.finishedAt?.toISOString() ?? null,
      latestSuccessfulRun,
      backlog: {
        byStatus: backlogByStatus,
        retryScheduled,
        stuckSending,
      },
      instances: instances.map((instance) => ({
        ...instance,
        heartbeatInterrupted:
          instance.stoppedAt == null && instance.heartbeatAt.getTime() < heartbeatCutoff.getTime(),
        active:
          instance.stoppedAt == null && instance.heartbeatAt.getTime() >= heartbeatCutoff.getTime(),
      })),
      recentRuns,
    };
  }

  // ---------------------------------------------------------------------------
  // runOnce — PG advisory lock + durable run metrics
  // ---------------------------------------------------------------------------

  async runOnce(): Promise<CareReminderWorkerSummary> {
    if (this.inFlight) {
      this.logger.warn('previous pass still in flight on this instance; skipping this tick.');
      return this.recordSkippedRun('SKIPPED_IN_FLIGHT', 'previous local pass still running');
    }

    this.inFlight = true;
    try {
      return await this.prisma.$transaction(
        async (lockTx) => {
          const lockRows = await lockTx.$queryRaw<Array<{ acquired: boolean }>>`
            SELECT pg_try_advisory_xact_lock(${WORKER_ADVISORY_LOCK_KEY}) AS acquired
          `;
          if (!lockRows[0]?.acquired) {
            this.logger.log('another API instance owns the care-reminder advisory lock; skipping tick.');
            return this.recordSkippedRun('SKIPPED_LOCKED', 'advisory lock held by another instance');
          }
          return this.executeLeaderRound();
        },
        {
          maxWait: 5_000,
          timeout: this.lockHoldTimeoutMs(),
        },
      );
    } catch (e) {
      const message = (e as Error).message;
      this.logger.error(`worker advisory-lock round failed: ${message}`);
      return this.recordInfrastructureFailure(message);
    } finally {
      this.inFlight = false;
    }
  }

  private emptySummary(
    status: CareReminderWorkerSummary['status'],
    error?: string,
  ): CareReminderWorkerSummary {
    return {
      status,
      generated: 0,
      dispatched: 0,
      dispatchFailed: 0,
      retried: 0,
      retryScheduled: 0,
      recoveredStuck: 0,
      recoveredAsSent: 0,
      missed: 0,
      escalated: 0,
      ...(error ? { error } : {}),
    };
  }

  private async recordSkippedRun(
    status: 'SKIPPED_LOCKED' | 'SKIPPED_IN_FLIGHT',
    reason: string,
  ): Promise<CareReminderWorkerSummary> {
    const now = new Date();
    const summary = this.emptySummary(status, reason);
    try {
      await this.prisma.careReminderWorkerRun.create({
        data: {
          instanceId: this.instanceId,
          status,
          startedAt: now,
          finishedAt: now,
          error: reason,
        },
      });
      await this.touchHeartbeat();
    } catch (e) {
      this.logger.warn(`failed to persist skipped run: ${(e as Error).message}`);
    }
    this.lastRunAt = now;
    this.lastRunSummary = summary;
    return summary;
  }

  private async recordInfrastructureFailure(error: string): Promise<CareReminderWorkerSummary> {
    const now = new Date();
    const summary = this.emptySummary('FAILED', error);
    try {
      await this.prisma.careReminderWorkerRun.create({
        data: {
          instanceId: this.instanceId,
          status: 'FAILED',
          startedAt: now,
          finishedAt: now,
          error: error.slice(0, 1000),
        },
      });
      await this.prisma.careReminderWorkerHeartbeat.upsert({
        where: { instanceId: this.instanceId },
        create: {
          instanceId: this.instanceId,
          startedAt: now,
          heartbeatAt: now,
          lastRunAt: now,
          lastFailedAt: now,
          lastSummary: summary as any,
        },
        update: {
          heartbeatAt: now,
          lastRunAt: now,
          lastFailedAt: now,
          lastSummary: summary as any,
        },
      });
    } catch (persistError) {
      this.logger.warn(`failed to persist infrastructure failure: ${(persistError as Error).message}`);
    }
    this.lastRunAt = now;
    this.lastRunSummary = summary;
    return summary;
  }

  private async executeLeaderRound(): Promise<CareReminderWorkerSummary> {
    const startedAt = new Date();
    const run = await this.prisma.careReminderWorkerRun.create({
      data: {
        instanceId: this.instanceId,
        status: 'RUNNING',
        startedAt,
        heartbeatAt: startedAt,
      },
    });
    this.activeRunId = run.id;
    this.lastRunAt = startedAt;
    await this.prisma.careReminderWorkerHeartbeat.upsert({
      where: { instanceId: this.instanceId },
      create: {
        instanceId: this.instanceId,
        startedAt,
        heartbeatAt: startedAt,
        lastRunAt: startedAt,
        lastRunId: run.id,
      },
      update: {
        heartbeatAt: startedAt,
        lastRunAt: startedAt,
        lastRunId: run.id,
        stoppedAt: null,
      },
    });

    let summary = this.emptySummary('SUCCEEDED');
    try {
      const recovery = await this.recoverStuckSending();
      summary.recoveredStuck = recovery.recoveredStuck;
      summary.recoveredAsSent = recovery.recoveredAsSent;
      summary.retryScheduled += recovery.retryScheduled;

      summary.generated = await this.passGenerate(
        this.numberEnv('CARE_REMINDER_WORKER_HORIZON_DAYS', DEFAULT_HORIZON_DAYS),
      );
      const dispatch = await this.passDispatch();
      summary.dispatched = dispatch.dispatched;
      summary.dispatchFailed = dispatch.failed;
      summary.retried = dispatch.retried;
      summary.retryScheduled += dispatch.retryScheduled;

      const missed = await this.passMissed();
      summary.missed = missed.missed;
      summary.escalated = missed.escalated;
    } catch (e) {
      const message = (e as Error).message;
      summary = { ...summary, status: 'FAILED', error: message };
      this.logger.error(`runOnce error: ${message}`);
    } finally {
      const finishedAt = new Date();
      this.activeRunId = null;
      this.lastRunAt = finishedAt;
      this.lastRunSummary = summary;
      await this.prisma.careReminderWorkerRun.update({
        where: { id: run.id },
        data: {
          status: summary.status,
          finishedAt,
          heartbeatAt: finishedAt,
          generated: summary.generated,
          dispatched: summary.dispatched,
          dispatchFailed: summary.dispatchFailed,
          retried: summary.retried,
          retryScheduled: summary.retryScheduled,
          recoveredStuck: summary.recoveredStuck,
          recoveredAsSent: summary.recoveredAsSent,
          missed: summary.missed,
          escalated: summary.escalated,
          error: summary.error?.slice(0, 1000),
        },
      });
      await this.prisma.careReminderWorkerHeartbeat.update({
        where: { instanceId: this.instanceId },
        data: {
          heartbeatAt: finishedAt,
          lastRunAt: finishedAt,
          lastRunId: run.id,
          lastSummary: summary as any,
          ...(summary.status === 'SUCCEEDED'
            ? { lastSucceededAt: finishedAt }
            : { lastFailedAt: finishedAt }),
        },
      });
      this.logger.log(
        `round=${run.id} status=${summary.status} generated=${summary.generated} ` +
          `sent=${summary.dispatched} failed=${summary.dispatchFailed} retried=${summary.retried} ` +
          `retryScheduled=${summary.retryScheduled} recovered=${summary.recoveredStuck} ` +
          `escalated=${summary.escalated}`,
      );
    }
    return summary;
  }

  // ---------------------------------------------------------------------------
  // recovery for crashed SENDING rows
  // ---------------------------------------------------------------------------

  async recoverStuckSending(): Promise<RecoveryResult> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - this.stuckSendingAfterMs());
    const stuck = await this.prisma.careReminderOccurrence.findMany({
      where: {
        status: 'SENDING',
        OR: [
          { sendingStartedAt: { lt: cutoff } },
          { sendingStartedAt: null, updatedAt: { lt: cutoff } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: 500,
    });

    let recoveredStuck = 0;
    let recoveredAsSent = 0;
    let retryScheduled = 0;
    for (const occ of stuck) {
      const message = occ.outboundMessageId
        ? await this.prisma.patientOutboundMessage.findUnique({ where: { id: occ.outboundMessageId } })
        : null;
      if (message && ['SENT', 'CLICKED', 'SUBMITTED'].includes(message.status)) {
        const marked = await this.occurrences.markSent(
          occ.id,
          occ.formLinkId ?? message.formLinkId,
          message.id,
        );
        if (marked) {
          recoveredStuck += 1;
          recoveredAsSent += 1;
        }
        continue;
      }

      const result = await this.occurrences.recoverStuckSending(
        occ.id,
        '检测到长期停留在 SENDING，已由 Worker 自动恢复',
        this.retryOptions(now),
      );
      if (result.transitioned) {
        recoveredStuck += 1;
        if (!result.exhausted) retryScheduled += 1;
      }
    }
    return { recoveredStuck, recoveredAsSent, retryScheduled };
  }

  // ---------------------------------------------------------------------------
  // explicit targeted dispatch for nurse send-now
  // ---------------------------------------------------------------------------

  async dispatchOccurrenceNow(id: string) {
    const occ = await this.loadOccurrenceForDispatch(id);
    if (!occ || occ.status !== 'PENDING') return this.occurrences.getByIdOrThrow(id);

    const claimed = await this.occurrences.claimForSending(occ.id);
    if (!claimed) return this.occurrences.getByIdOrThrow(id);

    try {
      const { formLink, message } = await this.dispatchOne(occ);
      if (message?.status === 'SENT' || message?.status === 'PENDING') {
        await this.occurrences.markSent(occ.id, formLink?.id, message?.id);
      } else {
        await this.occurrences.markSendFailed(
          occ.id,
          message?.errorMessage ?? 'unknown dispatch failure',
          this.retryOptions(),
        );
      }
    } catch (e) {
      await this.occurrences.markSendFailed(occ.id, (e as Error).message, this.retryOptions());
      throw e;
    }
    return this.occurrences.getByIdOrThrow(id);
  }

  // ---------------------------------------------------------------------------
  // pass 1: reconcile + generate occurrences
  // ---------------------------------------------------------------------------

  private async passGenerate(horizonDays: number): Promise<number> {
    const sourceBound = await this.prisma.careReminderSchedule.findMany({
      where: { sourceType: { in: ['MEDICATION', 'VITAL'] } },
      select: { patientId: true },
    });
    const patientIds = Array.from(new Set(sourceBound.map((s) => s.patientId)));
    for (const patientId of patientIds) {
      try {
        await this.schedules.syncAllSchedulesForPatient(patientId);
      } catch (e) {
        this.logger.error(
          `reconcile before generate failed for patient ${patientId}: ${(e as Error).message}`,
        );
      }
    }

    const activeSchedules = await this.prisma.careReminderSchedule.findMany({
      where: { isActive: true },
      include: { hospitalTenant: { select: { timezone: true } } },
    });

    let totalCreated = 0;
    for (const schedule of activeSchedules) {
      const result = await this.occurrences.generateForSchedule({
        schedule,
        timezone: schedule.hospitalTenant?.timezone || 'Asia/Shanghai',
        daysAhead: horizonDays,
      });
      totalCreated += result.created;
    }
    return totalCreated;
  }

  // ---------------------------------------------------------------------------
  // pass 2: dispatch due reminders with delayed retry gating
  // ---------------------------------------------------------------------------

  private async passDispatch(): Promise<DispatchResult> {
    const now = new Date();
    const pending = await this.prisma.careReminderOccurrence.findMany({
      where: {
        status: 'PENDING',
        availableFrom: { lte: now },
        availableUntil: { gte: now },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
      orderBy: { dueAt: 'asc' },
      take: 200,
      include: {
        schedule: true,
        patient: { include: { wechatIdentities: { take: 5, orderBy: { createdAt: 'desc' } } } },
      },
    });

    let dispatched = 0;
    let failed = 0;
    let retried = 0;
    let retryScheduled = 0;
    for (const occ of pending) {
      const wasRetry = occ.retryCount > 0;
      const claimed = await this.occurrences.claimForSending(occ.id, now);
      if (!claimed) continue;
      if (wasRetry) retried += 1;

      try {
        const { formLink, message } = await this.dispatchOne(occ);
        if (message?.status === 'SENT' || message?.status === 'PENDING') {
          await this.occurrences.markSent(occ.id, formLink?.id, message?.id);
          dispatched += 1;
        } else {
          const result = await this.occurrences.markSendFailed(
            occ.id,
            message?.errorMessage ?? 'unknown dispatch failure',
            this.retryOptions(now),
          );
          if (result.transitioned && !result.exhausted) retryScheduled += 1;
          failed += 1;
        }
      } catch (e) {
        const result = await this.occurrences.markSendFailed(
          occ.id,
          (e as Error).message,
          this.retryOptions(now),
        );
        if (result.transitioned && !result.exhausted) retryScheduled += 1;
        failed += 1;
      }
    }
    return { dispatched, failed, retried, retryScheduled };
  }

  private async loadOccurrenceForDispatch(id: string) {
    return this.prisma.careReminderOccurrence.findUnique({
      where: { id },
      include: {
        schedule: true,
        patient: {
          include: {
            wechatIdentities: { take: 5, orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });
  }

  /**
   * Reuse existing canonical artifacts after retry/recovery. For a new row,
   * attach formLinkId/outboundMessageId before the external provider call.
   */
  private async dispatchOne(occ: any) {
    const current = await this.prisma.careReminderOccurrence.findUnique({ where: { id: occ.id } });
    if (current?.formLinkId && current.outboundMessageId) {
      const [formLink, message] = await Promise.all([
        this.prisma.patientFormLink.findUnique({ where: { id: current.formLinkId } }),
        this.prisma.patientOutboundMessage.findUnique({ where: { id: current.outboundMessageId } }),
      ]);
      const formLinkUsable =
        formLink?.status === 'ACTIVE' &&
        (!formLink.expiresAt || formLink.expiresAt.getTime() > Date.now()) &&
        !formLink.revokedAt;
      if (formLink && message && formLinkUsable) {
        if (['SENT', 'CLICKED', 'SUBMITTED'].includes(message.status)) {
          return { formLink, token: null, linkUrl: message.linkUrl ?? '', message };
        }
        return this.dispatchExistingMessage(occ, formLink, message);
      }
    }

    const schedule = occ.schedule;
    const patient = occ.patient;
    const tenantId: string = occ.hospitalTenantId;
    const { formLink, token, linkUrl } = await this.formLink.create({
      hospitalTenantId: tenantId,
      patientId: occ.patientId,
      type: this.occurrenceTypeToFormLinkType(occ.occurrenceType),
      title: occ.title,
      description: this.buildDescription(occ, schedule),
      payload: {
        careReminderOccurrenceId: occ.id,
        scheduleId: occ.scheduleId,
        sourceType: schedule.sourceType,
        sourceId: schedule.sourceId,
        ...(schedule.payload || {}),
      } as any,
      expiresInHours: 24,
      requiresIdentityCheck: false,
      createdBy: null,
    });

    const route = await this.resolveRoute(tenantId, patient);
    const message = await this.outbound.create({
      hospitalTenantId: tenantId,
      patientId: occ.patientId,
      formLinkId: formLink.id,
      channel: route.channel,
      messageType: this.occurrenceTypeToMessageType(occ.occurrenceType),
      title: occ.title,
      content: this.buildContent(occ, schedule, linkUrl),
      linkUrl,
      recipient: route.recipient,
      createdBy: null,
      initialStatus: 'PENDING',
    });

    const attached = await this.occurrences.attachDispatchArtifacts(occ.id, formLink.id, message.id);
    if (!attached) {
      throw new Error('occurrence lost SENDING claim before dispatch artifacts were persisted');
    }

    if (route.channel === 'MANUAL_COPY') return { formLink, token, linkUrl, message };
    return this.dispatchExistingMessage(occ, formLink, message, route);
  }

  private async resolveRoute(tenantId: string, patient: any) {
    const account = await this.accounts.getAccountForTenant(tenantId);
    const scopedOpenId = (() => {
      if (!account) return null;
      const match = (patient.wechatIdentities || []).find(
        (identity: any) =>
          identity.hospitalTenantId === tenantId && identity.appId === account.appId && identity.isVerified,
      );
      return match?.openId ?? null;
    })();
    const canWechat = await this.wechat.tenantCanReceiveWechat(tenantId);
    const channel: 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS' | 'MANUAL_COPY' =
      scopedOpenId && canWechat ? 'WECHAT_OFFICIAL_ACCOUNT' : patient.phone ? 'SMS' : 'MANUAL_COPY';
    const recipient = channel === 'WECHAT_OFFICIAL_ACCOUNT' ? scopedOpenId : channel === 'SMS' ? patient.phone : null;
    return { channel, recipient, scopedOpenId, phone: patient.phone ?? null };
  }

  private async dispatchExistingMessage(
    occ: any,
    formLink: any,
    message: any,
    route?: { channel: 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS' | 'MANUAL_COPY'; recipient: string | null; scopedOpenId: string | null; phone: string | null },
  ) {
    const resolved = route ?? (await this.resolveRoute(occ.hospitalTenantId, occ.patient));
    const channel = message.channel === 'MANUAL_COPY' ? resolved.channel : message.channel;
    if (channel === 'MANUAL_COPY') {
      return { formLink, token: null, linkUrl: message.linkUrl ?? '', message };
    }

    const primary = await this.outbound.attemptDispatch({
      messageId: message.id,
      channel,
      openId: channel === 'WECHAT_OFFICIAL_ACCOUNT' ? resolved.scopedOpenId : null,
      phone: channel === 'SMS' ? resolved.phone : null,
      triggerReason: message.lastAttemptAt ? 'WORKER_RETRY' : 'INITIAL',
    });

    if (
      channel === 'WECHAT_OFFICIAL_ACCOUNT' &&
      primary.dispatched?.status === 'FAILED' &&
      resolved.phone
    ) {
      const fallback = await this.outbound.attemptDispatch({
        messageId: message.id,
        channel: 'SMS',
        openId: null,
        phone: resolved.phone,
        triggerReason: 'AUTO_FALLBACK',
      });
      return { formLink, token: null, linkUrl: message.linkUrl ?? '', message: fallback.message };
    }
    return { formLink, token: null, linkUrl: message.linkUrl ?? '', message: primary.message };
  }

  // ---------------------------------------------------------------------------
  // pass 3: missed + escalation
  // ---------------------------------------------------------------------------

  private async passMissed(): Promise<{ missed: number; escalated: number }> {
    const now = new Date();
    const stale = await this.prisma.careReminderOccurrence.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED', 'SENT', 'CLICKED'] },
        availableUntil: { lt: now },
      },
      take: 500,
    });
    let missed = 0;
    for (const occ of stale) {
      if (await this.occurrences.markMissed(occ.id)) missed += 1;
    }

    const candidates = await this.prisma.careReminderOccurrence.findMany({
      where: { status: 'MISSED', escalatedTaskId: null },
      include: { schedule: true, patient: { select: { responsibleNurseId: true } } },
      take: 500,
    });
    let escalated = 0;
    for (const occ of candidates) {
      const after = occ.schedule.escalationAfterMinutes;
      if (after == null) continue;
      const escalateAt = (occ.missedAt ?? occ.availableUntil).getTime() + after * 60_000;
      if (escalateAt > now.getTime()) continue;

      const task = await this.prisma.task.create({
        data: {
          patientId: occ.patientId,
          title: `未完成 · ${occ.title}`,
          type: this.occurrenceTypeToTaskType(occ.occurrenceType),
          status: TaskStatus.PENDING,
          dueAt: new Date(now.getTime() + 24 * 3600 * 1000),
          assigneeId: occ.patient.responsibleNurseId ?? undefined,
          priority: 1,
        },
      });
      const won = await this.occurrences.markEscalated(occ.id, task.id);
      if (won) {
        escalated += 1;
      } else {
        try {
          await this.prisma.task.delete({ where: { id: task.id } });
        } catch {
          // best-effort orphan cleanup only
        }
      }
    }
    return { missed, escalated };
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  private occurrenceTypeToFormLinkType(type: string): string {
    switch (type) {
      case 'MEDICATION_CHECKIN':
        return 'MEDICATION_CHECKIN';
      case 'VITAL_RECHECK':
        return 'VITAL_RECHECK';
      case 'QUESTIONNAIRE':
        return 'QUESTIONNAIRE';
      case 'GENERAL_MESSAGE':
        return 'GENERAL_MESSAGE';
      default:
        return 'GENERIC_NOTICE';
    }
  }

  private occurrenceTypeToMessageType(type: string): string {
    switch (type) {
      case 'MEDICATION_CHECKIN':
        return 'MEDICATION_REMINDER';
      case 'VITAL_RECHECK':
        return 'VITAL_RECHECK_REMINDER';
      case 'QUESTIONNAIRE':
        return 'QUESTIONNAIRE_REMINDER';
      default:
        return 'QUESTIONNAIRE_REMINDER';
    }
  }

  private occurrenceTypeToTaskType(type: string): string {
    switch (type) {
      case 'MEDICATION_CHECKIN':
        return 'MEDICATION_ADHERENCE_FOLLOW_UP';
      case 'VITAL_RECHECK':
        return 'RISK_ALERT_FOLLOW_UP';
      default:
        return 'GENERAL_FOLLOW_UP';
    }
  }

  private buildDescription(occ: any, schedule: any): string {
    const dueLocal = occ.dueAt as Date;
    return schedule.description || `${occ.title} · 计划时间 ${dueLocal.toISOString()}`;
  }

  private buildContent(occ: any, schedule: any, linkUrl: string): string {
    return `${schedule.description || occ.title}\n点击下方链接完成本次任务: ${linkUrl}`;
  }
}
