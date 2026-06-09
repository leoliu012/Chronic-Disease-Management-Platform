import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import type { CareReminderSchedule, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { dayOfWeekFromIso, localDateInTzToUtc, parseHm, tenantDatesAhead } from './tz-util';

export type OccurrenceStatus =
  | 'PENDING'
  | 'SENDING'
  | 'SENT'
  | 'CLICKED'
  | 'COMPLETED'
  | 'MISSED'
  | 'ESCALATED'
  | 'CANCELED';

export type GenerateResult = {
  scheduleId: string;
  created: number;
  skipped: number;
};

/**
 * CareReminderOccurrenceService
 * -----------------------------
 * Two responsibilities:
 *
 *  1. Given a schedule + a window of tenant-local dates, compute the deterministic
 *     UTC dueAt for every firing inside that window and insert any missing
 *     `CareReminderOccurrence` rows. Uses `createMany({ skipDuplicates: true })`
 *     + the `@@unique([scheduleId, dueAt])` constraint so re-runs are no-ops.
 *
 *  2. State-machine guards. Every transition uses `updateMany` with a status
 *     filter so concurrent worker passes can't double-send or double-escalate.
 *     `claim***ForXxx()` returns the row only if the caller won the race.
 */
@Injectable()
export class CareReminderOccurrenceService {
  private readonly logger = new Logger('CareReminderOccurrence');

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Occurrence math
  // ---------------------------------------------------------------------------

  /**
   * Generate occurrences for a single schedule over the next `daysAhead` days
   * (tenant timezone). Idempotent.
   */
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
        const availableFrom = new Date(dueMs - checkInBeforeMs);
        const availableUntil = new Date(dueMs + checkInAfterMs);
        rows.push({
          hospitalTenantId: schedule.hospitalTenantId,
          patientId: schedule.patientId,
          scheduleId: schedule.id,
          occurrenceType: schedule.reminderType,
          title: schedule.title,
          dueAt,
          availableFrom,
          availableUntil,
          status: 'PENDING',
        });
      }
    }

    if (rows.length === 0) return { scheduleId: schedule.id, created: 0, skipped: 0 };

    // `createMany({ skipDuplicates: true })` + the @@unique constraint gives us
    // a one-shot idempotent insert.
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

  /** PENDING → SENDING. Returns true if claim succeeded. */
  async claimForSending(id: string): Promise<boolean> {
    const r = await this.prisma.careReminderOccurrence.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'SENDING' },
    });
    return r.count === 1;
  }

  /** SENDING → SENT, with metadata. */
  async markSent(id: string, formLinkId: string, outboundMessageId: string | null): Promise<void> {
    await this.prisma.careReminderOccurrence.updateMany({
      where: { id, status: 'SENDING' },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        formLinkId,
        outboundMessageId: outboundMessageId ?? undefined,
        lastError: null,
      },
    });
  }

  /** SENDING → PENDING with error. */
  async markSendFailed(id: string, error: string): Promise<void> {
    await this.prisma.careReminderOccurrence.updateMany({
      where: { id, status: 'SENDING' },
      data: {
        status: 'PENDING',
        lastError: error.slice(0, 500),
      },
    });
  }

  /** PENDING/SENT/CLICKED → MISSED if dueAt + window passed and not done. */
  async markMissed(id: string): Promise<boolean> {
    const r = await this.prisma.careReminderOccurrence.updateMany({
      where: {
        id,
        status: { in: ['PENDING', 'SENT', 'CLICKED'] },
        availableUntil: { lt: new Date() },
      },
      data: { status: 'MISSED', missedAt: new Date() },
    });
    return r.count === 1;
  }

  /** MISSED → ESCALATED, attach task id. Idempotent — only fires once. */
  async markEscalated(id: string, escalatedTaskId: string): Promise<boolean> {
    const r = await this.prisma.careReminderOccurrence.updateMany({
      where: { id, status: 'MISSED', escalatedTaskId: null },
      data: { status: 'ESCALATED', escalatedAt: new Date(), escalatedTaskId },
    });
    return r.count === 1;
  }

  /**
   * Mark COMPLETED from inside a transaction. Called by public-form.controller
   * submit handlers in the same tx as the business write.
   *
   * Returns the occurrence id if found and updated, otherwise null. Never throws
   * for "no occurrence" — many form-links won't have one (manual links pre-v3).
   */
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
    // Use updateMany w/ guard, just in case of concurrent submissions.
    const r = await tx.careReminderOccurrence.updateMany({
      where: { id: occ.id, status: { notIn: ['COMPLETED', 'CANCELED'] } },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        resultType,
        resultId,
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
      where: { id, status: { in: ['PENDING', 'SENT', 'CLICKED'] } },
      data: { status: 'CANCELED' },
    });
    if (r.count !== 1) {
      throw new ForbiddenException('only PENDING / SENT / CLICKED occurrences can be canceled');
    }
  }
}
