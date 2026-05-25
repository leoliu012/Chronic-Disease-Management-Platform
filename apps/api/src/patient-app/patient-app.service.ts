import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ChronicLead,
  LeadConsentSource,
  LeadStatus,
  PatientBindingStatus,
  PatientConsentSource,
  PatientConsentStatus,
  Prisma,
  RiskLevel,
  UserRole,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { VitalRecordsService } from '../vital-records/vital-records.service';
import { MedicationsService } from '../medications/medications.service';
import { QuestionnairesService } from '../questionnaires/questionnaires.service';
import { VitalMonitoringPlansService } from '../vital-monitoring-plans/vital-monitoring-plans.service';
import { ChronicLeadsService } from '../chronic-leads/chronic-leads.service';
import { HisIntegrationService } from '../his-integration/his-integration.service';
import type { RequestUser } from '../security/request-user.type';
import { CreateVitalRecordDto } from '../vital-records/dto/create-vital-record.dto';
import { CreateMedicationCheckInDto } from '../medications/dto/create-medication-check-in.dto';
import { CreateQuestionnaireResultDto } from '../questionnaires/dto/create-questionnaire-result.dto';
import { MarkVitalMonitoringMissedDto } from '../vital-monitoring-plans/dto/mark-vital-monitoring-missed.dto';
import { CreatePatientBindingRequestDto } from './dto/create-patient-binding-request.dto';
import { PatientDemoLoginDto } from './dto/patient-demo-login.dto';
import { RejectPatientBindingDto } from './dto/reject-patient-binding.dto';
import { IdentityLookupDto } from './dto/identity-lookup.dto';
import { SubmitConsentDto } from './dto/submit-consent.dto';
import type { PatientSessionRequestContext } from './patient-session.type';

const PATIENT_SESSION_DAYS = 30;

/**
 * 当前生效的患者端《知情同意与隐私授权协议》版本号。
 * identity/lookup 会把它下发给小程序，consent/submit 写入 PatientConsent.consentVersion。
 */
export const PATIENT_CONSENT_VERSION = '2026-05-24-v2';

const RISK_ORDER: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  VERY_HIGH: 3,
};

function safeString(value?: string | null) {
  return String(value ?? '').trim();
}

function hashPatientToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createPatientToken() {
  return crypto
    .randomBytes(32)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function maskPhone(value?: string | null) {
  if (!value) return value ?? null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7) return value;
  return value.replace(/(\d{3})\d+(\d{4})/, '$1****$2');
}

