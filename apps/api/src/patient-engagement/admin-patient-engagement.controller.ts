import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../security/roles.decorator';
import { CurrentUser } from '../security/current-user.decorator';
import type { RequestUser } from '../security/request-user.type';
import { AuditService } from '../security/audit.service';
import { Audit } from '../security/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PatientEngagementService } from './patient-engagement.service';
import { FormLinkService } from './form-link.service';
import { HospitalWechatOfficialAccountService } from './hospital-wechat-account.service';
import { PatientEngagementTenantService } from './patient-engagement-tenant.service';
import { ClinicalAccessScopeService } from '../security/clinical-access-scope.service';
import {
  CreateHospitalVisitConfirmLinkDto,
  CreateMedicationCheckInLinkDto,
  CreateQuestionnaireLinkDto,
  CreateVitalRecheckLinkDto,
  RevokeFormLinkDto,
} from './dto/create-form-link.dto';
import { MarkManualSentDto, QueryMessagesDto, ResendEngagementMessageDto } from './dto/send-engagement-message.dto';

/**
 * AdminPatientEngagementController (v2)
 *
 * 给 Web 后台用. 每个接口入口都先调用 tenant.assertPatientVisibleToUser:
 *   - ADMIN 可以跨医院
 *   - 医生 / 护士 只能操作自己 hospitalTenantId 的患者
 *   - MANAGER 只读
 *
 * 通过 messageId / formLinkId 操作时, 也先反查 patientId 再校验.
 */
@Controller('patient-engagement')
export class AdminPatientEngagementController {
  constructor(
    private readonly engagement: PatientEngagementService,
    private readonly formLink: FormLinkService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accounts: HospitalWechatOfficialAccountService,
    private readonly tenant: PatientEngagementTenantService,
    private readonly access: ClinicalAccessScopeService,
  ) {}

  // ---------------------------------------------------------------------------
  // contact summary
  // ---------------------------------------------------------------------------

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('patients/:patientId/contact-summary')
  async contactSummary(@Param('patientId') patientId: string, @CurrentUser() user: RequestUser) {
    await this.tenant.assertPatientVisibleToUser(patientId, user);
    return this.engagement.getContactSummary(patientId);
  }

