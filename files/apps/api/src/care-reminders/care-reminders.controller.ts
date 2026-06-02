import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../security/roles.decorator';
import { CurrentUser } from '../security/current-user.decorator';
import type { RequestUser } from '../security/request-user.type';
import { AuditService } from '../security/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PatientEngagementTenantService } from '../patient-engagement/patient-engagement-tenant.service';
import { CareReminderScheduleService } from './care-reminder-schedule.service';
import { CareReminderOccurrenceService } from './care-reminder-occurrence.service';
import { CareReminderWorkerService } from './care-reminder-worker.service';
import { CareReminderResendService } from './care-reminder-resend.service';
import { PatientDirectMessageService } from './patient-direct-message.service';
import {
  CreateMedicationScheduleDto,
  CreatePatientDirectMessageDto,
  CreateVitalScheduleDto,
  UpdateScheduleDto,
} from './dto/care-reminders.dto';

/**
 * /care-reminders/...
 *
 * Every endpoint calls PatientEngagementTenantService.assertPatientVisibleToUser
 * (or assertWriteAllowed) so tenant isolation matches v2.1.
 */
@Controller('care-reminders')
export class CareRemindersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: PatientEngagementTenantService,
    private readonly schedules: CareReminderScheduleService,
    private readonly occurrences: CareReminderOccurrenceService,
    private readonly worker: CareReminderWorkerService,
    private readonly resend: CareReminderResendService,
    private readonly directMessages: PatientDirectMessageService,
  ) {}

  // ---------------------------------------------------------------------------
  // schedules
  // ---------------------------------------------------------------------------

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('patients/:patientId/schedules')
  async listSchedulesForPatient(
    @Param('patientId') patientId: string,
    @CurrentUser() user: RequestUser,
  ) {
    await this.tenant.assertPatientVisibleToUser(patientId, user);
    return this.schedules.listForPatient(patientId);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('patients/:patientId/medication-schedules')
  async createMedicationSchedule(
    @Param('patientId') patientId: string,
    @Body() dto: CreateMedicationScheduleDto,
    @CurrentUser() user: RequestUser,
    @Req() req: any,
  ) {
    this.tenant.assertWriteAllowed(user);
    const { hospitalTenantId } = await this.tenant.assertPatientVisibleToUser(patientId, user);

    const medication = await this.prisma.medicationRecord.findUnique({
      where: { id: dto.medicationId },
    });
    if (!medication || medication.patientId !== patientId) {
      throw new NotFoundException('medication not found for this patient');
    }

    const schedule = await this.schedules.createOrUpdateForSource({
      hospitalTenantId,
      patientId,
      sourceType: 'MEDICATION',
      sourceId: medication.id,
      title: dto.title || `服药提醒: ${medication.medicationName}`,
      description: dto.description ?? null,
      reminderType: 'MEDICATION_CHECKIN',
      frequencyUnit: dto.frequencyUnit ?? 'DAY',
      timesPerUnit: dto.scheduledTimes.length,
      scheduledTimes: dto.scheduledTimes,
      scheduledDays: dto.scheduledDays ?? null,
      payload: {
        medicationId: medication.id,
        medicationName: medication.medicationName,
        dosage: medication.dosage,
      },
      reminderLeadMinutes: dto.reminderLeadMinutes ?? 0,
      checkInWindowBeforeMinutes: dto.checkInWindowBeforeMinutes ?? 60,
      checkInWindowAfterMinutes: dto.checkInWindowAfterMinutes ?? 240,
      escalationAfterMinutes: dto.escalationAfterMinutes ?? 240,
      createdBy: user.id,
    });

    await this.audit.record({
      user,
      action: 'CARE_REMINDER_SCHEDULE_CREATED',
      targetType: 'CareReminderSchedule',
      targetId: schedule.id,
      ipAddress: req?.ip,
      afterData: { reminderType: 'MEDICATION_CHECKIN', patientId, times: dto.scheduledTimes },
    });
    // v3.3: the medication record is the source of truth — reconcile the
    // schedule's times/frequency/title to it (ignore any client-supplied
    // scheduledTimes that disagree with the plan), then return the reconciled row.
    await this.schedules.syncScheduleFromMedicationRecord(medication.id);
    return this.schedules.getByIdOrThrow(schedule.id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('patients/:patientId/vital-schedules')
  async createVitalSchedule(
    @Param('patientId') patientId: string,
    @Body() dto: CreateVitalScheduleDto,
    @CurrentUser() user: RequestUser,
    @Req() req: any,
  ) {
    this.tenant.assertWriteAllowed(user);
    const { hospitalTenantId } = await this.tenant.assertPatientVisibleToUser(patientId, user);

    // v3.3: a VITAL reminder MUST be bound to a VitalMonitoringPlan — care
    // reminders only ever derive from the monitoring plan, never free-standing.
    if (!dto.vitalMonitoringPlanId) {
      throw new BadRequestException('指标提醒必须绑定指标监测计划。');
    }
    const plan = await this.prisma.vitalMonitoringPlan.findUnique({
      where: { id: dto.vitalMonitoringPlanId },
    });
    if (!plan || plan.patientId !== patientId) {
      throw new NotFoundException('vital monitoring plan not found for this patient');
    }
    // Trust the PLAN, not the request body: derive vitalType / times / frequency
    // from the plan. (createOrUpdateForSource seeds the row; the sync call below
    // reconciles it to the plan, so any body-supplied scheduledTimes are ignored.)
    const planTimes = Array.isArray(plan.customMeasureTimes)
      ? (plan.customMeasureTimes as unknown[]).filter((t) => typeof t === 'string')
      : [];

    const schedule = await this.schedules.createOrUpdateForSource({
      hospitalTenantId,
      patientId,
      sourceType: 'VITAL',
      sourceId: plan.id,
      title: dto.title || `${plan.displayName || this.vitalLabel(plan.vitalType)}打卡提醒`,
      description: dto.description ?? null,
      reminderType: 'VITAL_RECHECK',
      frequencyUnit: plan.frequencyUnit ?? 'DAY',
      timesPerUnit: plan.timesPerUnit ?? (planTimes.length || 1),
      scheduledTimes: planTimes as string[],
      scheduledDays: dto.scheduledDays ?? null,
      payload: {
        vitalPlanId: plan.id,
        vitalType: plan.vitalType,
        displayName: plan.displayName,
        unit: plan.unit,
      },
      reminderLeadMinutes: dto.reminderLeadMinutes ?? 0,
      checkInWindowBeforeMinutes: dto.checkInWindowBeforeMinutes ?? 60,
      checkInWindowAfterMinutes: dto.checkInWindowAfterMinutes ?? 240,
      escalationAfterMinutes: dto.escalationAfterMinutes ?? 240,
      createdBy: user.id,
    });

    await this.audit.record({
      user,
      action: 'CARE_REMINDER_SCHEDULE_CREATED',
      targetType: 'CareReminderSchedule',
      targetId: schedule.id,
      ipAddress: req?.ip,
      afterData: { reminderType: 'VITAL_RECHECK', vitalType: plan.vitalType, patientId, times: planTimes },
    });
    // v3.3: the plan is the source of truth — reconcile the schedule to it and
    // return the reconciled row.
    await this.schedules.syncScheduleFromVitalMonitoringPlan(plan.id);
    return this.schedules.getByIdOrThrow(schedule.id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Patch('schedules/:id')
  async updateSchedule(
    @Param('id') id: string,
    @Body() dto: UpdateScheduleDto,
    @CurrentUser() user: RequestUser,
  ) {
    this.tenant.assertWriteAllowed(user);
    const sched = await this.schedules.getByIdOrThrow(id);
    await this.tenant.assertPatientVisibleToUser(sched.patientId, user);
    return this.schedules.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('schedules/:id/pause')
  async pauseSchedule(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    this.tenant.assertWriteAllowed(user);
    const sched = await this.schedules.getByIdOrThrow(id);
    await this.tenant.assertPatientVisibleToUser(sched.patientId, user);
    return this.schedules.pause(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('schedules/:id/resume')
  async resumeSchedule(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    this.tenant.assertWriteAllowed(user);
    const sched = await this.schedules.getByIdOrThrow(id);
    await this.tenant.assertPatientVisibleToUser(sched.patientId, user);
    return this.schedules.resume(id);
  }

  // care-reminders-plan-dedupe-v1: schedule-level "取消计划" — permanently stop a
  // plan-bound long-term reminder (deletes the schedule; occurrences cascade).
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('schedules/:id/cancel')
  async cancelSchedule(@Param('id') id: string, @CurrentUser() user: RequestUser, @Req() req: any) {
    this.tenant.assertWriteAllowed(user);
    const sched = await this.schedules.getByIdOrThrow(id);
    await this.tenant.assertPatientVisibleToUser(sched.patientId, user);
    const result = await this.schedules.cancelSchedule(id);
    await this.audit.record({
      user,
      action: 'CARE_REMINDER_SCHEDULE_CANCELED',
      targetType: 'CareReminderSchedule',
      targetId: id,
      ipAddress: req?.ip,
      afterData: { sourceType: sched.sourceType, sourceId: sched.sourceId },
    });
    return result;
  }

  // ---------------------------------------------------------------------------
  // occurrences
  // ---------------------------------------------------------------------------

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('patients/:patientId/occurrences')
  async listOccurrencesForPatient(
    @Param('patientId') patientId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('status') status: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    await this.tenant.assertPatientVisibleToUser(patientId, user);
    const parsedStatus = status ? (status.split(',') as any) : undefined;
    return this.occurrences.listForPatient({
      patientId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      status: parsedStatus,
    });
  }

  /** Tenant-scoped "today's reminders" overview. */
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('today')
  async todayOverview(@CurrentUser() user: RequestUser) {
    const tenantId =
      user.role === UserRole.ADMIN
        ? null
        : await this.tenant.resolveUserHospitalTenantId(user);
    if (user.role !== UserRole.ADMIN && !tenantId) {
      throw new ForbiddenException('user is not bound to a tenant');
    }

    const now = new Date();
    const startOfWindow = new Date(now.getTime() - 24 * 3600 * 1000);
    const endOfWindow = new Date(now.getTime() + 24 * 3600 * 1000);
    return this.prisma.careReminderOccurrence.findMany({
      where: {
        ...(tenantId ? { hospitalTenantId: tenantId } : {}),
        dueAt: { gte: startOfWindow, lte: endOfWindow },
      },
      orderBy: { dueAt: 'asc' },
      take: 500,
      include: {
        schedule: true,
        patient: { select: { id: true, name: true, phone: true } },
      },
    });
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('missed')
  async missedOverview(@CurrentUser() user: RequestUser) {
    const tenantId =
      user.role === UserRole.ADMIN
        ? null
        : await this.tenant.resolveUserHospitalTenantId(user);
    if (user.role !== UserRole.ADMIN && !tenantId) {
      throw new ForbiddenException('user is not bound to a tenant');
    }
    return this.prisma.careReminderOccurrence.findMany({
      where: {
        ...(tenantId ? { hospitalTenantId: tenantId } : {}),
        status: { in: ['MISSED', 'ESCALATED'] },
        dueAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
      },
      orderBy: { missedAt: 'desc' },
      take: 200,
      include: {
        schedule: true,
        patient: { select: { id: true, name: true, phone: true } },
      },
    });
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('occurrences/:id/send-now')
  async sendNow(@Param('id') id: string, @CurrentUser() user: RequestUser, @Req() req: any) {
    this.tenant.assertWriteAllowed(user);
    const occ = await this.occurrences.getByIdOrThrow(id);
    await this.tenant.assertPatientVisibleToUser(occ.patientId, user);

    if (occ.status !== 'PENDING') {
      // Spec point 9: reuse existing link if already SENT.
      if (occ.status === 'SENT' || occ.status === 'CLICKED') {
        return { reused: true, occurrence: occ };
      }
      throw new BadRequestException(`occurrence is in status ${occ.status}; cannot send-now`);
    }

    // Trigger a single dispatch by running the worker pass scoped to this occ.
    // Easiest path: just invoke runOnce() — it'll claim and dispatch the
    // PENDING occurrence. We then return the refreshed row.
    await this.worker.runOnce();
    const refreshed = await this.occurrences.getByIdOrThrow(id);
    await this.audit.record({
      user,
      action: 'CARE_REMINDER_SEND_NOW',
      targetType: 'CareReminderOccurrence',
      targetId: id,
      ipAddress: req?.ip,
      afterData: { status: refreshed.status },
    });
    return { reused: false, occurrence: refreshed };
  }

  // v3.1: nurse 再次发送 — reuse the occurrence's canonical message and
  // append a NURSE_RESEND delivery attempt (no new message row). The
  // service throws BadRequest (400) for completed / non-resendable states.
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('occurrences/:id/resend')
  async resendOccurrence(@Param('id') id: string, @CurrentUser() user: RequestUser, @Req() req: any) {
    this.tenant.assertWriteAllowed(user);
    const occ = await this.occurrences.getByIdOrThrow(id);
    await this.tenant.assertPatientVisibleToUser(occ.patientId, user);
    const result = await this.resend.resend(id);
    await this.audit.record({
      user,
      action: 'CARE_REMINDER_RESEND',
      targetType: 'CareReminderOccurrence',
      targetId: id,
      ipAddress: req?.ip,
      afterData: {
        reusedLink: result.reusedLink,
        messageId: result.message?.id ?? null,
        status: result.occurrence?.status ?? null,
      },
    });
    return result;
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('occurrences/:id/cancel')
  async cancelOccurrence(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    this.tenant.assertWriteAllowed(user);
    const occ = await this.occurrences.getByIdOrThrow(id);
    await this.tenant.assertPatientVisibleToUser(occ.patientId, user);
    await this.occurrences.cancel(id);
    return this.occurrences.getByIdOrThrow(id);
  }

  // ---------------------------------------------------------------------------
  // direct messages
  // ---------------------------------------------------------------------------

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('patients/:patientId/messages')
  async listDirectMessages(
    @Param('patientId') patientId: string,
    @CurrentUser() user: RequestUser,
  ) {
    await this.tenant.assertPatientVisibleToUser(patientId, user);
    return this.directMessages.listForPatient(patientId);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('patients/:patientId/messages')
  async createDirectMessage(
    @Param('patientId') patientId: string,
    @Body() dto: CreatePatientDirectMessageDto,
    @CurrentUser() user: RequestUser,
    @Req() req: any,
  ) {
    this.tenant.assertWriteAllowed(user);
    const { hospitalTenantId } = await this.tenant.assertPatientVisibleToUser(patientId, user);
    const result = await this.directMessages.create({
      hospitalTenantId,
      patientId,
      senderId: user.id,
      title: dto.title,
      content: dto.content,
      priority: dto.priority,
      preferredChannel: dto.preferredChannel,
      requiresAck: dto.requiresAck,
    });
    await this.audit.record({
      user,
      action: 'PATIENT_DIRECT_MESSAGE_SENT',
      targetType: 'PatientDirectMessage',
      targetId: result.directMessage.id,
      ipAddress: req?.ip,
      afterData: {
        priority: dto.priority ?? 'NORMAL',
        channel: result.directMessage.channel,
        requiresAck: dto.requiresAck ?? false,
      },
    });
    return {
      directMessage: result.directMessage,
      formLink: result.formLink,
      linkUrl: result.linkUrl,
      outboundMessage: result.outboundMessage,
    };
  }

  // ---------------------------------------------------------------------------
  // worker control (admin / dev)
  // ---------------------------------------------------------------------------

  @Roles(UserRole.ADMIN)
  @Get('worker/status')
  workerStatus() {
    return this.worker.getStatus();
  }

  @Roles(UserRole.ADMIN)
  @Post('worker/run-once')
  async workerRunOnce(@CurrentUser() user: RequestUser, @Req() req: any) {
    const summary = await this.worker.runOnce();
    await this.audit.record({
      user,
      action: 'CARE_REMINDER_WORKER_RUN_ONCE',
      targetType: 'CareReminderWorker',
      targetId: 'worker',
      ipAddress: req?.ip,
      afterData: summary,
    });
    return summary;
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  private vitalLabel(vitalType: string): string {
    const map: Record<string, string> = {
      BLOOD_PRESSURE: '血压',
      BLOOD_GLUCOSE: '血糖',
      WEIGHT: '体重',
      HEART_RATE: '心率',
      SPO2: '血氧',
    };
    return map[vitalType] || vitalType;
  }
}
