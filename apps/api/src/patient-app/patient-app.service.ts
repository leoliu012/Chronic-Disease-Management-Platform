import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PatientBindingStatus, Prisma, UserRole } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { VitalRecordsService } from '../vital-records/vital-records.service';
import { MedicationsService } from '../medications/medications.service';
import { QuestionnairesService } from '../questionnaires/questionnaires.service';
import { VitalMonitoringPlansService } from '../vital-monitoring-plans/vital-monitoring-plans.service';
import type { RequestUser } from '../security/request-user.type';
import { CreateVitalRecordDto } from '../vital-records/dto/create-vital-record.dto';
import { CreateMedicationCheckInDto } from '../medications/dto/create-medication-check-in.dto';
import { CreateQuestionnaireResultDto } from '../questionnaires/dto/create-questionnaire-result.dto';
import { MarkVitalMonitoringMissedDto } from '../vital-monitoring-plans/dto/mark-vital-monitoring-missed.dto';
import { CreatePatientBindingRequestDto } from './dto/create-patient-binding-request.dto';
import { PatientDemoLoginDto } from './dto/patient-demo-login.dto';
import { RejectPatientBindingDto } from './dto/reject-patient-binding.dto';
import type { PatientSessionRequestContext } from './patient-session.type';

const PATIENT_SESSION_DAYS = 30;

function safeString(value?: string | null) {
  return String(value ?? '').trim();
}

function hashPatientToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createPatientToken() {
  return crypto.randomBytes(32).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

@Injectable()
export class PatientAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vitalRecordsService: VitalRecordsService,
    private readonly medicationsService: MedicationsService,
    private readonly questionnairesService: QuestionnairesService,
    private readonly vitalMonitoringPlansService: VitalMonitoringPlansService,
  ) {}

  private normalizeDemoOpenId(value?: string) {
    const normalized = safeString(value);
    if (normalized) return normalized;
    return `demo-openid-${crypto.randomBytes(6).toString('hex')}`;
  }

  private async recordPatientAudit(params: {
    session?: PatientSessionRequestContext;
    demoOpenId?: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    ipAddress?: string;
    afterData?: unknown;
  }) {
    await this.prisma.auditLog.create({
      data: {
        operatorId: params.session
          ? `patient:${params.session.patientId}`
          : params.demoOpenId
            ? `patient-demo-openid:${params.demoOpenId}`
            : undefined,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId ?? undefined,
        ipAddress: params.ipAddress,
        afterData:
          params.afterData === undefined
            ? undefined
            : (params.afterData as Prisma.InputJsonValue),
      },
    });
  }

  private async createSession(demoOpenId: string, patientId: string, ipAddress?: string) {
    const token = createPatientToken();
    const expiresAt = addDays(new Date(), PATIENT_SESSION_DAYS);

    const session = await this.prisma.patientSession.create({
      data: {
        demoOpenId,
        patientId,
        tokenHash: hashPatientToken(token),
        expiresAt,
        lastUsedAt: new Date(),
      },
    });

    await this.recordPatientAudit({
      demoOpenId,
      action: 'PATIENT_LOGIN',
      targetType: 'PatientSession',
      targetId: session.id,
      ipAddress,
      afterData: { patientId, expiresAt: expiresAt.toISOString() },
    });

    return { token, session };
  }

  async loginWithDemoOpenId(dto: PatientDemoLoginDto, ipAddress?: string) {
    const demoOpenId = this.normalizeDemoOpenId(dto.demoOpenId);

    const approvedRequest = await this.prisma.patientBindingRequest.findFirst({
      where: { demoOpenId, status: PatientBindingStatus.APPROVED },
      orderBy: { reviewedAt: 'desc' },
    });

    if (!approvedRequest) {
      const latestRequest = await this.prisma.patientBindingRequest.findFirst({
        where: { demoOpenId },
        orderBy: { createdAt: 'desc' },
      });

      return {
        demoOpenId,
        bindingStatus: latestRequest?.status ?? 'UNBOUND',
        bindingRequest: latestRequest,
        patientToken: null,
        patient: null,
        message:
          latestRequest?.status === PatientBindingStatus.PENDING
            ? '绑定申请审核中，请等待护士审核。'
            : latestRequest?.status === PatientBindingStatus.REJECTED
              ? '绑定申请未通过，请核对手机号、院内号或身份证后四位后重新提交。'
              : '尚未绑定慢病档案，请先提交绑定申请。',
      };
    }

    const patient = await this.prisma.patient.findUnique({
      where: { id: approvedRequest.patientId },
      include: { diseaseProfiles: true },
    });

    if (!patient) {
      throw new NotFoundException('Approved binding patient no longer exists');
    }

    const { token, session } = await this.createSession(demoOpenId, patient.id, ipAddress);

    return {
      demoOpenId,
      bindingStatus: PatientBindingStatus.APPROVED,
      bindingRequest: approvedRequest,
      patientToken: token,
      patient,
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
      },
      message: '患者身份已确认，已签发患者端会话。',
    };
  }

  async createBindingRequest(dto: CreatePatientBindingRequestDto, ipAddress?: string) {
    const demoOpenId = this.normalizeDemoOpenId(dto.demoOpenId);
    const phone = safeString(dto.phone);
    const hospitalPatientId = safeString(dto.hospitalPatientId);
    const idCardLast4 = safeString(dto.idCardLast4);

    if (!phone) {
      throw new BadRequestException('手机号不能为空');
    }

    if (!hospitalPatientId && !idCardLast4) {
      throw new BadRequestException('请至少填写院内号或身份证后四位');
    }

    const patient = await this.prisma.patient.findFirst({
      where: {
        phone,
        OR: [
          ...(hospitalPatientId ? [{ hospitalPatientId }] : []),
          ...(idCardLast4 ? [{ idCardNo: { endsWith: idCardLast4 } }] : []),
        ],
      },
    });

    if (!patient) {
      throw new BadRequestException('未匹配到患者档案，请核对手机号、院内号或身份证后四位');
    }

    const existingPending = await this.prisma.patientBindingRequest.findFirst({
      where: {
        demoOpenId,
        patientId: patient.id,
        status: PatientBindingStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingPending) {
      return {
        bindingRequest: existingPending,
        patient: {
          id: patient.id,
          name: patient.name,
          hospitalPatientId: patient.hospitalPatientId,
        },
        message: '已有待审核绑定申请，请等待护士审核。',
      };
    }

    const bindingRequest = await this.prisma.patientBindingRequest.create({
      data: {
        demoOpenId,
        patientId: patient.id,
        hospitalPatientId: hospitalPatientId || patient.hospitalPatientId,
        phone,
        idCardLast4: idCardLast4 || undefined,
      },
    });

    await this.recordPatientAudit({
      demoOpenId,
      action: 'PATIENT_BINDING_REQUEST',
      targetType: 'PatientBindingRequest',
      targetId: bindingRequest.id,
      ipAddress,
      afterData: {
        patientId: patient.id,
        hospitalPatientId: patient.hospitalPatientId,
      },
    });

    return {
      bindingRequest,
      patient: {
        id: patient.id,
        name: patient.name,
        hospitalPatientId: patient.hospitalPatientId,
      },
      message: '绑定申请已提交，请等待护士审核。',
    };
  }

  async verifyPatientToken(token: string): Promise<PatientSessionRequestContext> {
    const tokenHash = hashPatientToken(token);
    const session = await this.prisma.patientSession.findUnique({
      where: { tokenHash },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Patient session is invalid or expired');
    }

    await this.prisma.patientSession.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      sessionId: session.id,
      demoOpenId: session.demoOpenId,
      patientId: session.patientId,
    };
  }

  async findBindingRequests(status?: string) {
    const normalizedStatus = safeString(status).toUpperCase();
    const where: Prisma.PatientBindingRequestWhereInput =
      normalizedStatus && normalizedStatus in PatientBindingStatus
        ? { status: normalizedStatus as PatientBindingStatus }
        : {};

    return this.prisma.patientBindingRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async approveBindingRequest(id: string, user: RequestUser, ipAddress?: string) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.NURSE) {
      throw new ForbiddenException('Only admin or nurse can approve patient bindings');
    }

    const existing = await this.prisma.patientBindingRequest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Binding request not found');

    const updated = await this.prisma.patientBindingRequest.update({
      where: { id },
      data: {
        status: PatientBindingStatus.APPROVED,
        reviewedBy: user.id,
        reviewedAt: new Date(),
        rejectReason: null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        operatorId: user.id,
        action: 'PATIENT_BINDING_APPROVED',
        targetType: 'PatientBindingRequest',
        targetId: id,
        ipAddress,
        afterData: {
          patientId: updated.patientId,
          demoOpenId: updated.demoOpenId,
          reviewerRole: user.role,
        },
      },
    });

    return updated;
  }

  async rejectBindingRequest(id: string, dto: RejectPatientBindingDto, user: RequestUser, ipAddress?: string) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.NURSE) {
      throw new ForbiddenException('Only admin or nurse can reject patient bindings');
    }

    const existing = await this.prisma.patientBindingRequest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Binding request not found');

    const updated = await this.prisma.patientBindingRequest.update({
      where: { id },
      data: {
        status: PatientBindingStatus.REJECTED,
        reviewedBy: user.id,
        reviewedAt: new Date(),
        rejectReason: dto.rejectReason || '护士审核未通过',
      },
    });

    await this.prisma.auditLog.create({
      data: {
        operatorId: user.id,
        action: 'PATIENT_BINDING_REJECTED',
        targetType: 'PatientBindingRequest',
        targetId: id,
        ipAddress,
        afterData: {
          patientId: updated.patientId,
          demoOpenId: updated.demoOpenId,
          reason: updated.rejectReason,
        },
      },
    });

    return updated;
  }

  async getMe(session: PatientSessionRequestContext) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: session.patientId },
      include: { diseaseProfiles: true },
    });

    if (!patient) throw new NotFoundException('Patient not found');
    return { session, patient };
  }

  async getVitals(session: PatientSessionRequestContext) {
    return this.vitalRecordsService.findByPatient(session.patientId, {} as any);
  }

  async createVital(session: PatientSessionRequestContext, dto: CreateVitalRecordDto, ipAddress?: string) {
    const result = await this.vitalRecordsService.create(session.patientId, dto);
    await this.recordPatientAudit({
      session,
      action: 'PATIENT_UPLOAD_VITAL',
      targetType: 'VitalRecord',
      targetId: result.vitalRecord?.id,
      ipAddress,
      afterData: {
        type: dto.type,
        value: dto.value,
        systolicValue: dto.systolicValue,
        diastolicValue: dto.diastolicValue,
        unit: dto.unit,
      },
    });
    return result;
  }

  async getRiskAlerts(session: PatientSessionRequestContext) {
    return this.prisma.riskAlert.findMany({
      where: { patientId: session.patientId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getHospitalVisitReminders(session: PatientSessionRequestContext) {
    return this.prisma.hospitalVisitReminder.findMany({
      where: {
        patientId: session.patientId,
        status: 'ACTIVE',
      },
      orderBy: { remindedAt: 'desc' },
    });
  }

  async getTasks(session: PatientSessionRequestContext) {
    return this.prisma.task.findMany({
      where: { patientId: session.patientId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMedications(session: PatientSessionRequestContext) {
    return this.medicationsService.findMedicationsByPatient(session.patientId);
  }

  async getMedicationCheckIns(session: PatientSessionRequestContext) {
    return this.medicationsService.findCheckInsByPatient(session.patientId);
  }

  async createMedicationCheckIn(
    session: PatientSessionRequestContext,
    medicationId: string,
    dto: CreateMedicationCheckInDto,
    ipAddress?: string,
  ) {
    const medication = await this.prisma.medicationRecord.findUnique({ where: { id: medicationId } });
    if (!medication || medication.patientId !== session.patientId) {
      throw new NotFoundException('Medication not found for this patient');
    }

    const result = await this.medicationsService.createCheckIn(medicationId, dto);
    await this.recordPatientAudit({
      session,
      action: 'PATIENT_MEDICATION_CHECK_IN',
      targetType: 'MedicationCheckIn',
      targetId: result.checkIn?.id,
      ipAddress,
      afterData: { medicationId, taken: dto.taken, scheduledAt: dto.scheduledAt },
    });
    return result;
  }

  async getQuestionnaireResults(session: PatientSessionRequestContext) {
    return this.questionnairesService.findByPatient(session.patientId);
  }

  async createQuestionnaireResult(
    session: PatientSessionRequestContext,
    dto: CreateQuestionnaireResultDto,
    ipAddress?: string,
  ) {
    const result = await this.questionnairesService.create(session.patientId, dto);
    await this.recordPatientAudit({
      session,
      action: 'PATIENT_SUBMIT_QUESTIONNAIRE',
      targetType: 'QuestionnaireResult',
      targetId: result.questionnaireResult?.id,
      ipAddress,
      afterData: { questionnaireType: dto.questionnaireType, score: dto.score },
    });
    return result;
  }

  async getVitalMonitoringPlans(session: PatientSessionRequestContext) {
    return this.vitalMonitoringPlansService.findByPatient(session.patientId);
  }

  async markVitalMonitoringMissed(
    session: PatientSessionRequestContext,
    planId: string,
    dto: MarkVitalMonitoringMissedDto,
    ipAddress?: string,
  ) {
    const plan = await this.prisma.vitalMonitoringPlan.findUnique({ where: { id: planId } });
    if (!plan || plan.patientId !== session.patientId) {
      throw new NotFoundException('Vital monitoring plan not found for this patient');
    }

    const result = await this.vitalMonitoringPlansService.markMissed(planId, dto);
    await this.recordPatientAudit({
      session,
      action: 'PATIENT_VITAL_MISSED',
      targetType: 'VitalMonitoringPlan',
      targetId: planId,
      ipAddress,
      afterData: { scheduledAt: dto.scheduledAt },
    });
    return result;
  }
}




