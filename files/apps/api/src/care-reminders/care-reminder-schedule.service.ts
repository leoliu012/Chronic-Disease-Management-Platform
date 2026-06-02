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

    // v3.3: plan-bound reminders (MEDICATION / VITAL) are a derived layer synced
    // from the MedicationRecord / VitalMonitoringPlan. They must NOT be edited,
    // paused, or resumed directly here — the source plan is the only place to
    // change times/frequency/active state. Block such writes even if a stale
    // frontend, script, or raw API call reaches this method (pause/resume route
    // through here too, so they are covered). Internal reconcile/sync writes use
    // prisma.careReminderSchedule.update directly and are unaffected.
    if (existing.sourceType === 'MEDICATION' || existing.sourceType === 'VITAL') {
      throw new BadRequestException(
        '绑定用药/指标计划的提醒不能在此直接修改，请到对应计划板块修改。',
      );
    }

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

  /**
   * Dedupe-by-source create. A plan-bound reminder (MEDICATION / VITAL) should
   * have AT MOST ONE active schedule per (patientId, sourceType, sourceId).
   * If one already exists we UPDATE it (and re-activate if it had been paused)
   * instead of stacking a second row. Falls back to a plain create when there
   * is no sourceId to dedupe on.
   */
  async createOrUpdateForSource(input: CreateScheduleInput): Promise<CareReminderSchedule> {
    if (input.sourceId) {
      const existing = await this.prisma.careReminderSchedule.findFirst({
        where: {
          patientId: input.patientId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (existing) {
        this.validateTimes(input.scheduledTimes);
        return this.prisma.careReminderSchedule.update({
          where: { id: existing.id },
          data: {
            title: input.title,
            description: input.description ?? null,
            reminderType: input.reminderType,
            frequencyUnit: input.frequencyUnit ?? 'DAY',
            timesPerUnit: input.timesPerUnit ?? (input.scheduledTimes.length || 1),
            scheduledTimes: input.scheduledTimes as any,
            scheduledDays: (input.scheduledDays ?? null) as any,
            payload: (input.payload ?? null) as any,
            reminderLeadMinutes: input.reminderLeadMinutes ?? 0,
            checkInWindowBeforeMinutes: input.checkInWindowBeforeMinutes ?? 180,
            checkInWindowAfterMinutes: input.checkInWindowAfterMinutes ?? 180,
            escalationAfterMinutes: input.escalationAfterMinutes ?? null,
            // re-activate a previously cancelled/paused binding
            isActive: true,
            pausedAt: null,
          },
        });
      }
    }
    return this.create(input);
  }

  /**
   * Cancel a schedule. v3.3: plan-bound reminders (MEDICATION / VITAL) are a
   * derived/cache layer and MUST NOT be deleted from the care-reminders page —
   * the nurse stops them by deactivating the source plan instead. We hard-block
   * those here so neither the (now hidden) UI nor a stray API call can delete a
   * binding. Non-source schedules (e.g. ad-hoc) may still be removed.
   */
  async cancelSchedule(id: string): Promise<{ id: string; canceled: true }> {
    const existing = await this.prisma.careReminderSchedule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`schedule ${id} not found`);
    if (existing.sourceType === 'MEDICATION' || existing.sourceType === 'VITAL') {
      throw new BadRequestException(
        '绑定用药/指标计划的提醒不能在此删除，请到对应计划板块停用。',
      );
    }
    await this.prisma.careReminderSchedule.delete({ where: { id } });
    return { id, canceled: true };
  }

  // ---------------------------------------------------------------------------
  // v3.3: source-of-truth sync. CareReminderSchedule is a derived layer; its
  // scheduledTimes / timesPerUnit / frequencyUnit / title / isActive / payload
  // must mirror the bound MedicationRecord or VitalMonitoringPlan. These helpers
  // reconcile a schedule to its source so the reminder never drifts from the
  // plan the nurse actually edits.
  // ---------------------------------------------------------------------------

  private toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((v) => typeof v === 'string') as string[];
    return [];
  }

  /** Desired schedule fields derived from a MedicationRecord. */
  private medicationToScheduleFields(med: {
    id: string;
    medicationName: string;
    dosage: string;
    frequency: string;
    frequencyUnit: string;
    timesPerUnit: number;
    customDoseTimes: unknown;
    customDoseDays: unknown;
    isActive: boolean;
  }) {
    return {
      title: `服药提醒: ${med.medicationName}`,
      reminderType: 'MEDICATION_CHECKIN',
      frequencyUnit: med.frequencyUnit || 'DAY',
      timesPerUnit: med.timesPerUnit || 1,
      scheduledTimes: this.toStringArray(med.customDoseTimes),
      scheduledDays: this.toStringArray(med.customDoseDays),
      isActive: med.isActive,
      payload: {
        medicationId: med.id,
        medicationName: med.medicationName,
        dosage: med.dosage,
        frequency: med.frequency,
      } as Record<string, unknown>,
    };
  }

  /** Desired schedule fields derived from a VitalMonitoringPlan. */
  private vitalPlanToScheduleFields(plan: {
    id: string;
    vitalType: string;
    displayName: string;
    unit: string;
    frequencyUnit: string;
    timesPerUnit: number;
    customMeasureTimes: unknown;
    customMeasureDays: unknown;
    isActive: boolean;
  }) {
    return {
      title: `${plan.displayName || plan.vitalType}打卡提醒`,
      reminderType: 'VITAL_RECHECK',
      frequencyUnit: plan.frequencyUnit || 'DAY',
      timesPerUnit: plan.timesPerUnit || 1,
      scheduledTimes: this.toStringArray(plan.customMeasureTimes),
      scheduledDays: this.toStringArray(plan.customMeasureDays),
      isActive: plan.isActive,
      payload: {
        vitalPlanId: plan.id,
        vitalType: plan.vitalType,
        displayName: plan.displayName,
        unit: plan.unit,
      } as Record<string, unknown>,
    };
  }

  /** True if the schedule already matches the desired derived fields. */
  private scheduleMatches(
    s: {
      title: string;
      frequencyUnit: string;
      timesPerUnit: number;
      scheduledTimes: unknown;
      isActive: boolean;
    },
    want: { title: string; frequencyUnit: string; timesPerUnit: number; scheduledTimes: string[]; isActive: boolean },
  ): boolean {
    const cur = JSON.stringify(this.toStringArray(s.scheduledTimes));
    const next = JSON.stringify(want.scheduledTimes);
    return (
      s.title === want.title &&
      s.frequencyUnit === want.frequencyUnit &&
      s.timesPerUnit === want.timesPerUnit &&
      s.isActive === want.isActive &&
      cur === next
    );
  }

  /**
   * v3.3.3: when a reconcile changes a schedule's scheduledTimes, drop its
   * FUTURE, not-yet-sent occurrences so they get regenerated at the new times
   * (otherwise the old time's PENDING rows linger alongside the new ones). Only
   * PENDING occurrences strictly after "now" are removed; anything already sent,
   * clicked, completed, missed, escalated, or due in the past is preserved.
   * Returns the number of occurrences removed.
   */
  private async pruneFuturePendingIfTimesChanged(
    scheduleId: string,
    oldTimes: unknown,
    newTimes: string[],
  ): Promise<number> {
    const before = JSON.stringify(this.toStringArray(oldTimes));
    const after = JSON.stringify(newTimes);
    if (before === after) return 0;
    const res = await this.prisma.careReminderOccurrence.deleteMany({
      where: {
        scheduleId,
        status: 'PENDING',
        dueAt: { gt: new Date() },
      },
    });
    return res.count;
  }

  /**
   * Reconcile every MEDICATION schedule bound to this medication to the record.
   * Returns the number of schedules updated.
   */
  async syncScheduleFromMedicationRecord(medicationId: string): Promise<number> {
    const med = await this.prisma.medicationRecord.findUnique({ where: { id: medicationId } });
    if (!med) return 0;
    const want = this.medicationToScheduleFields(med as any);
    const bound = await this.prisma.careReminderSchedule.findMany({
      where: { sourceType: 'MEDICATION', sourceId: medicationId },
    });
    let updated = 0;
    for (const s of bound) {
      if (this.scheduleMatches(s as any, want)) continue;
      // Drop future, not-yet-sent occurrences if the reminder times changed, so
      // the worker regenerates them at the new times instead of stacking both.
      await this.pruneFuturePendingIfTimesChanged(s.id, (s as any).scheduledTimes, want.scheduledTimes);
      await this.prisma.careReminderSchedule.update({
        where: { id: s.id },
        data: {
          title: want.title,
          reminderType: want.reminderType,
          frequencyUnit: want.frequencyUnit,
          timesPerUnit: want.timesPerUnit,
          scheduledTimes: want.scheduledTimes as any,
          scheduledDays: want.scheduledDays as any,
          payload: want.payload as any,
          isActive: want.isActive,
          pausedAt: want.isActive ? null : s.pausedAt ?? new Date(),
        },
      });
      updated += 1;
    }
    return updated;
  }

  /** Reconcile every VITAL schedule bound to this plan to the plan. */
  async syncScheduleFromVitalMonitoringPlan(planId: string): Promise<number> {
    const plan = await this.prisma.vitalMonitoringPlan.findUnique({ where: { id: planId } });
    if (!plan) return 0;
    const want = this.vitalPlanToScheduleFields(plan as any);
    const bound = await this.prisma.careReminderSchedule.findMany({
      where: { sourceType: 'VITAL', sourceId: planId },
    });
    let updated = 0;
    for (const s of bound) {
      if (this.scheduleMatches(s as any, want)) continue;
      // Drop future, not-yet-sent occurrences if the reminder times changed, so
      // the worker regenerates them at the new times instead of stacking both.
      await this.pruneFuturePendingIfTimesChanged(s.id, (s as any).scheduledTimes, want.scheduledTimes);
      await this.prisma.careReminderSchedule.update({
        where: { id: s.id },
        data: {
          title: want.title,
          reminderType: want.reminderType,
          frequencyUnit: want.frequencyUnit,
          timesPerUnit: want.timesPerUnit,
          scheduledTimes: want.scheduledTimes as any,
          scheduledDays: want.scheduledDays as any,
          payload: want.payload as any,
          isActive: want.isActive,
          pausedAt: want.isActive ? null : s.pausedAt ?? new Date(),
        },
      });
      updated += 1;
    }
    return updated;
  }

  /** Reconcile all source-bound schedules for a patient (used by listForPatient). */
  async syncAllSchedulesForPatient(patientId: string): Promise<void> {
    // v3.3: heal legacy rows whose sourceId was never set (older seeds stored
    // only payload.vitalType / payload.medicationId). Backfill sourceId by
    // matching the patient's plans so they can be reconciled like the rest.
    await this.backfillSourceIds(patientId);

    const bound = await this.prisma.careReminderSchedule.findMany({
      where: { patientId, sourceType: { in: ['MEDICATION', 'VITAL'] }, sourceId: { not: null } },
      select: { sourceType: true, sourceId: true },
    });
    const medIds = new Set<string>();
    const planIds = new Set<string>();
    for (const s of bound) {
      if (!s.sourceId) continue;
      if (s.sourceType === 'MEDICATION') medIds.add(s.sourceId);
      else if (s.sourceType === 'VITAL') planIds.add(s.sourceId);
    }
    for (const id of medIds) await this.syncScheduleFromMedicationRecord(id);
    for (const id of planIds) await this.syncScheduleFromVitalMonitoringPlan(id);
  }

  /**
   * v3.3: backfill missing sourceId on plan-bound schedules by matching the
   * patient's MedicationRecord / VitalMonitoringPlan, using payload hints
   * (vitalPlanId/medicationId) first, then patientId + vitalType / medicationName.
   * Returns the number of rows healed. Rows with no matching plan are left as-is
   * (a separate reconcile/cleanup decides whether to drop such orphans).
   */
  async backfillSourceIds(patientId: string): Promise<number> {
    const rows = await this.prisma.careReminderSchedule.findMany({
      where: {
        patientId,
        sourceType: { in: ['MEDICATION', 'VITAL'] },
        OR: [{ sourceId: null }, { sourceId: '' }],
      },
    });
    if (rows.length === 0) return 0;

    let healed = 0;
    for (const s of rows) {
      const payload: any = s.payload || {};
      let foundId: string | null = null;

      if (s.sourceType === 'VITAL') {
        const hintId = payload.vitalPlanId as string | undefined;
        if (hintId) {
          const byId = await this.prisma.vitalMonitoringPlan.findUnique({ where: { id: hintId } });
          if (byId && byId.patientId === patientId) foundId = byId.id;
        }
        if (!foundId && payload.vitalType) {
          const plan = await this.prisma.vitalMonitoringPlan.findFirst({
            where: { patientId, vitalType: payload.vitalType as string },
            orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
          });
          if (plan) foundId = plan.id;
        }
      } else if (s.sourceType === 'MEDICATION') {
        const hintId = payload.medicationId as string | undefined;
        if (hintId) {
          const byId = await this.prisma.medicationRecord.findUnique({ where: { id: hintId } });
          if (byId && byId.patientId === patientId) foundId = byId.id;
        }
        if (!foundId && payload.medicationName) {
          const med = await this.prisma.medicationRecord.findFirst({
            where: { patientId, medicationName: payload.medicationName as string },
            orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
          });
          if (med) foundId = med.id;
        }
      }

      if (foundId) {
        await this.prisma.careReminderSchedule.update({
          where: { id: s.id },
          data: { sourceId: foundId },
        });
        healed += 1;
      }
    }
    return healed;
  }

  // ---------------------------------------------------------------------------
  // queries
  // ---------------------------------------------------------------------------

  async listForPatient(patientId: string) {
    // v3.3: reconcile source-bound schedules to their MedicationRecord /
    // VitalMonitoringPlan before returning, so the page never shows reminder
    // times/frequency that drifted from the plan the nurse actually edits.
    await this.syncAllSchedulesForPatient(patientId);
    const schedules = await this.prisma.careReminderSchedule.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { occurrences: true } } },
    });
    // v3.1: attach a small source summary so the bound-plan view can render
    // 药品名/剂量 (MEDICATION) or 指标名/单位 (VITAL) without extra round-trips.
    return Promise.all(
      schedules.map(async (s) => ({
        ...s,
        sourceSummary: await this.buildSourceSummary(s),
      })),
    );
  }

  private async buildSourceSummary(s: {
    sourceType: string;
    sourceId: string | null;
    payload: unknown;
  }): Promise<{
    type: string;
    id: string | null;
    title: string;
    subtitle: string | null;
    status: string;
    scheduledTimes: string[];
    timesPerUnit: number;
    frequencyUnit: string;
  } | null> {
    const payload: any = s.payload || {};
    if (s.sourceType === 'MEDICATION') {
      const id = s.sourceId || payload.medicationId || null;
      if (id) {
        const med = await this.prisma.medicationRecord.findUnique({ where: { id } });
        if (med) {
          return {
            type: 'MEDICATION',
            id: med.id,
            title: med.medicationName,
            subtitle: [med.dosage, med.frequency].filter(Boolean).join(' · ') || null,
            status: med.isActive ? 'ACTIVE' : 'INACTIVE',
            scheduledTimes: this.toStringArray(med.customDoseTimes),
            timesPerUnit: med.timesPerUnit || 1,
            frequencyUnit: med.frequencyUnit || 'DAY',
          };
        }
      }
      return {
        type: 'MEDICATION',
        id,
        title: payload.medicationName || '用药计划',
        subtitle: payload.dosage || null,
        status: 'UNKNOWN',
        scheduledTimes: [],
        timesPerUnit: 1,
        frequencyUnit: 'DAY',
      };
    }
    if (s.sourceType === 'VITAL') {
      const id = s.sourceId || payload.vitalPlanId || null;
      if (id) {
        const plan = await this.prisma.vitalMonitoringPlan.findUnique({ where: { id } });
        if (plan) {
          return {
            type: 'VITAL',
            id: plan.id,
            title: plan.displayName || this.localizeVitalType(plan.vitalType),
            subtitle: plan.unit || null,
            status: plan.isActive ? 'ACTIVE' : 'INACTIVE',
            scheduledTimes: this.toStringArray(plan.customMeasureTimes),
            timesPerUnit: plan.timesPerUnit || 1,
            frequencyUnit: plan.frequencyUnit || 'DAY',
          };
        }
      }
      return {
        type: 'VITAL',
        id,
        title: this.localizeVitalType(payload.vitalType) || '指标监测',
        subtitle: null,
        status: 'UNKNOWN',
        scheduledTimes: [],
        timesPerUnit: 1,
        frequencyUnit: 'DAY',
      };
    }
    return null;
  }

  /** Friendly Chinese label for a vital indicator enum. */
  private localizeVitalType(vitalType?: string | null): string {
    if (!vitalType) return '';
    const map: Record<string, string> = {
      BLOOD_PRESSURE: '血压（收缩压/舒张压）',
      BLOOD_GLUCOSE: '血糖',
      WEIGHT: '体重',
      HEART_RATE: '心率',
      SPO2: '血氧',
      TEMPERATURE: '体温',
    };
    return map[vitalType] || vitalType;
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
