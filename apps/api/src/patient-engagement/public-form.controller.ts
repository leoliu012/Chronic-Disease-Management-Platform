import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import * as crypto from 'crypto';
import {
  DataSource,
  HospitalVisitReminderStatus,
  RiskLevel,
  TaskStatus,
} from '@prisma/client';
import { Public } from '../security/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { FormLinkService } from './form-link.service';
import { PatientEngagementService } from './patient-engagement.service';
import { WechatOfficialAccountService } from './wechat-official-account.service';
import { HospitalWechatOfficialAccountService } from './hospital-wechat-account.service';
import { ClinicalDispositionService } from '../clinical-disposition/clinical-disposition.service';
import {
  ClinicalRulesService,
  type ClinicalRuleTrace,
} from '../clinical-rules/clinical-rules.service';
import {
  IdentityCheckDto,
  SubmitPublicHospitalVisitDto,
  SubmitPublicMedicationCheckInDto,
  SubmitPublicQuestionnaireDto,
  SubmitPublicVitalDto,
} from './dto/submit-public.dto';

type PublicVitalRuleEvaluation = {
  isAbnormal: boolean;
  riskLevel: RiskLevel;
  trigger: string;
  followUpDueWithinHours?: number;
  followUpTaskTitle?: string;
  ruleTrace: ClinicalRuleTrace;
};

type PublicVitalSubmissionContext = {
  expectedVitalType: string;
  canonicalUnit: string;
  monitoringPlanId?: string;
  measuredAt: Date;
  receivedAt: Date;
  occurrence?: {
    id: string;
    dueAt: Date;
    availableFrom: Date;
    availableUntil: Date;
  };
};

const PUBLIC_FORM_FUTURE_GRACE_MS = 10 * 60 * 1000;
const PUBLIC_FORM_OCCURRENCE_GRACE_MS = 10 * 60 * 1000;
const PUBLIC_FORM_MANUAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * PublicFormController (v2)
 *
 *   GET  /public-forms/:token                        → 表单元数据 + 医院信息
 *   POST /public-forms/:token/identity-check         → 二次校验
 *   POST /public-forms/:token/questionnaire          → 提交问卷
 *   POST /public-forms/:token/vitals                 → 提交复测
 *   POST /public-forms/:token/medication-checkin     → 用药打卡
 *   POST /public-forms/:token/hospital-visit-confirm → 到院反馈
 *
 * v2 关键变化:
 *   - 每个 submit 都先在 $transaction 内 claimForSubmission, 再写业务数据.
 *     这样保证 "提交一次链接 = 写一条业务数据" 强一致.
 *   - GET 返回包括 hospital: { id, name, displayName, serviceAccountName }
 *   - 文案 "医院慢病管理团队" 取自医院租户 displayName.
 */
