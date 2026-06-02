import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CareReminderScheduleService } from './care-reminder-schedule.service';
import { CareReminderOccurrenceService } from './care-reminder-occurrence.service';
import { FormLinkService } from '../patient-engagement/form-link.service';
import { OutboundMessageService } from '../patient-engagement/outbound-message.service';
import { WechatOfficialAccountService } from '../patient-engagement/wechat-official-account.service';
import { HospitalWechatOfficialAccountService } from '../patient-engagement/hospital-wechat-account.service';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_HORIZON_DAYS = 3;

/**
 * CareReminderWorkerService
 * --------------------------
 * Single-instance setInterval-driven worker. Three passes per tick:
 *
 *   1. generate    — for every active schedule, materialize PENDING occurrences
 *                    out to N days ahead. Idempotent via @@unique([scheduleId, dueAt]).
 *   2. dispatch    — for PENDING occurrences with `availableFrom <= now`, create
 *                    PatientFormLink + PatientOutboundMessage and ship them.
 *   3. missed      — for occurrences past `availableUntil` and still un-completed,
 *                    mark MISSED. If schedule.escalationAfterMinutes is set,
 *                    escalate exactly once to a nurse Task.
 *
 * Default cadence: every 5 minutes. Disabled by default to keep dev runs quiet —
 * set CARE_REMINDER_WORKER_ENABLED=true to start it.
 *
 * Multi-instance safety: NONE. If you run >1 Nest replicas, only one of them
 * should set CARE_REMINDER_WORKER_ENABLED=true. Future hardening: leader election
 * via PG advisory lock, or move dispatch to Bull/Redis.
 *
 * For tests, callers can invoke `runOnce()` directly without the interval.
 */
