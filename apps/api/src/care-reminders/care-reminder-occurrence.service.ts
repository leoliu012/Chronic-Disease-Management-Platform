import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import type { CareReminderSchedule, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { dayOfWeekFromIso, localDateInTzToUtc, parseHm, tenantDatesAhead } from './tz-util';

export type OccurrenceStatus =
  | 'PENDING'
  | 'SENDING'
  | 'SENT'
  | 'FAILED'
  | 'CLICKED'
  | 'COMPLETED'
  | 'MISSED'
  | 'ESCALATING'
  | 'ESCALATED'
  | 'CANCELED';

export type GenerateResult = {
  scheduleId: string;
  created: number;
  skipped: number;
};

export type SendFailureResult = {
  transitioned: boolean;
  status: 'PENDING' | 'FAILED';
  retryCount: number;
  nextRetryAt: Date | null;
  exhausted: boolean;
};

/**
 * CareReminderOccurrenceService
 * -----------------------------
 * Deterministic occurrence generation plus guarded state transitions.
 *
 * Reliability invariants:
 *  - generation is idempotent via @@unique([scheduleId, dueAt]);
 *  - every dispatch must win PENDING -> SENDING atomically;
 *  - dispatch artifacts are persisted before an external provider call;
 *  - failures become delayed PENDING retries, then terminal FAILED;
 *  - stale SENDING rows can be recovered after a crashed worker process.
 */
@Injectable()
export class CareReminderOccurrenceService {
  private readonly logger = new Logger('CareReminderOccurrence');

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Occurrence math
  // ---------------------------------------------------------------------------

  async generateForSchedule(args: {
    schedule: CareReminderSchedule;
    timezone: string;
    daysAhead?: number;
    now?: Date;
  }): Promise<GenerateResult> {
    const { schedule, timezone } = args;
    const daysAhead = args.daysAhead ?? 3;
    const now = args.now ?? new Date();

    if (!schedule.isActive) return { scheduleId: schedule.id, created: 0, skipped: 0 };

    const scheduledTimes = Array.isArray(schedule.scheduledTimes)
      ? (schedule.scheduledTimes as string[]).filter((s) => typeof s === 'string')
      : [];
    if (scheduledTimes.length === 0) return { scheduleId: schedule.id, created: 0, skipped: 0 };

    const scheduledDays = Array.isArray(schedule.scheduledDays)
      ? (schedule.scheduledDays as string[]).map((s) => String(s).toUpperCase())
      : null;

    const startsAt = schedule.startDate ? new Date(schedule.startDate).getTime() : 0;
    const endsAt = schedule.endDate ? new Date(schedule.endDate).getTime() : Infinity;
    const checkInBeforeMs = schedule.checkInWindowBeforeMinutes * 60_000;
    const checkInAfterMs = schedule.checkInWindowAfterMinutes * 60_000;
    const rows: Prisma.CareReminderOccurrenceCreateManyInput[] = [];

    for (const isoDate of tenantDatesAhead(timezone, daysAhead, now)) {
      if (scheduledDays && scheduledDays.length > 0 && !scheduledDays.includes(dayOfWeekFromIso(isoDate))) {
        continue;
      }
      for (const hm of scheduledTimes) {
        if (!parseHm(hm)) continue;
        const dueAt = localDateInTzToUtc(isoDate, hm, timezone);
        if (!dueAt) continue;
        const dueMs = dueAt.getTime();
        if (dueMs < startsAt || dueMs > endsAt) continue;
        rows.push({
          hospitalTenantId: schedule.hospitalTenantId,
          patientId: schedule.patientId,
          scheduleId: schedule.id,
          occurrenceType: schedule.reminderType,
          title: schedule.title,
          dueAt,
          availableFrom: new Date(dueMs - checkInBeforeMs),
          availableUntil: new Date(dueMs + checkInAfterMs),
          status: 'PENDING',
        });
      }
    }

    if (rows.length === 0) return { scheduleId: schedule.id, created: 0, skipped: 0 };

    const result = await this.prisma.careReminderOccurrence.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return {
      scheduleId: schedule.id,
      created: result.count,
      skipped: rows.length - result.count,
    };
  }

  // ---------------------------------------------------------------------------
  // State transitions (atomic claim guards)
  // ---------------------------------------------------------------------------

  /** PENDING -> SENDING. Delayed retries are claimable only when due. */
  async claimForSending(id: string, now = new Date()): Promise<boolean> {
    const r = await this.prisma.careReminderOccurrence.updateMany({
      where: {
        id,
        status: 'PENDING',
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
      data: {
        status: 'SENDING',
        sendingStartedAt: now,
        lastSendAttemptAt: now,
        sendAttemptCount: { increment: 1 },
      },
    });
    return r.count === 1;
  }

  /**
   * Persist the canonical link/message before the external transport call.
   * This narrows the crash window: recovery can inspect an existing message
   * instead of blindly creating a second case and dispatching again.
   */
  async attachDispatchArtifacts(
    id: string,
    formLinkId: string,
    outboundMessageId: string,
  ): Promise<boolean> {
    const r = await this.prisma.careReminderOccurrence.updateMany({
      where: { id, status: 'SENDING' },
      data: { formLinkId, outboundMessageId },
    });
    return r.count === 1;
  }

  /** SENDING -> SENT, with canonical metadata. */
  async markSent(
    id: string,
    formLinkId?: string | null,
    outboundMessageId?: string | null,
  ): Promise<boolean> {
    const r = await this.prisma.careReminderOccurrence.updateMany({
      where: { id, status: 'SENDING' },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        sendingStartedAt: null,
        nextRetryAt: null,
        ...(formLinkId ? { formLinkId } : {}),
        ...(outboundMessageId ? { outboundMessageId } : {}),
        lastError: null,
      },
    });
    return r.count === 1;
  }

  /**
   * SENDING -> delayed PENDING retry, or terminal FAILED after max retries.
   * maxRetries means retries after the initial attempt. With maxRetries=5,
   * the sixth consecutive failure becomes terminal FAILED.
   */
  async markSendFailed(
    id: string,
    error: string,
    options: { maxRetries: number; baseBackoffMs: number; maxBackoffMs: number; now?: Date },
  ): Promise<SendFailureResult> {
    const row = await this.prisma.careReminderOccurrence.findUnique({
      where: { id },
      select: { status: true, retryCount: true },
    });
    const now = options.now ?? new Date();
    if (!row || row.status !== 'SENDING') {
      return {
        transitioned: false,
        status: row?.status === 'FAILED' ? 'FAILED' : 'PENDING',
        retryCount: row?.retryCount ?? 0,
        nextRetryAt: null,
        exhausted: row?.status === 'FAILED',
      };
    }

    const retryCount = row.retryCount + 1;
    const exhausted = retryCount > options.maxRetries;
    const backoffMs = Math.min(
      options.maxBackoffMs,
      options.baseBackoffMs * Math.pow(2, Math.max(0, retryCount - 1)),
    );
    const nextRetryAt = exhausted ? null : new Date(now.getTime() + backoffMs);
    const status: 'PENDING' | 'FAILED' = exhausted ? 'FAILED' : 'PENDING';

    const updated = await this.prisma.careReminderOccurrence.updateMany({
      where: { id, status: 'SENDING', retryCount: row.retryCount },
      data: {
        status,
        sendingStartedAt: null,
        retryCount,
        nextRetryAt,
        lastError: error.slice(0, 500),
      },
    });
    return { transitioned: updated.count === 1, status, retryCount, nextRetryAt, exhausted };
  }

  /**
   * Recover an old SENDING row whose process disappeared before completing the
   * state transition. The worker first checks the canonical outbound message;
   * this method is used only when the DB cannot prove that sending succeeded.
   */
  async recoverStuckSending(
    id: string,
    error: string,
    options: { maxRetries: number; baseBackoffMs: number; maxBackoffMs: number; now?: Date },
  ): Promise<SendFailureResult> {
    return this.markSendFailed(id, error, options);
  }

  /** Admin-only operational replay for terminal or delayed failures. */
  async requestReplay(id: string, requestedBy: string) {
    const row = await this.getByIdOrThrow(id);
    if (!['FAILED', 'PENDING'].includes(row.status)) {
      throw new BadRequestException(
        `occurrence is in status ${row.status}; only FAILED or PENDING occurrences can be replayed`,
      );
    }
    const now = new Date();
    await this.prisma.careReminderOccurrence.update({
      where: { id },
      data: {
        status: 'PENDING',
        nextRetryAt: now,
        sendingStartedAt: null,
        retryCount: 0,
        replayCount: { increment: 1 },
        lastReplayRequestedAt: now,
        lastReplayRequestedBy: requestedBy,
        lastError: row.lastError
          ? `人工重放：${row.lastError}`.slice(0, 500)
          : '人工重放已请求',
      },
    });
    return this.getByIdOrThrow(id);
  }

  /** PENDING/SENT/CLICKED/FAILED -> MISSED after the completion window. */
  async markMissed(id: string): Promise<boolean> {
    const r = await this.prisma.careReminderOccurrence.updateMany({
      where: {
        id,
        status: { in: ['PENDING', 'SENT', 'CLICKED', 'FAILED'] },
        availableUntil: { lt: new Date() },
      },
      data: { status: 'MISSED', missedAt: new Date(), nextRetryAt: null },
    });
    return r.count === 1;
  }

  /**
   * Crash-safe MISSED -> ESCALATED transition.
   *
   * The occurrence claim, task upsert, and occurrence back-reference are one
   * database transaction. A process crash cannot leave a visible orphan task,
   * and retries reuse Task.sourceCareReminderOccurrenceId.
   */
  async escalateMissedOccurrence(args: {
    occurrenceId: string;
    patientId: string;
    title: string;
    type: string;
    dueAt: Date;
    assigneeId?: string | null;
    priority?: number;
  }): Promise<{ escalated: boolean; taskId: string | null }> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.careReminderOccurrence.updateMany({
        where: {
          id: args.occurrenceId,
          status: 'MISSED',
          escalatedTaskId: null,
        },
        data: { status: 'ESCALATING' },
      });

      if (claimed.count !== 1) {
        const current = await tx.careReminderOccurrence.findUnique({
          where: { id: args.occurrenceId },
          select: { escalatedTaskId: true },
        });
        return { escalated: false, taskId: current?.escalatedTaskId ?? null };
      }

      const task = await tx.task.upsert({
        where: { sourceCareReminderOccurrenceId: args.occurrenceId },
        update: {},
        create: {
          sourceCareReminderOccurrenceId: args.occurrenceId,
          patientId: args.patientId,
          title: args.title,
          type: args.type,
          status: TaskStatus.PENDING,
          dueAt: args.dueAt,
          assigneeId: args.assigneeId ?? undefined,
          priority: args.priority ?? 1,
        },
      });

      await tx.careReminderOccurrence.update({
        where: { id: args.occurrenceId },
        data: {
          status: 'ESCALATED',
          escalatedAt: new Date(),
          escalatedTaskId: task.id,
        },
      });

      return { escalated: true, taskId: task.id };
    });
  }

  async markCompletedByFormLinkInTx(
    tx: Prisma.TransactionClient,
    formLinkId: string,
    resultType: string,
    resultId: string,
  ): Promise<string | null> {
    const occ = await tx.careReminderOccurrence.findFirst({
      where: { formLinkId, status: { notIn: ['COMPLETED', 'CANCELED'] } },
      select: { id: true },
    });
    if (!occ) return null;
    const r = await tx.careReminderOccurrence.updateMany({
      where: { id: occ.id, status: { notIn: ['COMPLETED', 'CANCELED'] } },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        resultType,
        resultId,
        nextRetryAt: null,
        sendingStartedAt: null,
      },
    });
    return r.count === 1 ? occ.id : null;
  }

  // ---------------------------------------------------------------------------
  // Queries used by controllers
  // ---------------------------------------------------------------------------

  async listForPatient(args: {
    patientId: string;
    from?: Date;
    to?: Date;
    status?: OccurrenceStatus | OccurrenceStatus[];
    limit?: number;
  }) {
    const where: Prisma.CareReminderOccurrenceWhereInput = { patientId: args.patientId };
    if (args.from || args.to) {
      where.dueAt = {};
      if (args.from) where.dueAt.gte = args.from;
      if (args.to) where.dueAt.lte = args.to;
    }
    if (args.status) {
      where.status = Array.isArray(args.status) ? { in: args.status } : args.status;
    }
    return this.prisma.careReminderOccurrence.findMany({
      where,
      orderBy: { dueAt: 'asc' },
      take: args.limit ?? 100,
      include: { schedule: true },
    });
  }

  async getByIdOrThrow(id: string) {
    const row = await this.prisma.careReminderOccurrence.findUnique({
      where: { id },
      include: { schedule: true },
    });
    if (!row) throw new NotFoundException(`occurrence ${id} not found`);
    return row;
  }

  async cancel(id: string): Promise<void> {
    const r = await this.prisma.careReminderOccurrence.updateMany({
      where: { id, status: { in: ['PENDING', 'FAILED', 'SENT', 'CLICKED'] } },
      data: { status: 'CANCELED', nextRetryAt: null, sendingStartedAt: null },
    });
    if (r.count !== 1) {
      throw new ForbiddenException('only PENDING / FAILED / SENT / CLICKED occurrences can be canceled');
    }
  }
}