function maskIdCard(value?: string | null) {
  if (!value) return value ?? null;
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}**********${value.slice(-4)}`;
}

type IdentitySnapshot = {
  name: string | null;
  hospitalPatientId: string | null;
  phone: string | null;
  idCardNo: string | null;
  gender: string | null;
  suspectedDisease: string | null;
  diagnosisIcd: string | null;
  diagnosisText: string | null;
  riskHint: string | null;
  evidenceSummary: string | null;
  sourceChannel: string | null;
};

@Injectable()
export class PatientAppService {
  private readonly logger = new Logger(PatientAppService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vitalRecordsService: VitalRecordsService,
    private readonly medicationsService: MedicationsService,
    private readonly questionnairesService: QuestionnairesService,
    private readonly vitalMonitoringPlansService: VitalMonitoringPlansService,
    private readonly chronicLeadsService: ChronicLeadsService,
    private readonly hisIntegrationService: HisIntegrationService,
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
              : '尚未绑定慢病档案，请先搜索院内信息并提交绑定申请。',
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

  // ===========================================================================
  // patient-self-consent-bind —— 统一身份核验 / 知情同意 / 提交绑定申请
  // ===========================================================================

  /**
   * 搜索院内信息。搜索顺序：
   *   1) ChronicLead 邀约库（待签约 / 已签约）
   *   2) 已有 Patient 档案
   *   3) HIS / 院内暂存患者信息（预留，真实 HIS 接入后启用）
   *   4) 都查不到 → NOT_FOUND，提示联系医院或人工核验
   */
  async lookupIdentity(dto: IdentityLookupDto) {
    const demoOpenId = this.normalizeDemoOpenId(dto.demoOpenId);
    const hospitalPatientId = safeString(dto.hospitalPatientId) || undefined;
    const phone = safeString(dto.phone) || undefined;
    const idCardLast4 = safeString(dto.idCardLast4) || undefined;

    const base = {
      consentVersion: PATIENT_CONSENT_VERSION,
      existingBinding: await this.findLatestBindingSummary(demoOpenId),
    };

    if (!hospitalPatientId && !phone && !idCardLast4) {
      return { matchType: 'NOT_FOUND', reason: 'NEED_INPUT', ...base };
    }

    // 1) 邀约库 ChronicLead —— 优先待签约线索
    const activeLead = await this.chronicLeadsService.findActiveLeadForPatient({
      hospitalPatientId,
      phone,
      idCardLast4,
    });
    if (activeLead) {
      return {
        matchType: 'CHRONIC_LEAD',
        alreadySigned: false,
        chronicLead: { id: activeLead.id, status: activeLead.status },
        snapshot: this.leadSnapshot(activeLead),
        ...base,
      };
    }

    // 1b) 已签约的同名线索（小程序重复进入时给出已建档提示）
    const signedLead = await this.findSignedLeadForCriteria({
      hospitalPatientId,
      phone,
      idCardLast4,
    });
    if (signedLead) {
      const promoted = signedLead.promotedPatientId
        ? await this.prisma.patient.findUnique({
            where: { id: signedLead.promotedPatientId },
            select: { id: true, name: true, hospitalPatientId: true },
          })
        : null;
      return {
        matchType: 'CHRONIC_LEAD',
        alreadySigned: true,
        reason: 'LEAD_ALREADY_SIGNED',
        chronicLead: { id: signedLead.id, status: signedLead.status },
        snapshot: this.leadSnapshot(signedLead),
        patient: promoted,
        ...base,
      };
    }

    // 2) 已有 Patient 档案
    const patient = await this.findPatientForCriteria({
      hospitalPatientId,
      phone,
      idCardLast4,
    });
    if (patient) {
      return {
        matchType: 'EXISTING_PATIENT',
        patient: {
          id: patient.id,
          name: patient.name,
          hospitalPatientId: patient.hospitalPatientId,
        },
        snapshot: this.patientSnapshot(patient),
        ...base,
      };
    }

    // 3) HIS / 院内暂存患者信息（预留）
    if (hospitalPatientId) {
      const hisSnapshot = await this.tryLookupHisPatient(hospitalPatientId);
      if (hisSnapshot) {
        return {
          matchType: 'HIS_PATIENT',
          reason: 'HIS_STAGED',
          snapshot: hisSnapshot,
          ...base,
        };
      }
    }

    // 4) 查不到
    return {
      matchType: 'NOT_FOUND',
      reason: 'NEED_MANUAL_VERIFICATION',
      ...base,
    };
  }

  /**
   * 签署知情同意书，落一条独立 PatientConsent 记录。
   * 同一 demoOpenId 对同一识别对象的旧记录会被标记为 SUPERSEDED。
   */
  async submitConsent(dto: SubmitConsentDto, ipAddress?: string, userAgent?: string) {
    if (dto.consentAccepted !== true) {
      throw new BadRequestException('必须勾选《知情同意与隐私授权协议》方可继续');
    }

    const demoOpenId = this.normalizeDemoOpenId(dto.demoOpenId);
    const chronicLeadId = safeString(dto.chronicLeadId) || null;
    const patientId = safeString(dto.patientId) || null;
    const hospitalPatientId = safeString(dto.hospitalPatientId) || null;

    if (dto.matchType === 'CHRONIC_LEAD' && !chronicLeadId) {
      throw new BadRequestException('匹配到邀约库线索时必须提供 chronicLeadId');
    }

    // 把同一 openId + 同一识别对象的旧有效同意书置为 SUPERSEDED。
    await this.prisma.patientConsent.updateMany({
      where: {
        demoOpenId,
        status: PatientConsentStatus.SIGNED,
        OR: [
          ...(chronicLeadId ? [{ chronicLeadId }] : []),
          ...(patientId ? [{ patientId }] : []),
          ...(hospitalPatientId ? [{ hospitalPatientId }] : []),
        ],
      },
      data: { status: PatientConsentStatus.SUPERSEDED },
    });

    const consent = await this.prisma.patientConsent.create({
      data: {
        demoOpenId,
        hospitalPatientId: hospitalPatientId ?? undefined,
        chronicLeadId: chronicLeadId ?? undefined,
        patientId: patientId ?? undefined,
        consentVersion: safeString(dto.consentVersion) || PATIENT_CONSENT_VERSION,
        consentSource: PatientConsentSource.MINI_PROGRAM,
        consentTextSnapshot: safeString(dto.consentTextSnapshot) || undefined,
        matchType: dto.matchType,
        ipAddress,
        userAgent,
        status: PatientConsentStatus.SIGNED,
      },
    });

    await this.recordPatientAudit({
      demoOpenId,
      action: 'PATIENT_CONSENT_SIGNED',
      targetType: 'PatientConsent',
      targetId: consent.id,
      ipAddress,
      afterData: {
        matchType: dto.matchType,
        chronicLeadId,
        patientId,
        consentVersion: consent.consentVersion,
      },
    });

    return {
      ok: true,
      consentId: consent.id,
      consentVersion: consent.consentVersion,
      signedAt: consent.signedAt,
      message: '知情同意书已签署，请继续提交绑定申请。',
    };
  }

  /**
   * 提交绑定申请。统一入口，根据 matchType 走不同建档路径：
   *
   *   CHRONIC_LEAD     —— 内部触发 ChronicLead.sign()：建 Patient + DiseaseProfile
   *                       + 生成入组随访任务，再创建绑定申请。
   *   EXISTING_PATIENT —— 患者已是正式档案，仅创建绑定申请，等护士审核。
   *   HIS_PATIENT      —— 预留：HIS 暂存患者需人工核验，暂不支持自助提交。
   *
   * 所有路径都要求先签署知情同意书（consentId 必填且有效）。
   */
  async createBindingRequest(dto: CreatePatientBindingRequestDto, ipAddress?: string) {
    const demoOpenId = this.normalizeDemoOpenId(dto.demoOpenId);
    const phone = safeString(dto.phone);
    const hospitalPatientId = safeString(dto.hospitalPatientId);
    const idCardLast4 = safeString(dto.idCardLast4);
    const matchType = dto.matchType ?? 'EXISTING_PATIENT';

    if (!phone) {
      throw new BadRequestException('手机号不能为空');
    }
    if (!hospitalPatientId && !idCardLast4) {
      throw new BadRequestException('请至少填写院内号或身份证后四位');
    }

    // 知情同意书是绑定申请的前置条件 —— 所有患者都必须先签过同意书。
    const consent = await this.resolveSignedConsent(dto.consentId, demoOpenId);

    if (matchType === 'HIS_PATIENT') {
      throw new BadRequestException(
        'HIS 暂存患者的绑定需护士在院内系统核验后人工建档，暂不支持小程序自助提交。请联系医院。',
      );
    }

    if (matchType === 'CHRONIC_LEAD') {
      return this.createBindingFromChronicLead({
        demoOpenId,
        phone,
        hospitalPatientId,
        idCardLast4,
        chronicLeadId: safeString(dto.chronicLeadId),
        patientName: safeString(dto.patientName) || undefined,
        consentId: consent?.id,
        ipAddress,
      });
    }

    return this.createBindingForExistingPatient({
      demoOpenId,
      phone,
      hospitalPatientId,
      idCardLast4,
      consentId: consent?.id,
      ipAddress,
    });
  }

  // --- 绑定路径 A：命中邀约库 ChronicLead --------------------------------------

  private async createBindingFromChronicLead(params: {
    demoOpenId: string;
    phone: string;
    hospitalPatientId: string;
    idCardLast4: string;
    chronicLeadId: string;
    patientName?: string;
    consentId?: string;
    ipAddress?: string;
  }) {
    if (!params.chronicLeadId) {
      throw new BadRequestException('匹配到邀约库线索时必须提供 chronicLeadId');
    }

    const lead = await this.prisma.chronicLead.findUnique({
      where: { id: params.chronicLeadId },
      include: {
        promotedPatient: {
          select: { id: true, name: true, hospitalPatientId: true },
        },
      },
    });
    if (!lead) {
      throw new NotFoundException('邀约库线索不存在或已失效');
    }

    // 安全校验：患者填写的识别信息必须与线索快照吻合，避免越权签约他人线索。
    this.assertCriteriaMatchLead(lead, {
      phone: params.phone,
      hospitalPatientId: params.hospitalPatientId,
      idCardLast4: params.idCardLast4,
    });

    if (lead.status === LeadStatus.REJECTED || lead.status === LeadStatus.EXPIRED) {
      throw new BadRequestException(
        `该邀约线索状态为 ${lead.status}，已关闭。如需重新加入慢病管理，请联系医院。`,
      );
    }

    let patientId: string;
    let patientName: string;
    let patientHospitalId: string | null;
    let followupPlan:
      | { generated: boolean; taskCount: number; skippedReason?: string | null }
      | undefined;
    let signedNow = false;

    if (lead.status === LeadStatus.SIGNED) {
      // 线索此前已签约（例如小程序 timeout 重试），直接复用已建档患者。
      if (!lead.promotedPatientId || !lead.promotedPatient) {
        throw new BadRequestException('线索已签约但缺少患者档案，请联系医院核查');
      }
      patientId = lead.promotedPatient.id;
      patientName = lead.promotedPatient.name;
      patientHospitalId = lead.promotedPatient.hospitalPatientId;
    } else {
      // 触发邀约签约：建 Patient + DiseaseProfile + 入组随访任务。
      const operator = await this.resolveSystemOperator();
      const consentRef = [
        'MINI_PROGRAM_BIND',
        `consentId=${params.consentId ?? '-'}`,
        `v${PATIENT_CONSENT_VERSION}`,
        `openid=${params.demoOpenId}`,
        `ip=${params.ipAddress ?? '-'}`,
        `signedAt=${new Date().toISOString()}`,
      ].join(' | ');

      const signResult = await this.chronicLeadsService.sign(
        lead.id,
        {
          consentSource: LeadConsentSource.MINI_PROGRAM_SIGN,
          consentRef,
          ...(params.patientName ? { overrideName: params.patientName } : {}),
          ...(params.phone ? { overridePhone: params.phone } : {}),
        },
        operator,
        params.ipAddress,
      );

      patientId = signResult.patient.id;
      patientName = signResult.patient.name;
      patientHospitalId = signResult.patient.hospitalPatientId;
      followupPlan = signResult.followupPlan;
      signedNow = true;
    }

    const bindingRequest = await this.upsertBindingRequest({
      demoOpenId: params.demoOpenId,
      patientId,
      hospitalPatientId: params.hospitalPatientId || patientHospitalId || undefined,
      phone: params.phone,
      idCardLast4: params.idCardLast4 || undefined,
    });

    await this.linkConsentToBinding(params.consentId, {
      chronicLeadId: lead.id,
      patientId,
      bindingRequestId: bindingRequest.id,
    });

    await this.recordPatientAudit({
      demoOpenId: params.demoOpenId,
      action: 'PATIENT_BINDING_REQUEST_FROM_LEAD',
      targetType: 'PatientBindingRequest',
      targetId: bindingRequest.id,
      ipAddress: params.ipAddress,
      afterData: {
        chronicLeadId: lead.id,
        patientId,
        signedNow,
        consentId: params.consentId,
      },
    });

    return {
      bindingRequest,
      patient: { id: patientId, name: patientName, hospitalPatientId: patientHospitalId },
      chronicLead: { id: lead.id, status: LeadStatus.SIGNED },
      signedNow,
      followupPlan: followupPlan ?? {
        generated: false,
        taskCount: 0,
        skippedReason: 'ALREADY_SIGNED',
      },
      message: signedNow
        ? '已完成知情同意签约并建档，绑定申请已提交，请等待护士审核。'
        : '该线索此前已建档，绑定申请已提交，请等待护士审核。',
    };
  }

  // --- 绑定路径 B：已有 Patient 档案 ------------------------------------------

  private async createBindingForExistingPatient(params: {
    demoOpenId: string;
    phone: string;
    hospitalPatientId: string;
    idCardLast4: string;
    consentId?: string;
    ipAddress?: string;
  }) {
    const patient = await this.prisma.patient.findFirst({
      where: {
        phone: params.phone,
        OR: [
          ...(params.hospitalPatientId
            ? [{ hospitalPatientId: params.hospitalPatientId }]
            : []),
          ...(params.idCardLast4
            ? [{ idCardNo: { endsWith: params.idCardLast4 } }]
            : []),
        ],
      },
    });

    if (!patient) {
      throw new BadRequestException(
        '未匹配到患者档案，请核对手机号、院内号或身份证后四位',
      );
    }

    const bindingRequest = await this.upsertBindingRequest({
      demoOpenId: params.demoOpenId,
      patientId: patient.id,
      hospitalPatientId: params.hospitalPatientId || patient.hospitalPatientId || undefined,
      phone: params.phone,
      idCardLast4: params.idCardLast4 || undefined,
    });

    await this.linkConsentToBinding(params.consentId, {
      patientId: patient.id,
      bindingRequestId: bindingRequest.id,
    });

    await this.recordPatientAudit({
      demoOpenId: params.demoOpenId,
      action: 'PATIENT_BINDING_REQUEST',
      targetType: 'PatientBindingRequest',
      targetId: bindingRequest.id,
      ipAddress: params.ipAddress,
      afterData: {
        patientId: patient.id,
        hospitalPatientId: patient.hospitalPatientId,
        consentId: params.consentId,
      },
    });

    return {
      bindingRequest,
      patient: {
        id: patient.id,
        name: patient.name,
        hospitalPatientId: patient.hospitalPatientId,
      },
      signedNow: false,
      message: '绑定申请已提交，请等待护士审核。',
    };
  }

  // --- 绑定相关 helpers -------------------------------------------------------

  private async upsertBindingRequest(params: {
    demoOpenId: string;
    patientId: string;
    hospitalPatientId?: string;
    phone: string;
    idCardLast4?: string;
  }) {
    const existingPending = await this.prisma.patientBindingRequest.findFirst({
      where: {
        demoOpenId: params.demoOpenId,
        patientId: params.patientId,
        status: PatientBindingStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingPending) return existingPending;

    return this.prisma.patientBindingRequest.create({
      data: {
        demoOpenId: params.demoOpenId,
        patientId: params.patientId,
        hospitalPatientId: params.hospitalPatientId,
        phone: params.phone,
        idCardLast4: params.idCardLast4,
      },
    });
  }

  private async resolveSignedConsent(consentId: string | undefined, demoOpenId: string) {
    const id = safeString(consentId);
    if (!id) {
      throw new BadRequestException(
        '提交绑定申请前必须先签署知情同意书，请返回上一步完成签署',
      );
    }

    const consent = await this.prisma.patientConsent.findUnique({ where: { id } });
    if (!consent) {
      throw new BadRequestException('知情同意书记录不存在，请重新签署');
    }
    if (consent.demoOpenId !== demoOpenId) {
      throw new ForbiddenException('知情同意书与当前小程序身份不一致');
    }
    if (consent.status !== PatientConsentStatus.SIGNED) {
      throw new BadRequestException('知情同意书已失效，请重新签署');
    }
    return consent;
  }

  private async linkConsentToBinding(
    consentId: string | undefined,
    refs: { chronicLeadId?: string; patientId?: string; bindingRequestId?: string },
  ) {
    const id = safeString(consentId);
    if (!id) return;
    try {
      await this.prisma.patientConsent.update({
        where: { id },
        data: {
          ...(refs.chronicLeadId ? { chronicLeadId: refs.chronicLeadId } : {}),
          ...(refs.patientId ? { patientId: refs.patientId } : {}),
          ...(refs.bindingRequestId
            ? { bindingRequestId: refs.bindingRequestId }
            : {}),
        },
      });
    } catch (err) {
      this.logger.warn(
        `[PatientApp] link consent ${id} to binding failed: ${(err as Error).message}`,
      );
    }
  }

  private assertCriteriaMatchLead(
    lead: ChronicLead,
    criteria: { phone: string; hospitalPatientId: string; idCardLast4: string },
  ) {
    const matches: boolean[] = [];
    if (criteria.hospitalPatientId && lead.hospitalPatientId) {
      matches.push(criteria.hospitalPatientId === lead.hospitalPatientId);
    }
    if (criteria.phone && lead.phone) {
      matches.push(criteria.phone === lead.phone);
    }
    if (criteria.idCardLast4 && lead.idCardNo) {
      matches.push(lead.idCardNo.endsWith(criteria.idCardLast4));
    }
    if (matches.length === 0 || !matches.some(Boolean)) {
      throw new ForbiddenException(
        '填写的识别信息与邀约线索不一致，无法提交绑定申请',
      );
    }
  }

  private async resolveSystemOperator(): Promise<RequestUser> {
    const preferredRoles: UserRole[] = [
      UserRole.ADMIN,
      UserRole.NURSE,
      UserRole.DOCTOR,
    ];
    for (const role of preferredRoles) {
      const user = await this.prisma.user.findFirst({
        where: { role, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      if (user) {
        return {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
        };
      }
    }
    throw new BadRequestException(
      '系统未配置可用的审核账号，无法完成自助签约建档，请联系管理员',
    );
  }

  // --- 身份查询 helpers -------------------------------------------------------

  private async findLatestBindingSummary(demoOpenId: string) {
    const latest = await this.prisma.patientBindingRequest.findFirst({
      where: { demoOpenId },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) return null;
    return {
      id: latest.id,
      status: latest.status,
      patientId: latest.patientId,
      createdAt: latest.createdAt,
    };
  }

  private async findSignedLeadForCriteria(criteria: {
    hospitalPatientId?: string;
    phone?: string;
    idCardLast4?: string;
  }) {
    const conditions: Prisma.ChronicLeadWhereInput[] = [];
    if (criteria.hospitalPatientId) {
      conditions.push({ hospitalPatientId: criteria.hospitalPatientId });
    }
    if (criteria.phone) {
      conditions.push({ phone: criteria.phone });
    }
    if (criteria.idCardLast4 && /^\d{4}$/.test(criteria.idCardLast4)) {
      conditions.push({ idCardNo: { endsWith: criteria.idCardLast4 } });
    }
    if (conditions.length === 0) return null;

    return this.prisma.chronicLead.findFirst({
      where: { OR: conditions, status: LeadStatus.SIGNED },
      orderBy: { promotedAt: 'desc' },
    });
  }

  private async findPatientForCriteria(criteria: {
    hospitalPatientId?: string;
    phone?: string;
    idCardLast4?: string;
  }) {
    const conditions: Prisma.PatientWhereInput[] = [];
    if (criteria.hospitalPatientId) {
      conditions.push({ hospitalPatientId: criteria.hospitalPatientId });
    }
    if (criteria.phone) {
      conditions.push({ phone: criteria.phone });
    }
    if (criteria.idCardLast4 && /^\d{4}$/.test(criteria.idCardLast4)) {
      conditions.push({ idCardNo: { endsWith: criteria.idCardLast4 } });
    }
    if (conditions.length === 0) return null;

    return this.prisma.patient.findFirst({
      where: { OR: conditions },
      include: { diseaseProfiles: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async tryLookupHisPatient(
    hospitalPatientId: string,
  ): Promise<IdentitySnapshot | null> {
    try {
      const result = await this.hisIntegrationService.lookupPatientByBarcode(
        hospitalPatientId,
      );
      // 真实 HIS 接入后，这里会拿到带姓名的患者快照；当前预留模式返回空姓名。
      const hisPatient = result?.patient as
        | { name?: string; gender?: string; phone?: string }
        | undefined;
      if (
        result?.interfaceStatus === 'MOCK_PENDING_REAL_HIS' &&
        !safeString(hisPatient?.name)
      ) {
        return null;
      }
      if (!hisPatient || !safeString(hisPatient.name)) return null;
      return {
        name: safeString(hisPatient.name) || null,
        hospitalPatientId,
        phone: maskPhone(hisPatient.phone),
        idCardNo: null,
        gender: hisPatient.gender ?? null,
        suspectedDisease: null,
        diagnosisIcd: null,
        diagnosisText: null,
        riskHint: null,
        evidenceSummary: null,
        sourceChannel: 'HIS_STAGED',
      };
    } catch {
      return null;
    }
  }

  private leadSnapshot(lead: ChronicLead): IdentitySnapshot {
    return {
      name: lead.name,
      hospitalPatientId: lead.hospitalPatientId,
      phone: maskPhone(lead.phone),
      idCardNo: maskIdCard(lead.idCardNo),
      gender: lead.gender,
      suspectedDisease: lead.suspectedDisease,
      diagnosisIcd: lead.diagnosisIcd,
      diagnosisText: lead.diagnosisText,
      riskHint: lead.riskHint,
      evidenceSummary: lead.evidenceSummary,
      sourceChannel: lead.sourceChannel,
    };
  }

  private patientSnapshot(
    patient: Prisma.PatientGetPayload<{ include: { diseaseProfiles: true } }>,
  ): IdentitySnapshot {
    const profiles = patient.diseaseProfiles ?? [];
    const topProfile = [...profiles].sort(
      (a, b) => RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel],
    )[0];
    return {
      name: patient.name,
      hospitalPatientId: patient.hospitalPatientId,
      phone: maskPhone(patient.phone),
      idCardNo: maskIdCard(patient.idCardNo),
      gender: patient.gender,
      suspectedDisease: topProfile?.diseaseType ?? null,
      diagnosisIcd: null,
      diagnosisText: topProfile?.diseaseStage ?? null,
      riskHint: topProfile?.riskLevel ?? null,
      evidenceSummary:
        profiles.length > 1
          ? `本院已建档慢病 ${profiles.length} 项`
          : '本院已建档慢病患者',
      sourceChannel: 'EXISTING_PATIENT',
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

  async rejectBindingRequest(
    id: string,
    dto: RejectPatientBindingDto,
    user: RequestUser,
    ipAddress?: string,
  ) {
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

  async createVital(
    session: PatientSessionRequestContext,
    dto: CreateVitalRecordDto,
    ipAddress?: string,
  ) {
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
    const medication = await this.prisma.medicationRecord.findUnique({
      where: { id: medicationId },
    });
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
    const plan = await this.prisma.vitalMonitoringPlan.findUnique({
      where: { id: planId },
    });
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