@Public()
@Controller('public-forms')
export class PublicFormController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly formLink: FormLinkService,
    private readonly engagement: PatientEngagementService,
    private readonly wechat: WechatOfficialAccountService,
    private readonly accounts: HospitalWechatOfficialAccountService,
    private readonly disposition: ClinicalDispositionService,
    private readonly clinicalRules: ClinicalRulesService,
  ) {}

  // ---------------------------------------------------------------------------
  // v3: shared helper to mark a CareReminderOccurrence COMPLETED inside the
  // same transaction as the business write. Done inline (rather than calling
  // out to CareRemindersModule) to avoid a circular module dependency.
  // No-op if the form link has no associated occurrence.
  // ---------------------------------------------------------------------------
  // v3.2: record the authoritative submission linkage on the form link so
  // the message-detail API can resolve the patient's exact submitted content.
  private async _linkSubmissionInTx(
    tx: any,
    formLinkId: string,
    submissionType: string,
    submissionId: string,
    requiresManualReview = true,
  ): Promise<void> {
    const submittedAt = new Date();
    await tx.patientFormLink.update({
      where: { id: formLinkId },
      data: {
        submissionType,
        submissionId,
        submittedAt,
        ...(requiresManualReview
          ? {
              manualReviewStatus: 'PENDING',
              manualReviewDueAt: new Date(submittedAt.getTime() + this.submissionReviewSlaHours() * 60 * 60 * 1000),
              manualReviewedAt: null,
              manualReviewedBy: null,
              manualReviewNote: null,
            }
          : {}),
      },
    });
  }

  private async _tryCompleteOccurrenceInTx(
    tx: any,
    formLinkId: string,
    resultType: string,
    resultId: string,
  ): Promise<void> {
    // Use a guarded updateMany so concurrent submissions (race against the
    // form-link claim) don't double-write the COMPLETED transition.
    await tx.careReminderOccurrence.updateMany({
      where: {
        formLinkId,
        status: { notIn: ['COMPLETED', 'CANCELED'] },
      },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        resultType,
        resultId,
      },
    });
  }


  // ---------------------------------------------------------------------------
  // v3 care-reminder medication links may intentionally omit medicationId from
  // the request body. The link payload already contains it. This keeps the H5 UI
  // elderly-friendly: patients only tap "taken / not taken".
  // ---------------------------------------------------------------------------
  private resolveMedicationIdForPublicCheckIn(
    dto: SubmitPublicMedicationCheckInDto,
    formLink: { payload: unknown },
  ): string {
    const payload: any = formLink.payload || {};
    const expectedMedicationId =
      payload.medicationId ||
      (payload.sourceType === 'MEDICATION' ? payload.sourceId : null);

    if (!expectedMedicationId || typeof expectedMedicationId !== 'string') {
      throw new BadRequestException({
        code: 'MEDICATION_LINK_REISSUE_REQUIRED',
        message: '用药打卡链接缺少服务端用药计划信息，请联系医院重新发送。',
      });
    }

    if (dto.medicationId && dto.medicationId !== expectedMedicationId) {
      throw new BadRequestException({
        code: 'MEDICATION_LINK_MISMATCH',
        message: '提交的用药计划与链接不一致。',
      });
    }

    return expectedMedicationId;
  }

  private parsePatientReportedTime(
    value: string | undefined,
    label: string,
    receivedAt: Date,
    earliest: Date,
    latest: Date,
  ): Date {
    const reportedAt = value ? new Date(value) : receivedAt;
    if (Number.isNaN(reportedAt.getTime())) {
      throw new BadRequestException(`${label} 时间格式无效`);
    }
    if (reportedAt.getTime() < earliest.getTime() || reportedAt.getTime() > latest.getTime()) {
      throw new BadRequestException({
        code: 'PATIENT_REPORTED_TIME_OUT_OF_WINDOW',
        message: `${label} 超出链接允许的提交时间范围。`,
      });
    }
    return reportedAt;
  }

  private normalizedUnit(value?: string | null): string {
    return String(value ?? '').trim().toLowerCase();
  }

  private assertSameUnit(received: string | undefined, expected: string): void {
    if (received && this.normalizedUnit(received) !== this.normalizedUnit(expected)) {
      throw new BadRequestException({
        code: 'VITAL_UNIT_MISMATCH',
        message: `指标单位不匹配，应使用 ${expected}。`,
      });
    }
  }

  private assertPhysiologicRange(type: string, value: number): void {
    const ranges: Record<string, [number, number]> = {
      SYSTOLIC_BP: [50, 280],
      DIASTOLIC_BP: [30, 180],
      BLOOD_GLUCOSE: [1, 40],
      WEIGHT: [2, 400],
      HEART_RATE: [20, 250],
      SPO2: [50, 100],
    };
    const range = ranges[type];
    if (range && (value < range[0] || value > range[1])) {
      throw new BadRequestException({
        code: 'VITAL_VALUE_IMPLAUSIBLE',
        message: `${this.vitalLabel(type)}数值超出生理合理范围。`,
      });
    }
  }

  private async resolvePublicVitalSubmissionContext(
    formLink: { id: string; patientId: string; payload: unknown },
    dto: SubmitPublicVitalDto,
  ): Promise<PublicVitalSubmissionContext> {
    const payload: any = formLink.payload || {};
    const expectedVitalType = String(payload.expectedVitalType ?? payload.vitalType ?? '')
      .trim()
      .toUpperCase();
    const canonicalUnit = String(payload.canonicalUnit ?? payload.unit ?? '').trim();
    if (!expectedVitalType || !canonicalUnit) {
      throw new BadRequestException({
        code: 'VITAL_LINK_REISSUE_REQUIRED',
        message: '该指标复测链接缺少服务端指标类型或标准单位，请联系医院重新发送。',
      });
    }
    if (dto.vitalType && String(dto.vitalType).trim().toUpperCase() !== expectedVitalType) {
      throw new BadRequestException({
        code: 'VITAL_TYPE_MISMATCH',
        message: '提交的指标类型与复测链接不一致。',
      });
    }
    this.assertSameUnit(dto.unit, canonicalUnit);

    const occurrenceId = String(payload.occurrenceId ?? payload.careReminderOccurrenceId ?? '').trim();
    const occurrence = occurrenceId
      ? await this.prisma.careReminderOccurrence.findUnique({
          where: { id: occurrenceId },
          select: { id: true, patientId: true, dueAt: true, availableFrom: true, availableUntil: true },
        })
      : null;
    if (occurrenceId && (!occurrence || occurrence.patientId !== formLink.patientId)) {
      throw new BadRequestException({
        code: 'VITAL_OCCURRENCE_MISMATCH',
        message: '指标复测链接关联的提醒记录无效，请联系医院重新发送。',
      });
    }

    const receivedAt = new Date();
    const earliest = occurrence
      ? new Date(occurrence.availableFrom.getTime() - PUBLIC_FORM_OCCURRENCE_GRACE_MS)
      : new Date(receivedAt.getTime() - PUBLIC_FORM_MANUAL_MAX_AGE_MS);
    const occurrenceLatest = occurrence
      ? new Date(occurrence.availableUntil.getTime() + PUBLIC_FORM_OCCURRENCE_GRACE_MS)
      : new Date(receivedAt.getTime() + PUBLIC_FORM_FUTURE_GRACE_MS);
    const latest = new Date(
      Math.min(
        occurrenceLatest.getTime(),
        receivedAt.getTime() + PUBLIC_FORM_FUTURE_GRACE_MS,
      ),
    );
    const measuredAt = this.parsePatientReportedTime(dto.measuredAt, '测量时间', receivedAt, earliest, latest);

    const monitoringPlanId = String(payload.monitoringPlanId ?? payload.vitalPlanId ?? '').trim() || undefined;
    if (monitoringPlanId) {
      const plan = await this.prisma.vitalMonitoringPlan.findUnique({ where: { id: monitoringPlanId } });
      if (
        !plan ||
        plan.patientId !== formLink.patientId ||
        String(plan.vitalType).trim().toUpperCase() !== expectedVitalType ||
        this.normalizedUnit(plan.unit) !== this.normalizedUnit(canonicalUnit)
      ) {
        throw new BadRequestException({
          code: 'VITAL_PLAN_MISMATCH',
          message: '指标复测链接与监测计划不一致，请联系医院重新发送。',
        });
      }
    }

    return {
      expectedVitalType,
      canonicalUnit,
      monitoringPlanId,
      measuredAt,
      receivedAt,
      ...(occurrence
        ? {
            occurrence: {
              id: occurrence.id,
              dueAt: occurrence.dueAt,
              availableFrom: occurrence.availableFrom,
              availableUntil: occurrence.availableUntil,
            },
          }
        : {}),
    };
  }

  private async resolveMedicationScheduledAt(
    formLink: { patientId: string; payload: unknown },
    dto: SubmitPublicMedicationCheckInDto,
    receivedAt: Date,
  ): Promise<Date | undefined> {
    const payload: any = formLink.payload || {};
    const occurrenceId = String(payload.occurrenceId ?? payload.careReminderOccurrenceId ?? '').trim();
    if (occurrenceId) {
      const occurrence = await this.prisma.careReminderOccurrence.findUnique({
        where: { id: occurrenceId },
        select: { patientId: true, dueAt: true },
      });
      if (!occurrence || occurrence.patientId !== formLink.patientId) {
        throw new BadRequestException({
          code: 'MEDICATION_OCCURRENCE_MISMATCH',
          message: '用药打卡链接关联的提醒记录无效，请联系医院重新发送。',
        });
      }
      if (dto.scheduledAt) {
        const clientScheduledAt = new Date(dto.scheduledAt);
        if (
          Number.isNaN(clientScheduledAt.getTime()) ||
          Math.abs(clientScheduledAt.getTime() - occurrence.dueAt.getTime()) > PUBLIC_FORM_OCCURRENCE_GRACE_MS
        ) {
          throw new BadRequestException({
            code: 'MEDICATION_SCHEDULE_MISMATCH',
            message: '提交的服药计划时间与提醒链接不一致。',
          });
        }
      }
      return occurrence.dueAt;
    }

    if (!dto.scheduledAt) return undefined;
    return this.parsePatientReportedTime(
      dto.scheduledAt,
      '计划服药时间',
      receivedAt,
      new Date(receivedAt.getTime() - PUBLIC_FORM_MANUAL_MAX_AGE_MS),
      new Date(receivedAt.getTime() + PUBLIC_FORM_FUTURE_GRACE_MS),
    );
  }

  // ---------------------------------------------------------------------------
  // GET /public-forms/:token
  // ---------------------------------------------------------------------------

  @Get(':token')
  async getFormByToken(@Param('token') token: string, @Req() req: any) {
    const formLink = await this.formLink.resolveByToken(token);
    const patient = await this.prisma.patient.findUnique({
      where: { id: formLink.patientId },
      include: { hospitalTenant: true },
    });

    const tenant = patient?.hospitalTenant;
    const serviceAccount = tenant
      ? await this.accounts.getAccountForTenant(tenant.id)
      : null;

    await this.prisma.engagementEventLog.create({
      data: {
        patientId: formLink.patientId,
        formLinkId: formLink.id,
        eventType: 'LINK_OPENED',
        ipAddress: req?.ip,
        userAgent: req?.headers?.['user-agent']?.slice?.(0, 500),
      },
    });

    if (formLink.status === 'ACTIVE') {
      await this.engagement.markClicked(formLink.id, {
        ipAddress: req?.ip,
        userAgent: req?.headers?.['user-agent']?.slice?.(0, 500),
      });
    }

    return {
      valid: formLink.status === 'ACTIVE',
      status: formLink.status,
      // v3.2: surface revoke reason so the H5 page can show a friendly
      // "该提醒已失效" message instead of a raw token error.
      revokeReason: formLink.revokeReason ?? null,
      type: formLink.type,
      title: formLink.title,
      description: formLink.description,
      expiresAt: formLink.expiresAt,
      requiresIdentityCheck: formLink.requiresIdentityCheck,
      payload: formLink.payload,
      patientMaskedName: this.maskName(patient?.name || ''),
      patientGender: patient?.gender || null,
      // v2: explicit hospital block — frontend uses these to brand the H5 page.
      hospital: tenant
        ? {
            id: tenant.id,
            name: tenant.name,
            displayName: tenant.displayName ?? tenant.name,
            serviceAccountName: serviceAccount?.accountName ?? null,
          }
        : null,
      hospitalDisplayName:
        tenant?.displayName || tenant?.name || '本院慢病管理团队',
    };
  }

  // ---------------------------------------------------------------------------
  // POST /public-forms/:token/identity-check
  // ---------------------------------------------------------------------------

  @Post(':token/identity-check')
  async identityCheck(@Param('token') token: string, @Body() dto: IdentityCheckDto, @Req() req: any) {
    const formLink = await this.formLink.resolveByToken(token);
    this.formLink.ensureUsable(formLink);
    const patient = await this.prisma.patient.findUnique({ where: { id: formLink.patientId } });
    if (!patient) throw new NotFoundException({ code: 'PATIENT_NOT_FOUND', message: '患者档案不存在' });

    const phoneLast4 = patient.phone ? patient.phone.slice(-4) : null;
    const idCardLast4 = patient.idCardNo ? patient.idCardNo.slice(-4) : null;

    let passed = false;
    if (dto.phoneLast4 && phoneLast4 && dto.phoneLast4.trim() === phoneLast4) passed = true;
    if (!passed && dto.idCardLast4 && idCardLast4 && dto.idCardLast4.trim().toUpperCase() === idCardLast4.toUpperCase()) passed = true;
    if (!passed && dto.birthDate && patient.birthDate) {
      const submitted = String(dto.birthDate).slice(0, 10);
      const onFile = patient.birthDate.toISOString().slice(0, 10);
      if (submitted === onFile) passed = true;
    }

    if (!passed) {
      await this.formLink.recordIdentityFailure(formLink.id);
      await this.prisma.engagementEventLog.create({
        data: {
          patientId: formLink.patientId,
          formLinkId: formLink.id,
          eventType: 'IDENTITY_CHECK_FAILED',
          ipAddress: req?.ip,
        },
      });
      throw new ForbiddenException({ code: 'IDENTITY_CHECK_FAILED', message: '身份校验失败, 请确认填写信息是否与登记一致.' });
    }

    await this.prisma.engagementEventLog.create({
      data: {
        patientId: formLink.patientId,
        formLinkId: formLink.id,
        eventType: 'IDENTITY_CHECK_PASSED',
        ipAddress: req?.ip,
      },
    });

    const formSessionToken = this.issueFormSessionToken(formLink.id);
    return { passed: true, formSessionToken, formSessionExpiresInSec: 15 * 60 };
  }

  // ---------------------------------------------------------------------------
  // submit handlers — each one atomically claims the form link first
  // ---------------------------------------------------------------------------

  @Post(':token/questionnaire')
  async submitQuestionnaire(
    @Param('token') token: string,
    @Body() dto: SubmitPublicQuestionnaireDto,
    @Req() req: any,
  ) {
    const formLink = await this.formLink.resolveByToken(token);
    this.formLink.ensureUsable(formLink);
    if (formLink.type !== 'QUESTIONNAIRE') {
      throw new BadRequestException({ code: 'TYPE_MISMATCH', message: '链接类型与提交内容不一致' });
    }
    if (formLink.requiresIdentityCheck) this.assertFormSession(formLink.id, dto.formSessionToken);

    const payload: any = formLink.payload || {};
    const questionnaireType = String(payload.questionnaireType || 'GENERIC');
    // The patient submits answers only. Both rawScore and normalized score are
    // calculated from the immutable scoring contract captured when this link
    // was issued. Pre-hotfix links are intentionally rejected and must be resent.
    const evaluation = this.clinicalRules.evaluateIssuedQuestionnaireSubmission({
      questionnaireType,
      answers: dto.answers,
      questionnaireRuleSnapshot: payload.questionnaireRuleSnapshot,
    });
    const { rawScore, score } = evaluation;

    const result = await this.prisma.$transaction(async (tx) => {
      // Bug 4 fix: atomic claim BEFORE any business write.
      await this.formLink.claimForSubmission(tx, formLink.id);

      const qr = await tx.questionnaireResult.create({
        data: {
          patientId: formLink.patientId,
          questionnaireType,
          rawScore,
          score,
          riskLevel: evaluation.riskLevel,
          riskConclusion: evaluation.riskConclusion,
          answers: dto.answers as any,
          dataSource: DataSource.MINI_PROGRAM, // reuse — schema has no H5_LINK yet
          note: this.composeNote('H5_LINK questionnaire submission', dto.note),
        },
      });

      let alertId: string | null = null;
      if (evaluation.shouldCreateAlert) {
        const patient = await tx.patient.findUnique({ where: { id: formLink.patientId } });
        const dueAt = this.dueAtFromHours(evaluation.followUpDueWithinHours);
        const disposition = await this.disposition.signalRisk(tx, {
          patientId: formLink.patientId,
          riskCategory: 'QUESTIONNAIRE_HIGH_RISK',
          correlationKey: `QUESTIONNAIRE_HIGH_RISK:${questionnaireType}`,
          riskLevel: evaluation.riskLevel,
          title: `问卷高风险: ${questionnaireType}`,
          description: `H5 链接提交，评分 ${score}。${evaluation.riskConclusion}`,
          triggerRule: `版本化问卷规则：${evaluation.ruleTrace.ruleVersion ?? 'unknown'}`,
          sourceQuestionnaireResultId: qr.id,
          evidence: { sourceType: 'QuestionnaireResult', questionnaireResultId: qr.id, questionnaireType, rawScore, score, formLinkId: formLink.id },
          ruleTrace: evaluation.ruleTrace,
          taskTitle: evaluation.followUpTaskTitle,
          taskType: 'QUESTIONNAIRE_REVIEW',
          dueAt,
          assigneeId: patient?.responsibleNurseId,
        });
        alertId = disposition.alert.id;
      }

      // Update PatientOutboundMessage → SUBMITTED inside the same tx so a
      // failed downstream write rolls back the SUBMITTED status too.
      await tx.patientOutboundMessage.updateMany({
        where: { formLinkId: formLink.id, status: { in: ['SENT', 'PENDING', 'CLICKED'] } },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });

      // v3: mark linked CareReminderOccurrence COMPLETED (no-op if none).
      await this._linkSubmissionInTx(tx, formLink.id, 'QuestionnaireResult', qr.id);
      await this._tryCompleteOccurrenceInTx(tx, formLink.id, 'QuestionnaireResult', qr.id);

      return { questionnaireResult: qr, alertId };
    });

    // Out-of-tx event log (informational only).
    await this.prisma.engagementEventLog.create({
      data: {
        patientId: formLink.patientId,
        formLinkId: formLink.id,
        eventType: 'FORM_SUBMITTED',
        ipAddress: req?.ip,
        metadata: {
          questionnaireResultId: result.questionnaireResult.id,
          rawScore,
          score,
          riskLevel: evaluation.riskLevel,
        } as any,
      },
    });

    return {
      ok: true,
      message: '提交成功, 感谢您的配合.',
      questionnaireResultId: result.questionnaireResult.id,
      riskLevel: evaluation.riskLevel,
    };
  }

  @Post(':token/vitals')
  async submitVital(@Param('token') token: string, @Body() dto: SubmitPublicVitalDto, @Req() req: any) {
    const formLink = await this.formLink.resolveByToken(token);
    this.formLink.ensureUsable(formLink);
    if (formLink.type !== 'VITAL_RECHECK') {
      throw new BadRequestException({ code: 'TYPE_MISMATCH', message: '链接类型与提交内容不一致' });
    }
    if (formLink.requiresIdentityCheck) this.assertFormSession(formLink.id, dto.formSessionToken);

    const context = await this.resolvePublicVitalSubmissionContext(formLink, dto);
    const {
      expectedVitalType,
      canonicalUnit: unit,
      monitoringPlanId,
      measuredAt,
      receivedAt,
      occurrence,
    } = context;
    const patient = await this.prisma.patient.findUnique({ where: { id: formLink.patientId }, include: { diseaseProfiles: true } });
    if (!patient) throw new NotFoundException('患者不存在');

    const created: any[] = [];
    const alerts: string[] = [];

    if (expectedVitalType === 'BLOOD_PRESSURE') {
      const systolic = Number(dto.systolic);
      const diastolic = Number(dto.diastolic);
      if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) {
        throw new BadRequestException('血压必须填写收缩压与舒张压');
      }
      this.assertPhysiologicRange('SYSTOLIC_BP', systolic);
      this.assertPhysiologicRange('DIASTOLIC_BP', diastolic);
      if (systolic < diastolic) {
        throw new BadRequestException({
          code: 'BLOOD_PRESSURE_IMPLAUSIBLE',
          message: '收缩压不能低于舒张压。',
        });
      }
      const [systolicEval, diastolicEval] = await Promise.all([
        this.evaluateConfiguredVital(patient, 'SYSTOLIC_BP', systolic, unit, measuredAt),
        this.evaluateConfiguredVital(patient, 'DIASTOLIC_BP', diastolic, unit, measuredAt),
      ]);
      const worst = this.worstEvaluation([systolicEval, diastolicEval]);

      await this.prisma.$transaction(async (tx) => {
        await this.formLink.claimForSubmission(tx, formLink.id);
        const common = {
          patientId: formLink.patientId,
          unit,
          measuredAt,
          receivedAt,
          dataSource: DataSource.MINI_PROGRAM,
          note: this.composeNote('H5_LINK vital_recheck', dto.note),
          ...(monitoringPlanId ? { monitoringPlanId } : {}),
          ...(occurrence ? { scheduledAt: occurrence.dueAt } : {}),
        };
        const sysRec = await tx.vitalRecord.create({
          data: { ...common, type: 'SYSTOLIC_BP', value: systolic, isAbnormal: systolicEval.isAbnormal },
        });
        const diaRec = await tx.vitalRecord.create({
          data: { ...common, type: 'DIASTOLIC_BP', value: diastolic, isAbnormal: diastolicEval.isAbnormal },
        });
        created.push(sysRec, diaRec);
        if (monitoringPlanId) {
          await tx.vitalMonitoringPlan.update({ where: { id: monitoringPlanId }, data: { lastCheckInAt: measuredAt } });
        }
        if (worst.isAbnormal) {
          const disposition = await this.disposition.signalRisk(tx, {
            patientId: formLink.patientId,
            riskCategory: 'VITAL_ABNORMAL',
            correlationKey: 'VITAL_ABNORMAL:BLOOD_PRESSURE',
            riskLevel: worst.riskLevel,
            title: '异常健康指标: 血压',
            description: `H5 链接提交: 血压 ${systolic}/${diastolic} ${unit}; ${worst.trigger}`,
            triggerRule: worst.trigger,
            sourceVitalRecordId: sysRec.id,
            evidence: { sourceType: 'VitalRecord', vitalRecordIds: [sysRec.id, diaRec.id], vitalType: 'BLOOD_PRESSURE', systolic, diastolic, unit, measuredAt, receivedAt, formLinkId: formLink.id },
            ruleTrace: worst.ruleTrace,
            taskTitle: worst.followUpTaskTitle ?? '异常健康指标: 血压',
            taskType: 'RISK_ALERT_FOLLOW_UP',
            dueAt: this.dueAtFromHours(worst.followUpDueWithinHours),
            assigneeId: patient.responsibleNurseId,
          });
          alerts.push(disposition.alert.id);
        }
        await this.completeVitalSubmissionInTx(tx, formLink.id, sysRec.id);
      });
    } else {
      const value = Number(dto.value);
      if (!Number.isFinite(value)) throw new BadRequestException('请输入有效的指标数值');
      this.assertPhysiologicRange(expectedVitalType, value);
      const evaluation = await this.evaluateConfiguredVital(patient, expectedVitalType, value, unit, measuredAt);
      await this.prisma.$transaction(async (tx) => {
        await this.formLink.claimForSubmission(tx, formLink.id);
        const rec = await tx.vitalRecord.create({
          data: {
            patientId: formLink.patientId,
            type: expectedVitalType,
            value,
            unit,
            measuredAt,
            receivedAt,
            dataSource: DataSource.MINI_PROGRAM,
            isAbnormal: evaluation.isAbnormal,
            note: this.composeNote('H5_LINK vital_recheck', dto.note),
            ...(monitoringPlanId ? { monitoringPlanId } : {}),
            ...(occurrence ? { scheduledAt: occurrence.dueAt } : {}),
          },
        });
        created.push(rec);
        if (monitoringPlanId) {
          await tx.vitalMonitoringPlan.update({ where: { id: monitoringPlanId }, data: { lastCheckInAt: measuredAt } });
        }
        if (evaluation.isAbnormal) {
          const disposition = await this.disposition.signalRisk(tx, {
            patientId: formLink.patientId,
            riskCategory: 'VITAL_ABNORMAL',
            correlationKey: `VITAL_ABNORMAL:${expectedVitalType}`,
            riskLevel: evaluation.riskLevel,
            title: `异常健康指标: ${this.vitalLabel(expectedVitalType)}`,
            description: `H5 链接提交: ${this.vitalLabel(expectedVitalType)} ${value} ${unit}; ${evaluation.trigger}`,
            triggerRule: evaluation.trigger,
            sourceVitalRecordId: rec.id,
            evidence: { sourceType: 'VitalRecord', vitalRecordId: rec.id, vitalType: expectedVitalType, value, unit, measuredAt, receivedAt, formLinkId: formLink.id },
            ruleTrace: evaluation.ruleTrace,
            taskTitle: evaluation.followUpTaskTitle ?? `异常健康指标: ${this.vitalLabel(expectedVitalType)}`,
            taskType: 'RISK_ALERT_FOLLOW_UP',
            dueAt: this.dueAtFromHours(evaluation.followUpDueWithinHours),
            assigneeId: patient.responsibleNurseId,
          });
          alerts.push(disposition.alert.id);
        }
        await this.completeVitalSubmissionInTx(tx, formLink.id, rec.id);
      });
    }

    await this.prisma.engagementEventLog.create({
      data: { patientId: formLink.patientId, formLinkId: formLink.id, eventType: 'FORM_SUBMITTED', ipAddress: req?.ip, metadata: { vitalRecordIds: created.map((c) => c.id), generatedAlertIds: alerts } as any },
    });
    return { ok: true, message: '提交成功, 感谢您的配合.', vitalRecordIds: created.map((c) => c.id), alertCount: alerts.length };
  }

  @Post(':token/medication-checkin')
  async submitMedicationCheckIn(
    @Param('token') token: string,
    @Body() dto: SubmitPublicMedicationCheckInDto,
    @Req() req: any,
  ) {
    const formLink = await this.formLink.resolveByToken(token);
    this.formLink.ensureUsable(formLink);
    if (formLink.type !== 'MEDICATION_CHECKIN') {
      throw new BadRequestException({ code: 'TYPE_MISMATCH', message: '链接类型与提交内容不一致' });
    }
    if (formLink.requiresIdentityCheck) this.assertFormSession(formLink.id, dto.formSessionToken);

    const medicationId = this.resolveMedicationIdForPublicCheckIn(dto, formLink);
    const medication = await this.prisma.medicationRecord.findUnique({ where: { id: medicationId } });
    if (!medication || medication.patientId !== formLink.patientId) {
      throw new NotFoundException('用药计划不存在');
    }

    const receivedAt = new Date();
    const checkedAt = this.parsePatientReportedTime(
      dto.checkedAt,
      '服药打卡时间',
      receivedAt,
      new Date(receivedAt.getTime() - PUBLIC_FORM_MANUAL_MAX_AGE_MS),
      new Date(receivedAt.getTime() + PUBLIC_FORM_FUTURE_GRACE_MS),
    );
    const scheduledAt = await this.resolveMedicationScheduledAt(formLink, dto, receivedAt);

    const result = await this.prisma.$transaction(async (tx) => {
      await this.formLink.claimForSubmission(tx, formLink.id);

      const checkIn = await tx.medicationCheckIn.create({
        data: {
          medicationId: medication.id,
          patientId: formLink.patientId,
          taken: dto.taken,
          checkedAt,
          scheduledAt,
          note: this.composeNote('H5_LINK medication_checkin', dto.note),
        },
      });
      await tx.medicationRecord.update({
        where: { id: medication.id },
        data: { lastCheckInAt: checkedAt },
      });

      // A single missed dose is retained as evidence. Sustained adherence
      // below 70% over 30 days becomes a patient-level NextBestAction during
      // the CarePlan refresh pass; reminder occurrence escalation remains
      // available for time-sensitive workflows.
      const alertId: string | null = null;

      await tx.patientOutboundMessage.updateMany({
        where: { formLinkId: formLink.id, status: { in: ['SENT', 'PENDING', 'CLICKED'] } },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });

      // v3: mark linked CareReminderOccurrence COMPLETED (no-op if none).
      await this._linkSubmissionInTx(tx, formLink.id, 'MedicationCheckIn', checkIn.id);
      await this._tryCompleteOccurrenceInTx(tx, formLink.id, 'MedicationCheckIn', checkIn.id);

      return { checkIn, alertId };
    });

    await this.prisma.engagementEventLog.create({
      data: {
        patientId: formLink.patientId,
        formLinkId: formLink.id,
        eventType: 'FORM_SUBMITTED',
        ipAddress: req?.ip,
        metadata: { checkInId: result.checkIn.id, taken: dto.taken } as any,
      },
    });

    return {
      ok: true,
      message: dto.taken ? '已记录本次服药' : '已记录本次反馈，管理团队会结合近期依从性持续评估。',
      checkInId: result.checkIn.id,
    };
  }

  @Post(':token/hospital-visit-confirm')
  async submitHospitalVisitConfirm(
    @Param('token') token: string,
    @Body() dto: SubmitPublicHospitalVisitDto,
    @Req() req: any,
  ) {
    const formLink = await this.formLink.resolveByToken(token);
    this.formLink.ensureUsable(formLink);
    if (formLink.type !== 'HOSPITAL_VISIT_CONFIRM') {
      throw new BadRequestException({ code: 'TYPE_MISMATCH', message: '链接类型与提交内容不一致' });
    }
    if (formLink.requiresIdentityCheck) this.assertFormSession(formLink.id, dto.formSessionToken);

    const action = String(dto.action || '').toUpperCase();
    if (!['WILL_VISIT', 'ARRIVED', 'CANNOT_VISIT', 'REFUSED'].includes(action)) {
      throw new BadRequestException('action 必须是 WILL_VISIT / ARRIVED / CANNOT_VISIT / REFUSED');
    }

    const payload: any = formLink.payload || {};
    const reminderId: string | undefined = payload.hospitalVisitReminderId || undefined;

    const result = await this.prisma.$transaction(async (tx) => {
      await this.formLink.claimForSubmission(tx, formLink.id);

      const followUp = await tx.followUpRecord.create({
        data: {
          patientId: formLink.patientId,
          followUpType: 'PATIENT_VISIT_FEEDBACK',
          followUpTime: new Date(),
          content: `患者通过 H5 链接反馈到院安排: ${this.visitActionLabel(action)}`,
          result: action,
          suggestion: dto.note ?? null,
        },
      });

      let taskCreated: any = null;
      let reminderUpdated: any = null;
      let sourceReminder: any = null;
      if (reminderId) {
        const reminder = await tx.hospitalVisitReminder.findUnique({ where: { id: reminderId } });
        sourceReminder = reminder;
        if (reminder && reminder.status === HospitalVisitReminderStatus.ACTIVE) {
          if (action === 'ARRIVED') {
            reminderUpdated = await tx.hospitalVisitReminder.update({
              where: { id: reminderId },
              data: { outcomeNote: `[患者反馈] 已到院 · ${dto.note ?? ''}`.slice(0, 500) },
            });
          } else if (action === 'CANNOT_VISIT' || action === 'REFUSED') {
            if (reminder.sourceRiskAlertId) {
              await this.disposition.markAlertInProgress(
                tx,
                reminder.sourceRiskAlertId,
                reminder.remindedBy,
                action === 'REFUSED' ? '患者通过 H5 反馈拒绝到院，需要继续人工跟进。' : '患者通过 H5 反馈暂无法到院，需要继续人工跟进。',
              );
            }

            if (reminder.sourceTaskId) {
              taskCreated = await tx.task.update({
                where: { id: reminder.sourceTaskId },
                data: {
                  status: TaskStatus.IN_PROGRESS,
                  title: action === 'REFUSED' ? '患者拒绝到院 — 需护士跟进' : '患者暂无法到院 — 需护士跟进',
                  dueAt: new Date(Date.now() + reminder.retryDueWithinHours * 60 * 60 * 1000),
                },
              });
            } else if (reminder.sourceRiskAlertId) {
              const ensured = await this.disposition.ensureOpenTaskForAlert(tx, {
                alertId: reminder.sourceRiskAlertId,
                taskTitle: action === 'REFUSED' ? '患者拒绝到院 — 需护士跟进' : '患者暂无法到院 — 需护士跟进',
                taskType: 'HOSPITAL_VISIT_FOLLOW_UP',
                dueAt: new Date(Date.now() + reminder.retryDueWithinHours * 60 * 60 * 1000),
                assigneeId: reminder.remindedBy,
              });
              taskCreated = ensured.task;
              await tx.hospitalVisitReminder.update({
                where: { id: reminder.id },
                data: { sourceTaskId: taskCreated.id, riskEpisodeId: taskCreated.riskEpisodeId ?? undefined },
              });
            } else {
              taskCreated = await tx.task.create({
                data: {
                  patientId: formLink.patientId,
                  title: action === 'REFUSED' ? '患者拒绝到院 — 需护士跟进' : '患者暂无法到院 — 需护士跟进',
                  type: 'HOSPITAL_VISIT_FOLLOW_UP',
                  status: TaskStatus.IN_PROGRESS,
                  priority: 1,
                  dueAt: new Date(Date.now() + reminder.retryDueWithinHours * 60 * 60 * 1000),
                  assigneeId: reminder.remindedBy ?? undefined,
                },
              });
              await tx.hospitalVisitReminder.update({ where: { id: reminder.id }, data: { sourceTaskId: taskCreated.id } });
            }
          } else if (action === 'WILL_VISIT') {
            reminderUpdated = await tx.hospitalVisitReminder.update({
              where: { id: reminderId },
              data: { outcomeNote: `[患者反馈] 计划到院 · ${dto.note ?? ''}`.slice(0, 500) },
            });
          }
        }
      }

      // v3.2: structured patient 到院反馈 (distinct from the nurse-side followUp).
      const feedback = await tx.hospitalVisitFeedback.create({
        data: {
          hospitalTenantId: formLink.hospitalTenantId,
          patientId: formLink.patientId,
          formLinkId: formLink.id,
          hospitalVisitReminderId: reminderId ?? undefined,
          taskId: taskCreated?.id ?? sourceReminder?.sourceTaskId ?? undefined,
          riskAlertId: sourceReminder?.sourceRiskAlertId ?? undefined,
          action,
          note: dto.note ?? undefined,
          source: 'H5_LINK',
        },
      });

      await tx.patientOutboundMessage.updateMany({
        where: { formLinkId: formLink.id, status: { in: ['SENT', 'PENDING', 'CLICKED'] } },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });

      await this._linkSubmissionInTx(tx, formLink.id, 'HospitalVisitFeedback', feedback.id);
      // v3: mark linked CareReminderOccurrence COMPLETED (no-op if none).
      await this._tryCompleteOccurrenceInTx(tx, formLink.id, 'FollowUpRecord', followUp.id);

      return { followUp, reminderUpdated, taskCreated, feedback };
    });

    await this.prisma.engagementEventLog.create({
      data: {
        patientId: formLink.patientId,
        formLinkId: formLink.id,
        eventType: 'FORM_SUBMITTED',
        ipAddress: req?.ip,
        metadata: { action, followUpId: result.followUp.id, generatedTaskId: result.taskCreated?.id ?? null } as any,
      },
    });

    return { ok: true, message: '已记录您的反馈, 感谢您的配合.', action };
  }

  // ---------------------------------------------------------------------------
  // v3: GENERAL_MESSAGE — patient acknowledges a nurse-sent direct message
  // ---------------------------------------------------------------------------

  @Post(':token/general-message-ack')
  async submitGeneralMessageAck(
    @Param('token') token: string,
    @Body() dto: { note?: string } | undefined,
    @Req() req: any,
  ) {
    const formLink = await this.formLink.resolveByToken(token);
    this.formLink.ensureUsable(formLink);
    if (formLink.type !== 'GENERAL_MESSAGE') {
      throw new BadRequestException({ code: 'TYPE_MISMATCH', message: '链接类型与提交内容不一致' });
    }

    const note = (dto?.note ?? '').slice(0, 500);

    const result = await this.prisma.$transaction(async (tx) => {
      // Same atomic claim as every other submit handler (Bug 4 fix).
      await this.formLink.claimForSubmission(tx, formLink.id);

      // Mark PatientDirectMessage ACKNOWLEDGED (if any). The schema is a
      // required runtime dependency: database failures must roll back the
      // submission instead of being silently ignored.
      let acknowledgedId: string | null = null;
      const directRow = await tx.patientDirectMessage.findFirst({
        where: { formLinkId: formLink.id, status: { not: 'ACKNOWLEDGED' } },
        select: { id: true },
      });
      if (directRow) {
        const r = await tx.patientDirectMessage.updateMany({
          where: { id: directRow.id, status: { not: 'ACKNOWLEDGED' } },
          data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
        });
        if (r.count === 1) acknowledgedId = directRow.id;
      }

      await tx.patientOutboundMessage.updateMany({
        where: { formLinkId: formLink.id, status: { in: ['SENT', 'PENDING', 'CLICKED'] } },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });

      // Mark linked CareReminderOccurrence (rare for direct messages, but
      // possible if the schedule's reminderType is GENERAL_MESSAGE).
      await this._linkSubmissionInTx(
        tx,
        formLink.id,
        'PatientDirectMessage',
        acknowledgedId ?? formLink.id,
        false,
      );
      await this._tryCompleteOccurrenceInTx(
        tx,
        formLink.id,
        'PatientDirectMessageAck',
        acknowledgedId ?? formLink.id,
      );

      return { acknowledgedId };
    });

    await this.prisma.engagementEventLog.create({
      data: {
        patientId: formLink.patientId,
        formLinkId: formLink.id,
        eventType: 'FORM_SUBMITTED',
        ipAddress: req?.ip,
        metadata: { kind: 'GENERAL_MESSAGE_ACK', note, directMessageId: result.acknowledgedId } as any,
      },
    });

    return { ok: true, message: '已记录, 谢谢您.' };
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  private maskName(name: string): string {
    if (!name) return '';
    if (name.length <= 1) return name;
    if (name.length === 2) return name[0] + '*';
    return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
  }

  private composeNote(prefix: string, userNote?: string | null): string {
    if (!userNote) return prefix;
    return `${prefix} | ${userNote}`.slice(0, 500);
  }

  private async completeVitalSubmissionInTx(tx: any, formLinkId: string, vitalRecordId?: string): Promise<void> {
    await tx.patientOutboundMessage.updateMany({ where: { formLinkId, status: { in: ['SENT', 'PENDING', 'CLICKED'] } }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
    if (!vitalRecordId) return;
    await this._linkSubmissionInTx(tx, formLinkId, 'VitalRecord', vitalRecordId);
    await this._tryCompleteOccurrenceInTx(tx, formLinkId, 'VitalRecord', vitalRecordId);
  }

  private submissionReviewSlaHours(): number {
    const configured = Number(process.env.PATIENT_SUBMISSION_REVIEW_SLA_HOURS ?? 24);
    return Number.isFinite(configured) && configured > 0 ? configured : 24;
  }

  private dueAtFromHours(hours?: number): Date {
    if (hours === undefined) throw new BadRequestException('异常规则缺少版本化随访 SLA，已阻止自动任务创建');
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  private async evaluateConfiguredVital(patient: any, type: string, value: number, unit: string, measuredAt: Date): Promise<PublicVitalRuleEvaluation> {
    const configured = await this.clinicalRules.evaluateVital(patient, { type, value, unit, measuredAt: measuredAt.toISOString(), dataSource: DataSource.MINI_PROGRAM } as any);
    if (configured) return { ...configured, trigger: configured.triggerRule };
    if (process.env.CLINICAL_RULE_ALLOW_LEGACY_FALLBACK === 'true') {
      const legacy = this.evaluateVitalLegacy(type, value);
      return {
        ...legacy,
        followUpDueWithinHours: legacy.riskLevel === RiskLevel.VERY_HIGH ? 4 : legacy.riskLevel === RiskLevel.HIGH ? 24 : 72,
        followUpTaskTitle: `开发回退：${this.vitalLabel(type)}异常复核`,
        ruleTrace: { ruleId: 'LEGACY_H5_VITAL_FALLBACK', ruleVersion: 'legacy-dev-only', ruleSnapshot: { type, trigger: legacy.trigger }, evidenceBasis: '开发环境兼容回退逻辑；禁止作为正式发布规则使用。', evaluatedAt: new Date(), inputSnapshot: { type, value, unit, measuredAt }, matchedConditions: legacy },
      };
    }
    return { isAbnormal: false, riskLevel: RiskLevel.LOW, trigger: '未命中已生效的版本化自动异常规则', ruleTrace: { ruleId: 'NO_EFFECTIVE_RULE_MATCH', ruleVersion: 'no-effective-rule-match', ruleSnapshot: {}, evidenceBasis: '未使用自动异常判定。', evaluatedAt: new Date(), inputSnapshot: { type, value, unit, measuredAt }, matchedConditions: [] } };
  }

  // Development-only compatibility paths. Production keeps
  // CLINICAL_RULE_ALLOW_LEGACY_FALLBACK=false.
  private evaluateVitalLegacy(type: string, value: number): { isAbnormal: boolean; riskLevel: RiskLevel; trigger: string } {
    if (type === 'SYSTOLIC_BP') {
      if (value >= 180) return { isAbnormal: true, riskLevel: RiskLevel.VERY_HIGH, trigger: '收缩压 ≥ 180 mmHg, 极高危' };
      if (value >= 160) return { isAbnormal: true, riskLevel: RiskLevel.HIGH, trigger: '收缩压 ≥ 160 mmHg, 高危' };
      if (value >= 140) return { isAbnormal: true, riskLevel: RiskLevel.MEDIUM, trigger: '收缩压 ≥ 140 mmHg, 异常' };
      if (value < 90) return { isAbnormal: true, riskLevel: RiskLevel.MEDIUM, trigger: '收缩压 < 90 mmHg, 偏低异常' };
    }
    if (type === 'DIASTOLIC_BP') {
      if (value >= 110) return { isAbnormal: true, riskLevel: RiskLevel.VERY_HIGH, trigger: '舒张压 ≥ 110 mmHg, 极高危' };
      if (value >= 100) return { isAbnormal: true, riskLevel: RiskLevel.HIGH, trigger: '舒张压 ≥ 100 mmHg, 高危' };
      if (value >= 90) return { isAbnormal: true, riskLevel: RiskLevel.MEDIUM, trigger: '舒张压 ≥ 90 mmHg, 异常' };
      if (value < 60) return { isAbnormal: true, riskLevel: RiskLevel.MEDIUM, trigger: '舒张压 < 60 mmHg, 偏低异常' };
    }
    if (type === 'BLOOD_GLUCOSE') {
      if (value >= 16.7) return { isAbnormal: true, riskLevel: RiskLevel.VERY_HIGH, trigger: '血糖 ≥ 16.7 mmol/L, 极高危' };
      if (value >= 11.1) return { isAbnormal: true, riskLevel: RiskLevel.HIGH, trigger: '血糖 ≥ 11.1 mmol/L, 高危' };
      if (value >= 7.0) return { isAbnormal: true, riskLevel: RiskLevel.MEDIUM, trigger: '血糖 ≥ 7.0 mmol/L, 异常' };
      if (value < 3.9) return { isAbnormal: true, riskLevel: RiskLevel.HIGH, trigger: '血糖 < 3.9 mmol/L, 低血糖风险' };
    }
    if (type === 'SPO2') {
      if (value < 90) return { isAbnormal: true, riskLevel: RiskLevel.VERY_HIGH, trigger: '血氧 < 90%, 极高危' };
      if (value < 95) return { isAbnormal: true, riskLevel: RiskLevel.HIGH, trigger: '血氧 < 95%, 异常' };
    }
    return { isAbnormal: false, riskLevel: RiskLevel.LOW, trigger: '未触发异常规则' };
  }

  private worstEvaluation<T extends { isAbnormal: boolean; riskLevel: RiskLevel }>(items: T[]): T {
    const rank: Record<RiskLevel, number> = {
      [RiskLevel.LOW]: 0,
      [RiskLevel.MEDIUM]: 1,
      [RiskLevel.HIGH]: 2,
      [RiskLevel.VERY_HIGH]: 3,
    };
    return items.reduce((acc, cur) => (rank[cur.riskLevel] > rank[acc.riskLevel] ? cur : acc), items[0]);
  }

  private vitalLabel(type: string): string {
    const map: Record<string, string> = {
      BLOOD_PRESSURE: '血压',
      SYSTOLIC_BP: '收缩压',
      DIASTOLIC_BP: '舒张压',
      BLOOD_GLUCOSE: '血糖',
      WEIGHT: '体重',
      HEART_RATE: '心率',
      SPO2: '血氧',
    };
    return map[type] || type;
  }

  private visitActionLabel(action: string): string {
    const m: Record<string, string> = {
      WILL_VISIT: '我会尽快到院',
      ARRIVED: '我已到院',
      CANNOT_VISIT: '暂时无法到院',
      REFUSED: '拒绝到院',
    };
    return m[action] || action;
  }

  // ---------------------------------------------------------------------------
  // form session token — short-lived HMAC of (formLinkId, exp)
  // ---------------------------------------------------------------------------

  private getSecret(): string {
    return process.env.PATIENT_FORM_TOKEN_SECRET || 'dev_change_me';
  }

  private issueFormSessionToken(formLinkId: string): string {
    const exp = Math.floor(Date.now() / 1000) + 15 * 60;
    const payload = `${formLinkId}.${exp}`;
    const sig = crypto.createHmac('sha256', this.getSecret()).update(payload).digest('base64url');
    return `${Buffer.from(payload).toString('base64url')}.${sig}`;
  }

  private assertFormSession(formLinkId: string, formSessionToken?: string | null): void {
    if (!formSessionToken) throw new ForbiddenException({ code: 'IDENTITY_REQUIRED', message: '请先完成身份校验' });
    const [payloadB64, sig] = formSessionToken.split('.');
    if (!payloadB64 || !sig) throw new ForbiddenException({ code: 'SESSION_INVALID', message: '校验信息已失效, 请重试' });
    let payload: string;
    try { payload = Buffer.from(payloadB64, 'base64url').toString('utf8'); }
    catch { throw new ForbiddenException({ code: 'SESSION_INVALID', message: '校验信息已失效, 请重试' }); }
    const expected = crypto.createHmac('sha256', this.getSecret()).update(payload).digest('base64url');
    if (sig !== expected) throw new ForbiddenException({ code: 'SESSION_INVALID', message: '校验信息已失效, 请重试' });
    const [fid, expStr] = payload.split('.');
    if (fid !== formLinkId) throw new ForbiddenException({ code: 'SESSION_MISMATCH', message: '校验信息与链接不匹配, 请重新校验' });
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
      throw new ForbiddenException({ code: 'SESSION_EXPIRED', message: '身份校验已过期, 请重新校验' });
    }
  }
}

// ============================================================================
// WechatOAuthController — per-tenant OAuth (signed state, fail closed)
// ============================================================================

@Public()
@Controller('patient-engagement/wechat/oauth')
export class WechatOAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly formLink: FormLinkService,
    private readonly wechat: WechatOfficialAccountService,
  ) {}

  private getSecret(): string {
    return process.env.PATIENT_FORM_TOKEN_SECRET || 'dev_change_me';
  }

  // v2.1: OAuth state uses a compact AES-GCM envelope (raw bytes concatenated,
  // then base64url-encoded as ONE blob) — no dots, no segment separators.
  // Result length is ~156 chars for our payload, fully in [A-Za-z0-9_-].
  //
  // (Why not reuse encryptSecret/decryptSecret from secret-crypto.util? Those
  // produce a "v1.iv.ct.tag" dotted envelope optimized for storage and human
  // inspection. WeChat's state parameter is alphanumeric-only per docs, so we
  // need a separator-free encoding here.)
  private packState(plain: string): string {
    const key = crypto.createHash('sha256').update(
      process.env.PATIENT_ENGAGEMENT_SECRET_KEY || 'dev_patient_engagement_secret_change_me',
      'utf8',
    ).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, ct, tag]).toString('base64url');
  }

  private unpackState(blob: string): string | null {
    try {
      const raw = Buffer.from(blob, 'base64url');
      if (raw.length < 12 + 16 + 1) return null;
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(raw.length - 16);
      const ct = raw.subarray(12, raw.length - 16);
      const key = crypto.createHash('sha256').update(
        process.env.PATIENT_ENGAGEMENT_SECRET_KEY || 'dev_patient_engagement_secret_change_me',
        'utf8',
      ).digest();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const out = Buffer.concat([decipher.update(ct), decipher.final()]);
      return out.toString('utf8');
    } catch { return null; }
  }

  private signState(args: { tokenPlain: string; hospitalTenantId: string }): string {
    // state contains the *plaintext* token (encrypted with the secret key).
    // The token is already public to the patient — they're holding the URL in
    // their hand. Encrypted state just round-trips it through WeChat so we can
    // redirect them back to /wx/form/:token after OAuth.
    //
    // No nonce — AES-GCM's IV is itself a per-message random. exp prevents
    // replay outside the 10-minute window.
    const exp = Math.floor(Date.now() / 1000) + 10 * 60;
    const obj = { t: args.tokenPlain, h: args.hospitalTenantId, e: exp };
    return this.packState(JSON.stringify(obj));
  }

  private verifyState(state: string): { tokenPlain: string; hospitalTenantId: string } | null {
    const plain = this.unpackState(state);
    if (!plain) return null;
    try {
      const obj = JSON.parse(plain);
      if (!obj?.t || !obj?.h || !obj?.e) return null;
      if (Number(obj.e) < Math.floor(Date.now() / 1000)) return null;
      return { tokenPlain: String(obj.t), hospitalTenantId: String(obj.h) };
    } catch { return null; }
  }

  @Get('start')
  async start(@Query('token') token: string, @Res() res: any) {
    if (!token) { res.status(400).send('missing token'); return; }
    // Look up the link to discover the hospital tenant — fail closed if missing.
    let formLink;
    try { formLink = await this.formLink.resolveByToken(token); }
    catch { res.status(404).send('invalid token'); return; }
    if (!formLink.hospitalTenantId) {
      res.status(400).send('link has no hospital tenant — cannot start OAuth');
      return;
    }
    // v2.2: callback must hit the Nest API host, NOT the patient H5 host.
    // Nest has no global /api prefix, so the path is /patient-engagement/wechat/oauth/callback.
    // Production usually puts a reverse proxy (Nginx) in front; the env var lets
    // the deployer point this at whatever public hostname the API is served on.
    const apiBaseUrl = (
      process.env.PATIENT_ENGAGEMENT_API_BASE_URL ||
      process.env.API_PUBLIC_BASE_URL ||
      'http://localhost:3000'
    ).replace(/\/+$/, '');
    const callback = `${apiBaseUrl}/patient-engagement/wechat/oauth/callback`;
    const state = this.signState({
      tokenPlain: token,
      hospitalTenantId: formLink.hospitalTenantId,
    });
    const url = await this.wechat.buildOAuthAuthorizeUrl({
      hospitalTenantId: formLink.hospitalTenantId,
      state,
      callbackUrl: callback,
    });
    if (!url) { res.status(503).send('hospital service account not configured'); return; }
    res.redirect(url);
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: any) {
    const baseUrl = (process.env.PATIENT_ENGAGEMENT_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
    const parsed = state ? this.verifyState(state) : null;
    if (!parsed || !code) {
      res.redirect(`${baseUrl}/wx/form/__invalid__`);
      return;
    }

    // Recover the form link to confirm tenant + find the patient.
    const tokenHash = this.formLink.hashToken(parsed.tokenPlain);
    const link = await this.prisma.patientFormLink.findUnique({
      where: { tokenHash },
      select: { id: true, patientId: true, hospitalTenantId: true },
    });
    if (!link || link.hospitalTenantId !== parsed.hospitalTenantId) {
      res.redirect(`${baseUrl}/wx/form/__invalid__`);
      return;
    }

    const exchange = await this.wechat.exchangeCodeForOpenId({
      hospitalTenantId: parsed.hospitalTenantId,
      code,
    });

    if (exchange.success && exchange.openId) {
      try {
        const appId = (await this.wechat.getAppIdForTenant(parsed.hospitalTenantId)) || 'unknown-app';
        await this.prisma.patientWechatIdentity.upsert({
          where: {
            hospitalTenantId_appId_openId: {
              hospitalTenantId: parsed.hospitalTenantId,
              appId,
              openId: exchange.openId,
            },
          },
          update: {
            patientId: link.patientId,
            unionId: exchange.unionId,
            isVerified: true,
            verifiedAt: new Date(),
          },
          create: {
            hospitalTenantId: parsed.hospitalTenantId,
            patientId: link.patientId,
            appId,
            openId: exchange.openId,
            unionId: exchange.unionId,
            source: 'OFFICIAL_ACCOUNT_H5',
            isVerified: true,
            verifiedAt: new Date(),
          },
        });
      } catch { /* swallow — we still want to redirect to the H5 form */ }
    }

    // v2.1: redirect back to the actual H5 form so the patient sees their task.
    res.redirect(`${baseUrl}/wx/form/${encodeURIComponent(parsed.tokenPlain)}`);
  }
}
