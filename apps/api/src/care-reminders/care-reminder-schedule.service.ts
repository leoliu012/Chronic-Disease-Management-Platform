import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { CareReminderSchedule, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parseHm } from './tz-util';

export type ReminderType =
  | 'MEDICATION_CHECKIN'
  | 'VITAL_RECHECK'
  | 'QUESTIONNAIRE'
  | 'GENERAL_MESSAGE';

export type SourceType = 'MEDICATION' | 'VITAL' | 'QUESTIONNAIRE' | 'FOLLOW_UP' | 'MANUAL_MESSAGE';

export type CreateScheduleInput = {
  hospitalTenantId: string;
  patientId: string;
  sourceType: SourceType;
  sourceId?: string | null;
  title: string;
  description?: string | null;
  reminderType: ReminderType;
  frequencyUnit?: 'DAY' | 'WEEK' | 'MONTH';
  timesPerUnit?: number;
  scheduledTimes: string[];
  scheduledDays?: string[] | null;
  payload?: Record<string, unknown> | null;
  reminderLeadMinutes?: number;
  checkInWindowBeforeMinutes?: number;
  checkInWindowAfterMinutes?: number;
  escalationAfterMinutes?: number | null;
  startDate?: Date | null;
  endDate?: Date | null;
  createdBy?: string | null;
};

export type UpdateScheduleInput = Partial<{
  title: string;
  description: string | null;
  scheduledTimes: string[];
  scheduledDays: string[] | null;
  payload: Record<string, unknown> | null;
  reminderLeadMinutes: number;
  checkInWindowBeforeMinutes: number;
  checkInWindowAfterMinutes: number;
  escalationAfterMinutes: number | null;
  startDate: Date | null;
  endDate: Date | null;
  isActive: boolean;
}>;

/**
 * CareReminderScheduleService
 * ---------------------------
 *
 * IMPORTANT (spec point 8): updates do NOT rewrite historical occurrences. The
 * worker only generates occurrences for dueAt values that don't yet exist
 * (idempotent via the @@unique constraint). So if a nurse changes 08:00 → 09:00
 * on Tuesday, today's 08:00 occurrence stays as-is; tomorrow's 09:00 occurrence
 * appears on the next worker pass. Completed / SENT / MISSED rows are never
 * touched.
 *
 * Pausing flips `isActive=false`, which makes the worker stop generating future
 * occurrences. Already-PENDING occurrences for this schedule are NOT auto-canceled;
 * the nurse can cancel them individually via the occurrence endpoint.
 */
@Injectable()
export class CareReminderScheduleService {
  private readonly logger = new Logger('CareReminderSchedule');

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // create / update / pause / resume
  // ---------------------------------------------------------------------------

  async create(input: CreateScheduleInput): Promise<CareReminderSchedule> {
    this.validateTimes(input.scheduledTimes);
    if (!input.scheduledTimes || input.scheduledTimes.length === 0) {
      throw new BadRequestException('scheduledTimes is required (e.g. ["08:00"])');
    }

    return this.prisma.careReminderSchedule.create({
      data: {
        hospitalTenantId: input.hospitalTenantId,
        patientId: input.patientId,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? undefined,
        title: input.title,
        description: input.description ?? undefined,
        reminderType: input.reminderType,
        frequencyUnit: input.frequencyUnit ?? 'DAY',
        timesPerUnit: input.timesPerUnit ?? (input.scheduledTimes.length || 1),
        scheduledTimes: input.scheduledTimes as any,
        scheduledDays: (input.scheduledDays ?? null) as any,
        payload: (input.payload ?? null) as any,
        reminderLeadMinutes: input.reminderLeadMinutes ?? 0,
        checkInWindowBeforeMinutes: input.checkInWindowBeforeMinutes ?? 180,
        checkInWindowAfterMinutes: input.checkInWindowAfterMinutes ?? 180,
        escalationAfterMinutes: input.escalationAfterMinutes ?? undefined,
        startDate: input.startDate ?? undefined,
        endDate: input.endDate ?? undefined,
        createdBy: input.createdBy ?? undefined,
        isActive: true,
      },
    });
  }

  async update(id: string, patch: UpdateScheduleInput): Promise<CareReminderSchedule> {
    if (patch.scheduledTimes) this.validateTimes(patch.scheduledTimes);
    const existing = await this.prisma.careReminderSchedule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`schedule ${id} not found`);

    const data: Prisma.CareReminderScheduleUpdateInput = {};
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.description !== undefined) data.description = patch.description ?? null;
    if (patch.scheduledTimes !== undefined) data.scheduledTimes = patch.scheduledTimes as any;
    if (patch.scheduledDays !== undefined) data.scheduledDays = (patch.scheduledDays ?? null) as any;
    if (patch.payload !== undefined) data.payload = (patch.payload ?? null) as any;
    if (patch.reminderLeadMinutes !== undefined) data.reminderLeadMinutes = patch.reminderLeadMinutes;
    if (patch.checkInWindowBeforeMinutes !== undefined) data.checkInWindowBeforeMinutes = patch.checkInWindowBeforeMinutes;
    if (patch.checkInWindowAfterMinutes !== undefined) data.checkInWindowAfterMinutes = patch.checkInWindowAfterMinutes;
    if (patch.escalationAfterMinutes !== undefined) data.escalationAfterMinutes = patch.escalationAfterMinutes ?? null;
    if (patch.startDate !== undefined) data.startDate = patch.startDate ?? null;
    if (patch.endDate !== undefined) data.endDate = patch.endDate ?? null;
    if (patch.isActive !== undefined) {
      data.isActive = patch.isActive;
      if (!patch.isActive) data.pausedAt = new Date();
      else data.pausedAt = null;
    }

    return this.prisma.careReminderSchedule.update({ where: { id }, data });
  }

  async pause(id: string): Promise<CareReminderSchedule> {
    return this.update(id, { isActive: false });
  }

  async resume(id: string): Promise<CareReminderSchedule> {
    return this.update(id, { isActive: true });
  }

  // ---------------------------------------------------------------------------
  // queries
  // ---------------------------------------------------------------------------

  async listForPatient(patientId: string) {
    return this.prisma.careReminderSchedule.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { occurrences: true } } },
    });
  }

  async getByIdOrThrow(id: string) {
    const row = await this.prisma.careReminderSchedule.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`schedule ${id} not found`);
    return row;
  }

  async listActiveTenantSchedules(hospitalTenantId?: string | null) {
    return this.prisma.careReminderSchedule.findMany({
      where: {
        isActive: true,
        ...(hospitalTenantId ? { hospitalTenantId } : {}),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  private validateTimes(times: string[]) {
    for (const t of times) {
      if (!parseHm(t)) throw new BadRequestException(`invalid scheduledTime: "${t}" (expected HH:MM)`);
    }
  }
}
