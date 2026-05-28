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
import { PrismaService } from '../prisma/prisma.service';
import { PatientEngagementService } from './patient-engagement.service';
import { FormLinkService } from './form-link.service';
import { HospitalWechatOfficialAccountService } from './hospital-wechat-account.service';
import { PatientEngagementTenantService } from './patient-engagement-tenant.service';
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
  @Post('form-links/:id/revoke')
  async revokeLink(
    @Param('id') id: string,
    @Body() dto: RevokeFormLinkDto,
    @CurrentUser() user: RequestUser,
    @Req() req: any,
  ) {
    this.tenant.assertWriteAllowed(user);
    await this.tenant.assertFormLinkVisibleToUser(id, user);
    const updated = await this.formLink.revoke(id, dto.reason, user.id);
    await this.prisma.engagementEventLog.create({
      data: {
        formLinkId: id,
        eventType: 'TOKEN_REVOKED',
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
          select: { id: true, type: true, status: true, expiresAt: true, usedAt: true, submitCount: true },
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
    } else if (user.role !== UserRole.ADMIN) {
      // Non-admin without a patient filter: limit to their tenant.
      const tenantId = await this.tenant.resolveUserHospitalTenantId(user);
      if (!tenantId) throw new ForbiddenException('当前用户未绑定 hospitalTenantId');
      where.hospitalTenantId = tenantId;
    }
    if (query.channel) where.channel = query.channel;
    if (query.status) where.status = query.status;
    if (query.messageType) where.messageType = query.messageType;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    return this.prisma.patientOutboundMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { patient: { select: { id: true, name: true, hospitalPatientId: true } } },
    });
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('messages/:id/resend')
  async resendMessage(
    @Param('id') id: string,
    @Body() dto: ResendEngagementMessageDto,
    @CurrentUser() user: RequestUser,
    @Req() req: any,
  ) {
    this.tenant.assertWriteAllowed(user);
    await this.tenant.assertMessageVisibleToUser(id, user);

    const message = await this.prisma.patientOutboundMessage.findUnique({ where: { id } });
    if (!message) throw new NotFoundException('Message not found');
    if (!message.formLinkId) throw new ForbiddenException('该消息没有关联表单链接, 无法重发');
    const formLink = await this.prisma.patientFormLink.findUnique({ where: { id: message.formLinkId } });
    if (!formLink) throw new NotFoundException('Form link not found');
    if (formLink.status !== 'ACTIVE') {
      throw new ForbiddenException('原链接状态已变更, 请先撤销并重新生成');
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

    const channel = (dto.preferredChannel as any) || message.channel;
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
    });

    await this.audit.record({
      user,
      action: 'PATIENT_ENGAGEMENT_MESSAGE_RESENT',
      targetType: 'PatientOutboundMessage',
      targetId: id,
      ipAddress: req?.ip,
      afterData: { channel, formLinkId: formLink.id },
    });
    return sendOutcome;
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('messages/:id/mark-manual-sent')
  async markManualSent(
    @Param('id') id: string,
    @Body() dto: MarkManualSentDto,
    @CurrentUser() user: RequestUser,
    @Req() req: any,
  ) {
    this.tenant.assertWriteAllowed(user);
    await this.tenant.assertMessageVisibleToUser(id, user);
    const message = await this.prisma.patientOutboundMessage.findUnique({ where: { id } });
    if (!message) throw new NotFoundException('Message not found');
    const updated = await this.prisma.patientOutboundMessage.update({
      where: { id },
      data: {
        channel: 'MANUAL_COPY',
        status: 'SENT',
        sentAt: new Date(),
        providerMessageId: 'manual-copy',
        errorMessage: null,
      },
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