@Injectable()
export class CareReminderWorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('CareReminderWorker');
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private lastRunAt: Date | null = null;
  private lastRunSummary: {
    generated: number;
    dispatched: number;
    dispatchFailed: number;
    missed: number;
    escalated: number;
    error?: string;
  } | null = null;

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
  // lifecycle
  // ---------------------------------------------------------------------------

  onApplicationBootstrap() {
    if (process.env.CARE_REMINDER_WORKER_ENABLED !== 'true') {
      this.logger.log(
        'Care-reminder worker disabled (set CARE_REMINDER_WORKER_ENABLED=true to enable).',
      );
      return;
    }
    const intervalMs = Number(
      process.env.CARE_REMINDER_WORKER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
    );
    // First run after 5s to avoid startup race.
    setTimeout(() => {
      this.runOnce().catch((e) => this.logger.error(`initial pass failed: ${(e as Error).message}`));
      this.timer = setInterval(() => {
        this.runOnce().catch((e) => this.logger.error(`scheduled pass failed: ${(e as Error).message}`));
      }, intervalMs);
    }, 5_000);
    this.logger.log(`Care-reminder worker scheduled every ${intervalMs}ms.`);
  }

  onApplicationShutdown() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStatus() {
    return {
      enabled: process.env.CARE_REMINDER_WORKER_ENABLED === 'true',
      running: this.timer !== null,
      inFlight: this.inFlight,
      intervalMs: Number(
        process.env.CARE_REMINDER_WORKER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
      ),
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      lastRunSummary: this.lastRunSummary,
    };
  }

  // ---------------------------------------------------------------------------
  // runOnce — also callable from smoke tests / dev-tools controller
  // ---------------------------------------------------------------------------

  async runOnce(): Promise<NonNullable<typeof this.lastRunSummary>> {
    if (this.inFlight) {
      this.logger.warn('previous pass still in flight; skipping this tick.');
      return this.lastRunSummary ?? { generated: 0, dispatched: 0, dispatchFailed: 0, missed: 0, escalated: 0 };
    }
    this.inFlight = true;
    const horizonDays = Number(
      process.env.CARE_REMINDER_WORKER_HORIZON_DAYS ?? DEFAULT_HORIZON_DAYS,
    );
    let generated = 0;
    let dispatched = 0;
    let dispatchFailed = 0;
    let missed = 0;
    let escalated = 0;
    let errorMsg: string | undefined;

    try {
      generated = await this.passGenerate(horizonDays);
      const dispatchResult = await this.passDispatch();
      dispatched = dispatchResult.dispatched;
      dispatchFailed = dispatchResult.failed;
      const missedResult = await this.passMissed();
      missed = missedResult.missed;
      escalated = missedResult.escalated;
    } catch (e) {
      errorMsg = (e as Error).message;
      this.logger.error(`runOnce error: ${errorMsg}`);
    } finally {
      this.inFlight = false;
      this.lastRunAt = new Date();
      this.lastRunSummary = { generated, dispatched, dispatchFailed, missed, escalated, ...(errorMsg ? { error: errorMsg } : {}) };
    }
    return this.lastRunSummary!;
  }

  // ---------------------------------------------------------------------------
  // pass 1: generate occurrences
  // ---------------------------------------------------------------------------

  private async passGenerate(horizonDays: number): Promise<number> {
    // v3.3.3: reconcile source-bound schedules to their MedicationRecord /
    // VitalMonitoringPlan BEFORE generating occurrences. Otherwise, if a nurse
    // just changed e.g. a blood-pressure plan's times but nobody has opened the
    // care-reminders page (which reconciles on read) and the reconcile script
    // hasn't run, the worker would generate reminders from stale schedule times.
    // syncAllSchedulesForPatient() also backfills missing sourceId and flips
    // isActive to match the source plan, so the fresh query below reflects the
    // true, current state.
    const sourceBound = await this.prisma.careReminderSchedule.findMany({
      where: { sourceType: { in: ['MEDICATION', 'VITAL'] } },
      select: { patientId: true },
    });
    const patientIds = Array.from(new Set(sourceBound.map((s) => s.patientId)));
    for (const patientId of patientIds) {
      try {
        await this.schedules.syncAllSchedulesForPatient(patientId);
      } catch (e) {
        // Never let one patient's reconcile failure abort the whole worker pass.
        this.logger.error(
          `reconcile before generate failed for patient ${patientId}: ${(e as Error).message}`,
        );
      }
    }

    // Re-query AFTER reconcile so we generate from the up-to-date schedules
    // (times/frequency aligned to the plan; plan-inactive bindings now isActive=false).
    const activeSchedules = await this.prisma.careReminderSchedule.findMany({
      where: { isActive: true },
      include: { hospitalTenant: { select: { timezone: true } } },
    });

    let totalCreated = 0;
    for (const sched of activeSchedules) {
      const timezone = sched.hospitalTenant?.timezone || 'Asia/Shanghai';
      const r = await this.occurrences.generateForSchedule({
        schedule: sched,
        timezone,
        daysAhead: horizonDays,
      });
      totalCreated += r.created;
    }
    return totalCreated;
  }

  // ---------------------------------------------------------------------------
  // pass 2: dispatch
  // ---------------------------------------------------------------------------

  private async passDispatch(): Promise<{ dispatched: number; failed: number }> {
    const now = new Date();
    // Window: anything currently inside the reminder window.
    const pending = await this.prisma.careReminderOccurrence.findMany({
      where: {
        status: 'PENDING',
        availableFrom: { lte: now },
        availableUntil: { gte: now },
      },
      orderBy: { dueAt: 'asc' },
      take: 200, // cap per tick
      include: {
        schedule: true,
        patient: { include: { wechatIdentities: { take: 5, orderBy: { createdAt: 'desc' } } } },
      },
    });

    let dispatched = 0;
    let failed = 0;
    for (const occ of pending) {
      // Spec point 9: each occurrence creates at most ONE active form link.
      // The PENDING → SENDING claim is the gate.
      const claimed = await this.occurrences.claimForSending(occ.id);
      if (!claimed) continue; // another worker pass grabbed it, or it transitioned

      try {
        const { formLink, linkUrl, message } = await this.dispatchOne(occ);
        if (message?.status === 'SENT' || message?.status === 'PENDING') {
          await this.occurrences.markSent(occ.id, formLink.id, message.id);
          dispatched += 1;
        } else {
          await this.occurrences.markSendFailed(occ.id, message?.errorMessage ?? 'unknown dispatch failure');
          failed += 1;
        }
      } catch (e) {
        await this.occurrences.markSendFailed(occ.id, (e as Error).message);
        failed += 1;
      }
    }

    return { dispatched, failed };
  }

  private async dispatchOne(occ: any) {
    const tenantId: string = occ.hospitalTenantId;
    const patient = occ.patient;
    const schedule = occ.schedule;

    // Step 1: create the form link.
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

    // Step 2: resolve channel using v2.1 rules.
    const account = await this.accounts.getAccountForTenant(tenantId);
    const scopedOpenId = (() => {
      if (!account) return null;
      const match = (patient.wechatIdentities || []).find(
        (i: any) =>
          i.hospitalTenantId === tenantId &&
          i.appId === account.appId &&
          i.isVerified,
      );
      return match?.openId ?? null;
    })();
    const canWechat = await this.wechat.tenantCanReceiveWechat(tenantId);

    const primaryChannel: 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS' | 'MANUAL_COPY' =
      scopedOpenId && canWechat ? 'WECHAT_OFFICIAL_ACCOUNT' :
      patient.phone ? 'SMS' :
      'MANUAL_COPY';

    // Step 3: create + dispatch outbound message.
    const messageType = this.occurrenceTypeToMessageType(occ.occurrenceType);
    const recipient = primaryChannel === 'WECHAT_OFFICIAL_ACCOUNT' ? scopedOpenId : primaryChannel === 'SMS' ? patient.phone : null;
    const content = this.buildContent(occ, schedule, linkUrl);

    const message = await this.outbound.create({
      hospitalTenantId: tenantId,
      patientId: occ.patientId,
      formLinkId: formLink.id,
      channel: primaryChannel,
      messageType,
      title: occ.title,
      content,
      linkUrl,
      recipient,
      createdBy: null,
      initialStatus: 'PENDING',
    });

    if (primaryChannel !== 'MANUAL_COPY') {
      const dispatched = await this.outbound.dispatch(message.id, {
        openId: primaryChannel === 'WECHAT_OFFICIAL_ACCOUNT' ? recipient : null,
        phone: primaryChannel === 'SMS' ? recipient : null,
      });
      // v3.2: record this as the INITIAL delivery attempt on the canonical message.
      // (We're already inside `if (primaryChannel !== 'MANUAL_COPY')`, so the
      // channel here is WECHAT_OFFICIAL_ACCOUNT or SMS.)
      try {
        await this.outbound.recordAttempt({
          messageId: message.id,
          hospitalTenantId: tenantId,
          patientId: occ.patientId,
          formLinkId: formLink.id,
          channel: primaryChannel,
          status: dispatched?.status === 'SENT' ? 'SENT' : 'FAILED',
          providerMessageId: dispatched?.providerMessageId ?? null,
          errorMessage: dispatched?.status === 'SENT' ? null : dispatched?.errorMessage ?? '发送失败',
          triggerReason: 'INITIAL',
        });
        await this.outbound.recomputeDelivery(message.id);
      } catch { /* attempts table may be pre-v3.2 */ }

      // v2.1 SMS fallback on WeChat failure.
      if (
        primaryChannel === 'WECHAT_OFFICIAL_ACCOUNT' &&
        dispatched?.status === 'FAILED' &&
        patient.phone
      ) {
        const fb = await this.outbound.create({
          hospitalTenantId: tenantId,
          patientId: occ.patientId,
          formLinkId: formLink.id,
          channel: 'SMS',
          messageType,
          title: occ.title,
          content,
          linkUrl,
          recipient: patient.phone,
          createdBy: null,
          initialStatus: 'PENDING',
        });
        const fbDispatched = await this.outbound.dispatch(fb.id, {
          openId: null,
          phone: patient.phone,
        });
        try {
          await this.outbound.recordAttempt({
            messageId: message.id,
            hospitalTenantId: tenantId,
            patientId: occ.patientId,
            formLinkId: formLink.id,
            channel: 'SMS',
            status: fbDispatched?.status === 'SENT' ? 'SENT' : 'FAILED',
            providerMessageId: fbDispatched?.providerMessageId ?? null,
            errorMessage: fbDispatched?.status === 'SENT' ? null : fbDispatched?.errorMessage ?? '发送失败',
            triggerReason: 'AUTO_FALLBACK',
          });
          await this.outbound.recomputeDelivery(message.id);
        } catch { /* attempts table may be pre-v3.2 */ }
        const refreshed = await this.prisma.patientOutboundMessage.findUnique({ where: { id: fb.id } });
        return { formLink, token, linkUrl, message: refreshed };
      }

      const refreshed = await this.prisma.patientOutboundMessage.findUnique({ where: { id: message.id } });
      return { formLink, token, linkUrl, message: refreshed };
    }

    return { formLink, token, linkUrl, message };
  }

  // ---------------------------------------------------------------------------
  // pass 3: missed + escalation
  // ---------------------------------------------------------------------------

  private async passMissed(): Promise<{ missed: number; escalated: number }> {
    const now = new Date();

    // mark MISSED
    const stale = await this.prisma.careReminderOccurrence.findMany({
      where: {
        status: { in: ['PENDING', 'SENT', 'CLICKED'] },
        availableUntil: { lt: now },
      },
      take: 500,
    });
    let missed = 0;
    for (const occ of stale) {
      if (await this.occurrences.markMissed(occ.id)) missed += 1;
    }

    // escalate: MISSED + schedule.escalationAfterMinutes set + within escalation window
    const candidates = await this.prisma.careReminderOccurrence.findMany({
      where: {
        status: 'MISSED',
        escalatedTaskId: null,
      },
      include: { schedule: true, patient: { select: { responsibleNurseId: true } } },
      take: 500,
    });
    let escalated = 0;
    for (const occ of candidates) {
      const after = occ.schedule.escalationAfterMinutes;
      if (after == null) continue;
      const escalateAt = (occ.missedAt ?? occ.availableUntil).getTime() + after * 60_000;
      if (escalateAt > now.getTime()) continue;

      // Create the nurse task first, then atomically attach.
      const task = await this.prisma.task.create({
        data: {
          patientId: occ.patientId,
          title: `未完成 · ${occ.title}`,
          type: this.occurrenceTypeToTaskType(occ.occurrenceType),
          status: TaskStatus.PENDING,
          dueAt: new Date(now.getTime() + 24 * 3600 * 1000),
          assigneeId: occ.patient.responsibleNurseId ?? undefined,
        },
      });
      const won = await this.occurrences.markEscalated(occ.id, task.id);
      if (won) {
        escalated += 1;
      } else {
        // Lost the race; delete the orphan task we just made.
        try { await this.prisma.task.delete({ where: { id: task.id } }); } catch { /* ignore */ }
      }
    }

    return { missed, escalated };
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  private occurrenceTypeToFormLinkType(t: string): string {
    switch (t) {
      case 'MEDICATION_CHECKIN': return 'MEDICATION_CHECKIN';
      case 'VITAL_RECHECK': return 'VITAL_RECHECK';
      case 'QUESTIONNAIRE': return 'QUESTIONNAIRE';
      case 'GENERAL_MESSAGE': return 'GENERAL_MESSAGE';
      default: return 'GENERIC_NOTICE';
    }
  }

  private occurrenceTypeToMessageType(t: string): string {
    switch (t) {
      case 'MEDICATION_CHECKIN': return 'MEDICATION_REMINDER';
      case 'VITAL_RECHECK': return 'VITAL_RECHECK_REMINDER';
      case 'QUESTIONNAIRE': return 'QUESTIONNAIRE_REMINDER';
      case 'GENERAL_MESSAGE': return 'QUESTIONNAIRE_REMINDER';
      default: return 'QUESTIONNAIRE_REMINDER';
    }
  }

  private occurrenceTypeToTaskType(t: string): string {
    switch (t) {
      case 'MEDICATION_CHECKIN': return 'MEDICATION_ADHERENCE_FOLLOW_UP';
      case 'VITAL_RECHECK': return 'RISK_ALERT_FOLLOW_UP';
      case 'GENERAL_MESSAGE': return 'GENERAL_FOLLOW_UP';
      default: return 'GENERAL_FOLLOW_UP';
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