  // ---------------------------------------------------------------------------
  // create links
  // ---------------------------------------------------------------------------

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Audit({ mode: 'REQUIRED', action: 'SEND_PATIENT_QUESTIONNAIRE', target: 'PatientFormLink', targetIdFrom: 'response.formLink.id', patientIdFrom: 'params.patientId', detailsFrom: { type: 'response.formLink.type' } })
  @Post('patients/:patientId/questionnaire-links')
  async createQuestionnaireLink(
    @Param('patientId') patientId: string,
    @Body() dto: CreateQuestionnaireLinkDto,
    @CurrentUser() user: RequestUser,
    @Req() req: any,
  ) {
    this.tenant.assertWriteAllowed(user);
    await this.tenant.assertPatientVisibleToUser(patientId, user);
    const result = await this.engagement.createEngagementLink({
      patientId,
      type: 'QUESTIONNAIRE',
      title: dto.title || `请填写问卷: ${dto.questionnaireType}`,
      description: dto.description ?? null,
      payload: { questionnaireType: dto.questionnaireType, ...(dto.payload || {}) },
      expiresInHours: dto.expiresInHours,
      taskId: dto.taskId ?? null,
      riskAlertId: dto.riskAlertId ?? null,
      requiresIdentityCheck: dto.requiresIdentityCheck,
      createdBy: user.id,
      send: dto.send,
      preferredChannel: (dto.preferredChannel as any) ?? 'AUTO',
    });

    await this.audit.record({
      user,
      action: 'PATIENT_ENGAGEMENT_LINK_CREATED',
      targetType: 'PatientFormLink',
      targetId: result.formLink.id,
      ipAddress: req?.ip,
      afterData: { type: 'QUESTIONNAIRE', patientId, send: dto.send, channel: result.sendResult?.channel },
    });
    return this.publicLinkResponse(result);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Audit({ mode: 'REQUIRED', action: 'SEND_PATIENT_VITAL_RECHECK', target: 'PatientFormLink', targetIdFrom: 'response.formLink.id', patientIdFrom: 'params.patientId', detailsFrom: { type: 'response.formLink.type' } })
  @Post('patients/:patientId/vital-recheck-links')
  async createVitalRecheckLink(
    @Param('patientId') patientId: string,
    @Body() dto: CreateVitalRecheckLinkDto,
    @CurrentUser() user: RequestUser,
    @Req() req: any,
  ) {
    this.tenant.assertWriteAllowed(user);
    await this.tenant.assertPatientVisibleToUser(patientId, user);
    const result = await this.engagement.createEngagementLink({
      patientId,
      type: 'VITAL_RECHECK',
      title: dto.title || `请提交本次${this.vitalLabel(dto.vitalType)}复测`,
      description: dto.description ?? null,
      payload: { vitalType: dto.vitalType, ...(dto.payload || {}) },
      expiresInHours: dto.expiresInHours,
      taskId: dto.taskId ?? null,
      riskAlertId: dto.riskAlertId ?? null,
      requiresIdentityCheck: dto.requiresIdentityCheck,
      createdBy: user.id,
      send: dto.send,
      preferredChannel: (dto.preferredChannel as any) ?? 'AUTO',
    });

    await this.audit.record({
      user,
      action: 'PATIENT_ENGAGEMENT_LINK_CREATED',
      targetType: 'PatientFormLink',
      targetId: result.formLink.id,
      ipAddress: req?.ip,
      afterData: { type: 'VITAL_RECHECK', vitalType: dto.vitalType, patientId, send: dto.send, channel: result.sendResult?.channel },
    });
    return this.publicLinkResponse(result);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Audit({ mode: 'REQUIRED', action: 'SEND_PATIENT_MEDICATION_CHECKIN', target: 'PatientFormLink', targetIdFrom: 'response.formLink.id', patientIdFrom: 'params.patientId', detailsFrom: { type: 'response.formLink.type' } })
  @Post('patients/:patientId/medication-checkin-links')
  async createMedicationCheckInLink(
    @Param('patientId') patientId: string,
    @Body() dto: CreateMedicationCheckInLinkDto,
    @CurrentUser() user: RequestUser,
    @Req() req: any,
  ) {
    this.tenant.assertWriteAllowed(user);
    await this.tenant.assertPatientVisibleToUser(patientId, user);
    const medication = await this.prisma.medicationRecord.findUnique({ where: { id: dto.medicationId } });
    if (!medication || medication.patientId !== patientId) {
      throw new NotFoundException('Medication not found for this patient');
    }
    const result = await this.engagement.createEngagementLink({
      patientId,
      type: 'MEDICATION_CHECKIN',
      title: dto.title || `请完成用药打卡: ${medication.medicationName}`,
      description: dto.description ?? null,
      payload: {
        medicationId: medication.id,
        medicationName: medication.medicationName,
        dosage: medication.dosage,
        frequency: medication.frequency,
        scheduledAt: dto.scheduledAt ?? null,
        ...(dto.payload || {}),
      },
      expiresInHours: dto.expiresInHours,
      taskId: dto.taskId ?? null,
      riskAlertId: dto.riskAlertId ?? null,
      requiresIdentityCheck: dto.requiresIdentityCheck,
      createdBy: user.id,
      send: dto.send,
      preferredChannel: (dto.preferredChannel as any) ?? 'AUTO',
    });

    await this.audit.record({
      user,
      action: 'PATIENT_ENGAGEMENT_LINK_CREATED',
      targetType: 'PatientFormLink',
      targetId: result.formLink.id,
      ipAddress: req?.ip,
      afterData: { type: 'MEDICATION_CHECKIN', medicationId: medication.id, patientId, send: dto.send },
    });
    return this.publicLinkResponse(result);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Audit({ mode: 'REQUIRED', action: 'SEND_PATIENT_HOSPITAL_VISIT', target: 'PatientFormLink', targetIdFrom: 'response.formLink.id', patientIdFrom: 'params.patientId', detailsFrom: { type: 'response.formLink.type' } })
  @Post('patients/:patientId/hospital-visit-links')
  async createHospitalVisitLink(
    @Param('patientId') patientId: string,
    @Body() dto: CreateHospitalVisitConfirmLinkDto,
    @CurrentUser() user: RequestUser,
    @Req() req: any,
  ) {
    this.tenant.assertWriteAllowed(user);
    await this.tenant.assertPatientVisibleToUser(patientId, user);
    const result = await this.engagement.createEngagementLink({
      patientId,
      type: 'HOSPITAL_VISIT_CONFIRM',
      title: dto.title || '请确认到院安排',
      description: dto.description ?? dto.reason,
      payload: {
        hospitalVisitReminderId: dto.hospitalVisitReminderId ?? null,
        reason: dto.reason,
        ...(dto.payload || {}),
      },
      expiresInHours: dto.expiresInHours,
      taskId: dto.taskId ?? null,
      riskAlertId: dto.riskAlertId ?? null,
      requiresIdentityCheck: dto.requiresIdentityCheck,
      createdBy: user.id,
      send: dto.send,
      preferredChannel: (dto.preferredChannel as any) ?? 'AUTO',
    });

    await this.audit.record({
      user,
      action: 'PATIENT_ENGAGEMENT_LINK_CREATED',
      targetType: 'PatientFormLink',
      targetId: result.formLink.id,
      ipAddress: req?.ip,
      afterData: { type: 'HOSPITAL_VISIT_CONFIRM', reason: dto.reason, patientId, send: dto.send },
    });
    return this.publicLinkResponse(result);
  }

  // ---------------------------------------------------------------------------
  // revoke
  // ---------------------------------------------------------------------------

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Audit({ mode: 'REQUIRED', action: 'REVOKE_PATIENT_H5_LINK', target: 'PatientFormLink', targetIdFrom: 'params.id', patientIdFrom: 'response.patientId' })
  @Post('form-links/:id/revoke')
  async revokeLink(
    @Param('id') id: string,
    @Body() dto: RevokeFormLinkDto,
    @CurrentUser() user: RequestUser,
    @Req() req: any,
  ) {
    this.tenant.assertWriteAllowed(user);
    await this.tenant.assertFormLinkWritableToUser(id, user);
    const updated = await this.formLink.revoke(id, dto.reason, user.id);
    // v3.2: the case is no longer live — mark its message CANCELED (unless the
    // patient already submitted) so the list reflects 已失效.
    await this.prisma.patientOutboundMessage.updateMany({
      where: { formLinkId: id, status: { notIn: ['SUBMITTED', 'CANCELED'] } },
      data: { status: 'CANCELED' },
    });
    await this.prisma.engagementEventLog.create({
      data: {
        formLinkId: id,
        eventType: 'LINK_REVOKED',
        metadata: { reason: dto.reason, operatorId: user.id } as any,
      },
    });
    await this.audit.record({
      user,
      action: 'PATIENT_ENGAGEMENT_LINK_REVOKED',
      targetType: 'PatientFormLink',
      targetId: id,
      ipAddress: req?.ip,
      afterData: { reason: dto.reason },
    });
    return updated;
  }

  // ---------------------------------------------------------------------------
  // messages
  // ---------------------------------------------------------------------------

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('patients/:patientId/messages')
  async listPatientMessages(@Param('patientId') patientId: string, @CurrentUser() user: RequestUser) {
    await this.tenant.assertPatientVisibleToUser(patientId, user);
    return this.prisma.patientOutboundMessage.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      include: {
        formLink: {
          select: { id: true, type: true, status: true, expiresAt: true, usedAt: true, submitCount: true, payload: true },
        },
      },
      take: 100,
    });
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('messages')
  async listMessages(@Query() query: QueryMessagesDto, @CurrentUser() user: RequestUser) {
    const where: any = {};
    if (query.patientId) {
      await this.tenant.assertPatientVisibleToUser(query.patientId, user);
      where.patientId = query.patientId;
    } else {
      // List visibility uses the same patient domain as every clinical module.
      where.patient = await this.access.buildPatientScope(user, query.hospitalTenantId);
    }
    if (query.channel) where.channel = query.channel;
    if (query.status) where.status = query.status;
    if (query.messageType) where.messageType = query.messageType;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) {
        // v3.2-fix: bare-date from = start-of-day (server-local), matching the
        // end-of-day handling on `to`. Parsing 'YYYY-MM-DD' via new Date() yields
        // UTC midnight, which on a UTC+N server starts the window N hours late and
        // silently drops early-in-the-day rows.
        const from = new Date(query.from);
        if (/^\d{4}-\d{2}-\d{2}$/.test(query.from)) from.setHours(0, 0, 0, 0);
        where.createdAt.gte = from;
      }
      if (query.to) {
        // inclusive end-of-day if a bare date was supplied
        const to = new Date(query.to);
        if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) to.setHours(23, 59, 59, 999);
        where.createdAt.lte = to;
      }
    }
    // v3.2: pagination
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const [total, items] = await this.prisma.$transaction([
      this.prisma.patientOutboundMessage.count({ where }),
      this.prisma.patientOutboundMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          patient: { select: { id: true, name: true, hospitalPatientId: true } },
          formLink: {
            select: { id: true, type: true, status: true, expiresAt: true, usedAt: true, revokedAt: true, revokeReason: true, submitCount: true, submittedAt: true, payload: true },
          },
        },
      }),
    ]);
    return { items, total, page, pageSize };
  }

  // v3.2: full case detail — message + formLink + attempts timeline + patient submission
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('messages/:id/detail')
  async messageDetail(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    await this.tenant.assertMessageVisibleToUser(id, user);
    const message = await this.prisma.patientOutboundMessage.findUnique({
      where: { id },
      include: { patient: { select: { id: true, name: true, hospitalPatientId: true } } },
    });
    if (!message) throw new NotFoundException('Message not found');
    const formLink = message.formLinkId
      ? await this.prisma.patientFormLink.findUnique({ where: { id: message.formLinkId } })
      : null;
    const attempts = await this.prisma.patientOutboundAttempt.findMany({
      where: { messageId: id },
      orderBy: { createdAt: 'asc' },
    });
    const submission = formLink ? await this.resolveSubmission(formLink) : null;
    return { message, formLink, attempts, submission };
  }

  /**
   * Resolve the patient's submitted content for a form link. Order:
   *   1) formLink.submissionType/submissionId (authoritative, v3.2)
   *   2) latest EngagementEventLog FORM_SUBMITTED metadata.resultId (legacy fallback)
   */
  private async resolveSubmission(formLink: any): Promise<any | null> {
    let type: string | null = formLink.submissionType ?? null;
    let id: string | null = formLink.submissionId ?? null;
    let inferred = false;

    if (!type || !id) {
      const ev = await this.prisma.engagementEventLog.findFirst({
        where: { formLinkId: formLink.id, eventType: { in: ['FORM_SUBMITTED'] } },
        orderBy: { createdAt: 'desc' },
      });
      const meta: any = ev?.metadata || {};
      if (meta.resultType && meta.resultId) {
        type = type || meta.resultType;
        id = id || meta.resultId;
        inferred = true;
      } else if (meta.followUpId) {
        type = type || 'FollowUpRecord';
        id = id || meta.followUpId;
        inferred = true;
      }
    }
    if (!type || !id) return null;

    const submittedAt = formLink.submittedAt ?? null;
    try {
      if (type === 'QuestionnaireResult') {
        const r = await this.prisma.questionnaireResult.findUnique({ where: { id } });
        if (!r) return null;
        return {
          type, inferred, submittedAt: submittedAt ?? r.createdAt,
          data: {
            questionnaireType: r.questionnaireType, score: r.score, riskLevel: r.riskLevel,
            riskConclusion: r.riskConclusion, answers: r.answers, note: r.note, createdAt: r.createdAt,
          },
        };
      }
      if (type === 'VitalRecord') {
        const r = await this.prisma.vitalRecord.findUnique({ where: { id } });
        if (!r) return null;
        return {
          type, inferred, submittedAt: submittedAt ?? r.measuredAt,
          data: { vitalType: r.type, value: r.value, unit: r.unit, measuredAt: r.measuredAt, isAbnormal: r.isAbnormal, note: r.note },
        };
      }
      if (type === 'MedicationCheckIn') {
        const r = await this.prisma.medicationCheckIn.findUnique({ where: { id }, include: { medication: true } });
        if (!r) return null;
        return {
          type, inferred, submittedAt: submittedAt ?? r.checkedAt,
          data: {
            medicationName: r.medication?.medicationName ?? null, dosage: r.medication?.dosage ?? null,
            taken: r.taken, checkedAt: r.checkedAt, scheduledAt: r.scheduledAt, note: r.note,
          },
        };
      }
      if (type === 'HospitalVisitFeedback') {
        const r = await this.prisma.hospitalVisitFeedback.findUnique({ where: { id } });
        if (!r) return null;
        return {
          type, inferred, submittedAt: submittedAt ?? r.submittedAt,
          data: { action: r.action, note: r.note, submittedAt: r.submittedAt, hospitalVisitReminderId: r.hospitalVisitReminderId, taskId: r.taskId, riskAlertId: r.riskAlertId },
        };
      }
      if (type === 'FollowUpRecord') {
        const r = await this.prisma.followUpRecord.findUnique({ where: { id } });
        if (!r) return null;
        return {
          type, inferred, submittedAt: submittedAt ?? r.followUpTime,
          data: { action: r.result, note: r.suggestion, content: r.content, createdAt: r.followUpTime },
        };
      }
      if (type === 'PatientDirectMessage' || type === 'PatientDirectMessageAck') {
        const r = await this.prisma.patientDirectMessage.findUnique({ where: { id } });
        if (!r) return null;
        return {
          type: 'PatientDirectMessage', inferred, submittedAt: submittedAt ?? r.acknowledgedAt,
          data: { content: r.content, requiresAck: r.requiresAck, acknowledgedAt: r.acknowledgedAt },
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Audit({ mode: 'REQUIRED', action: 'RESEND_PATIENT_MESSAGE', target: 'PatientOutboundMessage', targetIdFrom: 'params.id', patientIdFrom: 'response.message.patientId' })
  @Post('messages/:id/resend')
  async resendMessage(
    @Param('id') id: string,
    @Body() dto: ResendEngagementMessageDto,
    @CurrentUser() user: RequestUser,
    @Req() req: any,
  ) {
    this.tenant.assertWriteAllowed(user);
    await this.tenant.assertMessageWritableToUser(id, user);

    const message = await this.prisma.patientOutboundMessage.findUnique({ where: { id } });
    if (!message) throw new NotFoundException('Message not found');
    if (!message.formLinkId) throw new ForbiddenException('该消息没有关联表单链接, 无法重发');
    const formLink = await this.prisma.patientFormLink.findUnique({ where: { id: message.formLinkId } });
    if (!formLink) throw new NotFoundException('Form link not found');
    // v3.2: resend reuses the same case (message). Do NOT implicitly create a
    // new link/case — if the link is no longer usable, fail clearly.
    if (formLink.status === 'REVOKED' || formLink.revokedAt) {
      throw new ForbiddenException('该链接已失效, 无法再次发送, 请重新创建随访案件.');
    }
    if (formLink.status === 'USED' || formLink.submitCount >= formLink.maxSubmit) {
      throw new ForbiddenException('该链接已被患者提交, 无需再次发送.');
    }
    if (formLink.status === 'EXPIRED' || (formLink.expiresAt && formLink.expiresAt.getTime() <= Date.now())) {
      throw new ForbiddenException('该链接已过期, 请重新创建随访案件.');
    }
    if (formLink.status !== 'ACTIVE') {
      throw new ForbiddenException('原链接状态已变更, 无法再次发送.');
    }
    const patient = await this.prisma.patient.findUnique({
      where: { id: message.patientId },
      include: {
        wechatIdentities: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const account = formLink.hospitalTenantId
      ? await this.accounts.getAccountForTenant(formLink.hospitalTenantId)
      : null;
    const scopedOpenId = (() => {
      if (!account) return null;
      const match = patient.wechatIdentities.find(
        (i) =>
          i.hospitalTenantId === formLink.hospitalTenantId &&
          i.appId === account.appId &&
          i.isVerified,
      );
      return match?.openId ?? null;
    })();

    // Default to AUTO so the system re-picks 本院服务号 / 短信兜底.
    let channel = (dto.preferredChannel as any) || 'AUTO';
    if (channel === 'AUTO') channel = scopedOpenId ? 'WECHAT_OFFICIAL_ACCOUNT' : 'SMS';
    if (channel === 'MANUAL_COPY') channel = scopedOpenId ? 'WECHAT_OFFICIAL_ACCOUNT' : 'SMS';

    const sendOutcome = await this.engagement.sendForLink({
      formLink: {
        id: formLink.id,
        patientId: formLink.patientId,
        type: formLink.type,
        title: formLink.title,
        description: formLink.description,
        hospitalTenantId: formLink.hospitalTenantId,
      },
      patient: { id: patient.id, phone: patient.phone, scopedOpenId },
      channel,
      linkUrl: message.linkUrl || this.formLink.buildLinkUrl('__expired__'),
      createdBy: user.id,
      // v3.2: reuse this message; append attempts instead of new rows.
      reuseMessageId: message.id,
      triggerReason: 'NURSE_RESEND',
    } as any);

    await this.audit.record({
      user,
      action: 'PATIENT_ENGAGEMENT_MESSAGE_RESENT',
      targetType: 'PatientOutboundMessage',
      targetId: id,
      ipAddress: req?.ip,
      afterData: { channel, formLinkId: formLink.id, reused: true },
    });
    return sendOutcome;
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Audit({ mode: 'REQUIRED', action: 'MARK_PATIENT_MESSAGE_MANUAL_SENT', target: 'PatientOutboundMessage', targetIdFrom: 'params.id', patientIdFrom: 'response.patientId' })
  @Post('messages/:id/mark-manual-sent')
  async markManualSent(
    @Param('id') id: string,
    @Body() dto: MarkManualSentDto,
    @CurrentUser() user: RequestUser,
    @Req() req: any,
  ) {
    this.tenant.assertWriteAllowed(user);
    await this.tenant.assertMessageWritableToUser(id, user);
    const message = await this.prisma.patientOutboundMessage.findUnique({ where: { id } });
    if (!message) throw new NotFoundException('Message not found');
    const updated = await this.prisma.patientOutboundMessage.update({
      where: { id },
      data: {
        channel: 'MANUAL_COPY',
        status: 'DISPATCH_ACCEPTED',
        sentAt: new Date(),
        providerMessageId: 'manual-copy',
        errorMessage: null,
      },
    });
    await this.prisma.careReminderOccurrence.updateMany({
      where: { outboundMessageId: id, status: 'MANUAL_ACTION_REQUIRED' },
      data: { status: 'DISPATCH_ACCEPTED', sentAt: new Date() },
    });
    await this.audit.record({
      user,
      action: 'PATIENT_ENGAGEMENT_MESSAGE_MANUAL_SENT',
      targetType: 'PatientOutboundMessage',
      targetId: id,
      ipAddress: req?.ip,
      afterData: { note: dto.note ?? null },
    });
    return updated;
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  private vitalLabel(type: string): string {
    const map: Record<string, string> = {
      BLOOD_PRESSURE: '血压',
      SYSTOLIC_BP: '血压',
      DIASTOLIC_BP: '血压',
      BLOOD_GLUCOSE: '血糖',
      WEIGHT: '体重',
      HEART_RATE: '心率',
      SPO2: '血氧',
    };
    return map[type] || type;
  }

  private publicLinkResponse(result: any) {
    return {
      formLink: {
        id: result.formLink.id,
        type: result.formLink.type,
        title: result.formLink.title,
        description: result.formLink.description,
        status: result.formLink.status,
        expiresAt: result.formLink.expiresAt,
        requiresIdentityCheck: result.formLink.requiresIdentityCheck,
        taskId: result.formLink.taskId,
        riskAlertId: result.formLink.riskAlertId,
      },
      // Plain token is only returned ONCE here. Frontend should copy it to clipboard.
      token: result.token,
      linkUrl: result.linkUrl,
      message: result.message
        ? {
            id: result.message.id,
            channel: result.message.channel,
            status: result.message.status,
            errorMessage: result.message.errorMessage,
            providerMessageId: result.message.providerMessageId,
            sentAt: result.message.sentAt,
          }
        : null,
      sendResult: result.sendResult,
    };
  }
}





