import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  AlertStatus,
  DiseaseType,
  EncounterType,
  Prisma,
  RiskEpisodeStatus,
  RiskLevel,
  TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicalAccessScopeService } from '../security/clinical-access-scope.service';
import { AuditService } from '../security/audit.service';
import type { RequestUser } from '../security/request-user.type';
import { EnrollCarePlanDto } from './dto/enroll-care-plan.dto';
import { UpdateCarePlanStatusDto } from './dto/update-care-plan-status.dto';

const POLICY_VERSION = 'CARDIOMETABOLIC_PILOT_V1';
const ACTIVE_PLAN = 'ACTIVE';
const PROPOSED = 'PROPOSED';
const DAY_MS = 24 * 60 * 60 * 1000;

const PILOT_DISEASE_TYPES: DiseaseType[] = [
  DiseaseType.HYPERTENSION,
  DiseaseType.TYPE_2_DIABETES,
  DiseaseType.HYPERLIPIDEMIA,
  DiseaseType.OBESITY,
];
const PILOT_DISEASES = new Set<DiseaseType>(PILOT_DISEASE_TYPES);

type ActionCandidate = {
  actionType: string;
  title: string;
  reasonSummary: string;
  evidence: unknown[];
  priorityScore: number;
  requiresDoctor: boolean;
  dueWithinHours: number;
};

type CandidateAccumulator = Map<string, ActionCandidate>;

type CarePlanRecalculationContext = {
  actorType: 'USER' | 'SYSTEM';
  actorId: string;
};

const SYSTEM_REFRESH_CONTEXT: CarePlanRecalculationContext = {
  actorType: 'SYSTEM',
  actorId: 'SYSTEM_CARE_PLAN_REFRESH',
};

function earlierOf(existing: Date | null, candidate: Date) {
  return existing && existing.getTime() <= candidate.getTime() ? existing : candidate;
}

function jsonChanged(left: unknown, right: unknown) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function daysAgo(days: number, now: Date) {
  return new Date(now.getTime() - days * DAY_MS);
}

function hoursFromNow(hours: number, now: Date) {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

function riskForScore(score: number): RiskLevel {
  if (score >= 70) return RiskLevel.VERY_HIGH;
  if (score >= 40) return RiskLevel.HIGH;
  if (score >= 20) return RiskLevel.MEDIUM;
  return RiskLevel.LOW;
}

function reviewDaysForRisk(level: RiskLevel) {
  if (level === RiskLevel.VERY_HIGH) return 1;
  if (level === RiskLevel.HIGH) return 3;
  if (level === RiskLevel.MEDIUM) return 7;
  return 30;
}

function mergeCandidate(
  actions: CandidateAccumulator,
  actionType: string,
  args: Omit<ActionCandidate, 'actionType'>,
) {
  const current = actions.get(actionType);
  if (!current) {
    actions.set(actionType, { actionType, ...args });
    return;
  }
  current.priorityScore += args.priorityScore;
  current.requiresDoctor = current.requiresDoctor || args.requiresDoctor;
  current.dueWithinHours = Math.min(current.dueWithinHours, args.dueWithinHours);
  current.reasonSummary = `${current.reasonSummary}；${args.reasonSummary}`;
  current.evidence.push(...args.evidence);
}

@Injectable()
export class CarePlansService {
  private readonly logger = new Logger(CarePlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClinicalAccessScopeService,
    private readonly audit: AuditService,
  ) {}

  private asJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  async enrollPatient(patientId: string, dto: EnrollCarePlanDto, user: RequestUser) {
    await this.access.assertPatientWritable(user, patientId);
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      include: { diseaseProfiles: true },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const existing = await this.prisma.carePlan.findFirst({
      where: { patientId, status: ACTIVE_PLAN },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return this.recalculatePlan(existing.id, { actorType: 'USER', actorId: user.id });

    const pilotDiseaseTypes = patient.diseaseProfiles
      .map((profile) => profile.diseaseType)
      .filter((diseaseType) => PILOT_DISEASES.has(diseaseType));

    if (!pilotDiseaseTypes.length) {
      throw new BadRequestException('首期 CarePlan 仅支持高血压、2 型糖尿病、高脂血症和肥胖患者');
    }

    const plan = await this.prisma.carePlan.create({
      data: {
        patientId,
        activeKey: `${patientId}:ACTIVE`,
        cohort: dto.cohort ?? 'THREE_HIGHS',
        goals: this.asJson(
          dto.goals ?? [
            { goalType: 'BLOOD_PRESSURE_CONTROL', status: 'ACTIVE' },
            { goalType: 'GLUCOSE_CONTROL', status: 'ACTIVE' },
            { goalType: 'LDL_C_CONTROL', status: 'ACTIVE' },
            { goalType: 'WEIGHT_CONTROL', status: 'ACTIVE' },
            { goalType: 'MEDICATION_ADHERENCE', status: 'ACTIVE' },
            { goalType: 'REFERRAL_LOOP_CLOSURE', status: 'ACTIVE' },
          ],
        ),
        activeInterventions: this.asJson(dto.activeInterventions ?? []),
        followUpCadence: this.asJson({ policyVersion: POLICY_VERSION }),
        owningTeamId: dto.owningTeamId,
        createdBy: user.id,
      },
    });

    await this.audit.record({
      user,
      action: 'ENROLL_CARE_PLAN',
      targetType: 'CarePlan',
      targetId: plan.id,
      afterData: { patientId, cohort: plan.cohort, policyVersion: POLICY_VERSION },
    });

    return this.recalculatePlan(plan.id, { actorType: 'USER', actorId: user.id });
  }

  async updateStatus(id: string, dto: UpdateCarePlanStatusDto, user: RequestUser) {
    const existing = await this.prisma.carePlan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('CarePlan not found');
    await this.access.assertPatientWritable(user, existing.patientId);
    const now = new Date();
    const updated = await this.prisma.carePlan.update({
      where: { id },
      data: {
        status: dto.status,
        activeKey: dto.status === 'ACTIVE' ? `${existing.patientId}:ACTIVE` : null,
        pausedAt: dto.status === 'PAUSED' ? now : dto.status === 'ACTIVE' ? null : undefined,
        completedAt: dto.status === 'COMPLETED' ? now : dto.status === 'ACTIVE' ? null : undefined,
      },
    });
    await this.audit.record({
      user,
      action: 'UPDATE_CARE_PLAN_STATUS',
      targetType: 'CarePlan',
      targetId: id,
      afterData: { patientId: existing.patientId, status: dto.status, reason: dto.reason },
    });
    return updated;
  }

  async listByPatient(patientId: string, user: RequestUser) {
    await this.access.assertPatientVisible(user, patientId);
    return this.prisma.carePlan.findMany({
      where: { patientId },
      include: {
        riskStratifications: { orderBy: { calculatedAt: 'desc' }, take: 10 },
        nextBestActions: { orderBy: [{ status: 'asc' }, { priorityScore: 'desc' }, { createdAt: 'desc' }] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPrioritized(user: RequestUser, limit = 20, hospitalTenantId?: string) {
    const patientScope = await this.access.buildPatientScope(user, hospitalTenantId);
    return this.prisma.carePlan.findMany({
      where: { status: ACTIVE_PLAN, patient: patientScope },
      include: {
        patient: true,
        nextBestActions: {
          where: { status: PROPOSED, activeKey: { not: null } },
          orderBy: [{ priorityScore: 'desc' }, { dueAt: 'asc' }],
        },
        riskStratifications: { orderBy: { calculatedAt: 'desc' }, take: 1 },
      },
      orderBy: [{ stratificationLevel: 'desc' }, { nextReviewAt: 'asc' }, { updatedAt: 'desc' }],
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async listActions(patientId: string, user: RequestUser) {
    await this.access.assertPatientVisible(user, patientId);
    return this.prisma.nextBestAction.findMany({
      where: { patientId },
      orderBy: [{ status: 'asc' }, { priorityScore: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async ensurePilotPlans(limit = 500) {
    const patients = await this.prisma.patient.findMany({
      where: {
        diseaseProfiles: { some: { diseaseType: { in: PILOT_DISEASE_TYPES } } },
        // Auto-enrollment is first-enrollment only. A paused or completed plan is
        // an explicit clinical decision; do not silently create a replacement plan.
        carePlans: { none: {} },
      },
      select: { id: true },
      take: Math.min(Math.max(limit, 1), 2000),
    });
    let enrolled = 0;
    for (const patient of patients) {
      const activeKey = `${patient.id}:ACTIVE`;
      await this.prisma.carePlan.upsert({
        where: { activeKey },
        update: {},
        create: {
          patientId: patient.id,
          activeKey,
          cohort: 'THREE_HIGHS',
          goals: this.asJson([
            { goalType: 'BLOOD_PRESSURE_CONTROL', status: 'ACTIVE' },
            { goalType: 'GLUCOSE_CONTROL', status: 'ACTIVE' },
            { goalType: 'LDL_C_CONTROL', status: 'ACTIVE' },
            { goalType: 'WEIGHT_CONTROL', status: 'ACTIVE' },
            { goalType: 'MEDICATION_ADHERENCE', status: 'ACTIVE' },
            { goalType: 'REFERRAL_LOOP_CLOSURE', status: 'ACTIVE' },
          ]),
          activeInterventions: this.asJson([]),
          followUpCadence: this.asJson({ policyVersion: POLICY_VERSION }),
          createdBy: 'SYSTEM_CARE_PLAN_WORKER',
        },
      });
      enrolled += 1;
    }
    return { enrolled };
  }

  async refreshActivePlans(limit = 500) {
    const { enrolled } = await this.ensurePilotPlans(limit);
    const plans = await this.prisma.carePlan.findMany({
      where: { status: ACTIVE_PLAN },
      select: { id: true, patientId: true, version: true },
      orderBy: { updatedAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 2000),
    });
    let refreshed = 0;
    let unchanged = 0;
    let failed = 0;
    const failedPatientIds: string[] = [];
    const errorSummaries: Array<{ patientId: string; planId: string; error: string }> = [];

    for (const plan of plans) {
      try {
        const result = await this.recalculatePlan(plan.id, SYSTEM_REFRESH_CONTEXT);
        if (result?.version === plan.version) unchanged += 1;
        else refreshed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed += 1;
        failedPatientIds.push(plan.patientId);
        errorSummaries.push({ patientId: plan.patientId, planId: plan.id, error: message.slice(0, 500) });
        this.logger.error(`care-plan refresh failed patient=${plan.patientId} plan=${plan.id}: ${message}`);
      }
    }

    return {
      enrolled,
      refreshed,
      unchanged,
      failed,
      failedPatientIds,
      errorSummaries,
      policyVersion: POLICY_VERSION,
    };
  }

  async recalculateByPatient(patientId: string, user: RequestUser) {
    await this.access.assertPatientWritable(user, patientId);
    const plan = await this.prisma.carePlan.findFirst({
      where: { patientId, status: ACTIVE_PLAN },
      orderBy: { createdAt: 'desc' },
    });
    if (!plan) throw new NotFoundException('Active CarePlan not found');
    return this.recalculatePlan(plan.id, { actorType: 'USER', actorId: user.id });
  }

  async recalculatePlan(planId: string, context: CarePlanRecalculationContext) {
    const now = new Date();
    const plan = await this.prisma.carePlan.findUnique({
      where: { id: planId },
      include: { patient: { include: { diseaseProfiles: true } } },
    });
    if (!plan) throw new NotFoundException('CarePlan not found');
    if (plan.status !== ACTIVE_PLAN) return plan;

    const patientId = plan.patientId;
    const thirtyDaysAgo = daysAgo(30, now);
    const fourteenDaysAgo = daysAgo(14, now);
    const sevenDaysAgo = daysAgo(7, now);
    const ninetyDaysAgo = daysAgo(90, now);

    const [
      vitals,
      medicationOccurrences,
      failedMessages,
      openAlerts,
      openEpisodes,
      visitReminders,
      recentEncounters,
    ] = await Promise.all([
      this.prisma.vitalRecord.findMany({
        where: { patientId, measuredAt: { gte: ninetyDaysAgo } },
        orderBy: { measuredAt: 'desc' },
      }),
      this.prisma.careReminderOccurrence.findMany({
        where: {
          patientId,
          occurrenceType: 'MEDICATION_CHECKIN',
          dueAt: { gte: thirtyDaysAgo, lte: now },
          status: { not: 'CANCELED' },
        },
        orderBy: { dueAt: 'desc' },
      }),
      this.prisma.patientOutboundMessage.findMany({
        where: { patientId, status: 'FAILED', createdAt: { gte: fourteenDaysAgo } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.riskAlert.findMany({
        where: { patientId, status: { in: [AlertStatus.OPEN, AlertStatus.IN_PROGRESS] } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.riskEpisode.findMany({
        where: { patientId, status: { in: [RiskEpisodeStatus.OPEN, RiskEpisodeStatus.IN_PROGRESS] } },
        orderBy: { lastTriggeredAt: 'desc' },
      }),
      this.prisma.hospitalVisitReminder.findMany({
        where: { patientId, status: 'ACTIVE' },
        orderBy: { remindedAt: 'asc' },
      }),
      this.prisma.encounterRecord.findMany({
        where: { patientId, visitTime: { gte: thirtyDaysAgo } },
        orderBy: { visitTime: 'desc' },
      }),
    ]);

    const diseaseTypes = new Set(plan.patient.diseaseProfiles.map((profile) => profile.diseaseType));
    const actions: CandidateAccumulator = new Map();
    const stratificationReasons: unknown[] = [];
    let priorityScore = 0;
    const addScore = (score: number, reason: unknown) => {
      priorityScore += score;
      stratificationReasons.push(reason);
    };

    const bpVitals = vitals.filter((vital) => ['SYSTOLIC_BP', 'DIASTOLIC_BP'].includes(vital.type));
    const recentAbnormalBp = bpVitals.filter((vital) => vital.isAbnormal && vital.measuredAt >= sevenDaysAgo);
    if (diseaseTypes.has(DiseaseType.HYPERTENSION) && recentAbnormalBp.length >= 5) {
      addScore(35, { code: 'BP_POOR_CONTROL_7D', abnormalCount: recentAbnormalBp.length });
      mergeCandidate(actions, 'PHONE_FOLLOW_UP', {
        title: '电话随访：近 7 天血压持续控制不佳',
        reasonSummary: `近 7 天血压异常记录 ${recentAbnormalBp.length} 次`,
        evidence: recentAbnormalBp.slice(0, 8).map((v) => ({ id: v.id, type: v.type, value: v.value, unit: v.unit, measuredAt: v.measuredAt })),
        priorityScore: 35,
        requiresDoctor: false,
        dueWithinHours: 24,
      });
    }

    const latestBp = bpVitals[0];
    if (diseaseTypes.has(DiseaseType.HYPERTENSION) && (!latestBp || latestBp.measuredAt < sevenDaysAgo)) {
      addScore(20, { code: 'BP_MEASUREMENT_MISSING_7D', latestMeasuredAt: latestBp?.measuredAt ?? null });
      mergeCandidate(actions, 'REQUEST_BP_MEASUREMENT', {
        title: '联系患者：连续 7 天未提交血压',
        reasonSummary: '高血压患者连续 7 天未提交家庭血压',
        evidence: [{ latestMeasuredAt: latestBp?.measuredAt ?? null }],
        priorityScore: 20,
        requiresDoctor: false,
        dueWithinHours: 24,
      });
    }

    // A submitted dose is not automatically adherent: patients can explicitly
    // report `taken = false`.  Use reminder occurrences as the denominator so
    // missed submissions remain visible, and only linked MedicationCheckIn rows
    // with taken=true as the numerator.
    const medicationResultIds = medicationOccurrences
      .filter((item) => item.status === 'COMPLETED' && item.resultType === 'MedicationCheckIn' && item.resultId)
      .map((item) => item.resultId as string);
    const medicationCheckIns = medicationResultIds.length
      ? await this.prisma.medicationCheckIn.findMany({
          where: { patientId, id: { in: medicationResultIds } },
          select: { id: true, taken: true, checkedAt: true },
        })
      : [];
    const takenCheckInIds = new Set(medicationCheckIns.filter((item) => item.taken).map((item) => item.id));
    const medicationTaken = medicationOccurrences.filter((item) => Boolean(item.resultId && takenCheckInIds.has(item.resultId))).length;
    if (medicationOccurrences.length >= 3) {
      const adherence = medicationTaken / medicationOccurrences.length;
      if (adherence < 0.7) {
        addScore(25, { code: 'MEDICATION_ADHERENCE_LT_70', taken: medicationTaken, total: medicationOccurrences.length, adherence });
        mergeCandidate(actions, 'MEDICATION_ADHERENCE_REVIEW', {
          title: '电话随访：近 30 天服药依从性低于 70%',
          reasonSummary: `近 30 天按计划服药率 ${Math.round(adherence * 100)}%`,
          evidence: [{ taken: medicationTaken, total: medicationOccurrences.length, adherence }],
          priorityScore: 25,
          requiresDoctor: false,
          dueWithinHours: 24,
        });
      }
    }

    const glucoseVitals = vitals.filter((vital) => vital.type === 'BLOOD_GLUCOSE');
    const latestGlucose = glucoseVitals[0];
    if (diseaseTypes.has(DiseaseType.TYPE_2_DIABETES) && (!latestGlucose || latestGlucose.measuredAt < fourteenDaysAgo)) {
      addScore(20, { code: 'GLUCOSE_MEASUREMENT_MISSING_14D', latestMeasuredAt: latestGlucose?.measuredAt ?? null });
      mergeCandidate(actions, 'REQUEST_GLUCOSE_MEASUREMENT', {
        title: '联系患者：连续 14 天未提交血糖',
        reasonSummary: '糖尿病患者连续 14 天未提交血糖',
        evidence: [{ latestMeasuredAt: latestGlucose?.measuredAt ?? null }],
        priorityScore: 20,
        requiresDoctor: false,
        dueWithinHours: 24,
      });
    }

    const lastThreeGlucose = glucoseVitals.slice(0, 3);
    if (lastThreeGlucose.length === 3 && lastThreeGlucose.every((vital) => vital.isAbnormal)) {
      addScore(30, { code: 'GLUCOSE_ABNORMAL_THREE_CONSECUTIVE', vitalRecordIds: lastThreeGlucose.map((vital) => vital.id) });
      mergeCandidate(actions, 'PHONE_FOLLOW_UP', {
        title: '电话随访：连续 3 次血糖异常',
        reasonSummary: '最近 3 次血糖记录均异常',
        evidence: lastThreeGlucose.map((vital) => ({ id: vital.id, value: vital.value, unit: vital.unit, measuredAt: vital.measuredAt })),
        priorityScore: 30,
        requiresDoctor: true,
        dueWithinHours: 24,
      });
    }

    const latestHba1c = vitals.find((vital) => vital.type === 'HBA1C');
    if (diseaseTypes.has(DiseaseType.TYPE_2_DIABETES) && (!latestHba1c || latestHba1c.measuredAt < ninetyDaysAgo)) {
      addScore(20, { code: 'HBA1C_OVERDUE_90D', latestMeasuredAt: latestHba1c?.measuredAt ?? null });
      mergeCandidate(actions, 'HBA1C_REVIEW_OVERDUE', {
        title: '复查提醒：HbA1c 随访检查逾期',
        reasonSummary: '糖尿病患者近 90 天无 HbA1c 记录',
        evidence: [{ latestMeasuredAt: latestHba1c?.measuredAt ?? null }],
        priorityScore: 20,
        requiresDoctor: false,
        dueWithinHours: 72,
      });
    }

    const highQuestionnaireAlerts = openAlerts.filter((alert) => alert.riskType === 'QUESTIONNAIRE_HIGH_RISK');
    if (highQuestionnaireAlerts.length) {
      addScore(30, { code: 'QUESTIONNAIRE_HIGH_RISK_UNREVIEWED', alertIds: highQuestionnaireAlerts.map((alert) => alert.id) });
      mergeCandidate(actions, 'QUESTIONNAIRE_REVIEW', {
        title: '人工复核：高风险问卷尚未闭环',
        reasonSummary: `存在 ${highQuestionnaireAlerts.length} 条未闭环高风险问卷预警`,
        evidence: highQuestionnaireAlerts.slice(0, 5).map((alert) => ({ id: alert.id, title: alert.title, createdAt: alert.createdAt })),
        priorityScore: 30,
        requiresDoctor: false,
        dueWithinHours: 24,
      });
    }

    if (failedMessages.length) {
      addScore(15, { code: 'LATEST_CONTACT_FAILED', messageIds: failedMessages.map((message) => message.id) });
      mergeCandidate(actions, 'RETRY_CONTACT', {
        title: '重新触达：最近一次患者联系失败',
        reasonSummary: '短信或微信触达失败，需要人工确认电话并重试',
        evidence: failedMessages.map((message) => ({ id: message.id, channel: message.channel, errorMessage: message.errorMessage, createdAt: message.createdAt })),
        priorityScore: 15,
        requiresDoctor: false,
        dueWithinHours: 24,
      });
    }

    const overdueVisitReminders = visitReminders.filter((reminder) => reminder.remindedAt < sevenDaysAgo);
    if (overdueVisitReminders.length) {
      addScore(25, { code: 'REFERRAL_CONFIRMATION_OVERDUE_7D', reminderIds: overdueVisitReminders.map((reminder) => reminder.id) });
      mergeCandidate(actions, 'REFERRAL_CONFIRMATION', {
        title: '转诊追踪：7 天内尚未确认回院',
        reasonSummary: '转诊或到院提醒超过 7 天仍未闭环',
        evidence: overdueVisitReminders.map((reminder) => ({ id: reminder.id, reason: reminder.reason, remindedAt: reminder.remindedAt })),
        priorityScore: 25,
        requiresDoctor: false,
        dueWithinHours: 24,
      });
    }

    const acuteEncounterTypes: EncounterType[] = [EncounterType.INPATIENT, EncounterType.EMERGENCY];
    const acuteEncounters = recentEncounters.filter((encounter) => acuteEncounterTypes.includes(encounter.visitType));
    if (acuteEncounters.length) {
      addScore(25, { code: 'RECENT_ACUTE_ENCOUNTER_30D', encounterIds: acuteEncounters.map((encounter) => encounter.id) });
      mergeCandidate(actions, 'POST_DISCHARGE_FOLLOW_UP', {
        title: '出院后随访：近期住院或急诊患者',
        reasonSummary: '患者近 30 天有住院或急诊记录',
        evidence: acuteEncounters.slice(0, 5).map((encounter) => ({ id: encounter.id, visitType: encounter.visitType, visitTime: encounter.visitTime })),
        priorityScore: 25,
        requiresDoctor: false,
        dueWithinHours: 24,
      });
    }

    const pilotDiseaseCount = [...diseaseTypes].filter((diseaseType) => PILOT_DISEASES.has(diseaseType)).length;
    if (pilotDiseaseCount >= 3) {
      addScore(15, { code: 'MULTIMORBIDITY_THREE_HIGHS', diseaseCount: pilotDiseaseCount, diseaseTypes: [...diseaseTypes] });
      mergeCandidate(actions, 'MULTIMORBIDITY_REVIEW', {
        title: '综合评估：多病共管患者',
        reasonSummary: `患者同时存在 ${pilotDiseaseCount} 项心代谢慢病`,
        evidence: [{ diseaseTypes: [...diseaseTypes] }],
        priorityScore: 15,
        requiresDoctor: true,
        dueWithinHours: 168,
      });
    }

    const veryHighEpisodes = openEpisodes.filter((episode) => episode.peakRiskLevel === RiskLevel.VERY_HIGH);
    if (veryHighEpisodes.length) {
      addScore(50, { code: 'OPEN_VERY_HIGH_RISK_EPISODE', episodeIds: veryHighEpisodes.map((episode) => episode.id) });
      mergeCandidate(actions, 'URGENT_RISK_REVIEW', {
        title: '立即处理：存在开放的极高危风险事件',
        reasonSummary: '患者存在尚未闭环的极高危 RiskEpisode',
        evidence: veryHighEpisodes.map((episode) => ({ id: episode.id, riskCategory: episode.riskCategory, lastTriggeredAt: episode.lastTriggeredAt })),
        priorityScore: 50,
        requiresDoctor: true,
        dueWithinHours: 4,
      });
    }

    const riskLevel = riskForScore(priorityScore);
    const calculatedAt = new Date();
    const nextReviewAt = new Date(calculatedAt.getTime() + reviewDaysForRisk(riskLevel) * DAY_MS);
    const candidates = [...actions.values()];
    const candidateKeys = candidates.map((candidate) => `${plan.id}:${candidate.actionType}`);
    const snapshotHash = sha256({
      policyVersion: POLICY_VERSION,
      riskLevel,
      priorityScore,
      stratificationReasons,
      candidates: candidates
        .map((candidate) => ({
          actionType: candidate.actionType,
          title: candidate.title,
          reasonSummary: candidate.reasonSummary,
          evidence: candidate.evidence,
          priorityScore: candidate.priorityScore,
          requiresDoctor: candidate.requiresDoctor,
          dueWithinHours: candidate.dueWithinHours,
        }))
        .sort((left, right) => left.actionType.localeCompare(right.actionType)),
    });

    if (plan.currentSnapshotHash === snapshotHash) {
      return this.prisma.carePlan.findUnique({
        where: { id: plan.id },
        include: {
          patient: true,
          riskStratifications: { orderBy: { calculatedAt: 'desc' }, take: 5 },
          nextBestActions: { where: { status: PROPOSED }, orderBy: [{ priorityScore: 'desc' }, { dueAt: 'asc' }] },
        },
      });
    }

    await this.prisma.$transaction(async (tx) => {
      // Atomic snapshot claim: concurrent manual recalculations with identical
      // evidence must not both append history or increment CarePlan.version.
      const claimedPlan = await tx.carePlan.updateMany({
        where: {
          id: plan.id,
          OR: [
            { currentSnapshotHash: null },
            { currentSnapshotHash: { not: snapshotHash } },
          ],
        },
        data: {
          stratificationLevel: riskLevel,
          nextReviewAt,
          followUpCadence: this.asJson({ policyVersion: POLICY_VERSION, reviewEveryDays: reviewDaysForRisk(riskLevel) }),
          referralStatus: overdueVisitReminders.length ? 'OVERDUE_CONFIRMATION' : visitReminders.length ? 'AWAITING_CONFIRMATION' : 'NONE',
          currentSnapshotHash: snapshotHash,
          version: { increment: 1 },
        },
      });
      if (claimedPlan.count !== 1) return;

      await tx.nextBestAction.updateMany({
        where: {
          carePlanId: plan.id,
          status: PROPOSED,
          AND: [
            { activeKey: { not: null } },
            ...(candidateKeys.length ? [{ activeKey: { notIn: candidateKeys } }] : []),
          ],
        },
        data: { status: 'EXPIRED', activeKey: null, expiresAt: calculatedAt },
      });

      for (const candidate of candidates) {
        const activeKey = `${plan.id}:${candidate.actionType}`;
        const calculatedDueAt = hoursFromNow(candidate.dueWithinHours, calculatedAt);
        const calculatedExpiresAt = hoursFromNow(
          Math.max(candidate.dueWithinHours * 3, 72),
          calculatedAt,
        );
        const evidence = this.asJson(candidate.evidence);
        const existing = await tx.nextBestAction.findUnique({ where: { activeKey } });

        if (existing) {
          const evidenceHasChanged = jsonChanged(existing.evidence, candidate.evidence);
          await tx.nextBestAction.update({
            where: { id: existing.id },
            data: {
              title: candidate.title,
              reasonSummary: candidate.reasonSummary,
              evidence,
              priorityScore: candidate.priorityScore,
              requiresDoctor: candidate.requiresDoctor,
              // Periodic refreshes may tighten an SLA, but must never move an
              // active recommendation's deadline or expiry later.
              dueAt: earlierOf(existing.dueAt, calculatedDueAt),
              expiresAt: earlierOf(existing.expiresAt, calculatedExpiresAt),
              policyVersion: POLICY_VERSION,
              deadlinePolicyVersion: POLICY_VERSION,
              ...(evidenceHasChanged ? { lastEvidenceChangedAt: calculatedAt } : {}),
            },
          });
        } else {
          await tx.nextBestAction.create({
            data: {
              carePlanId: plan.id,
              patientId,
              actionType: candidate.actionType,
              actionKey: candidate.actionType,
              activeKey,
              title: candidate.title,
              reasonSummary: candidate.reasonSummary,
              evidence,
              priorityScore: candidate.priorityScore,
              requiresDoctor: candidate.requiresDoctor,
              dueAt: calculatedDueAt,
              expiresAt: calculatedExpiresAt,
              policyVersion: POLICY_VERSION,
              deadlinePolicyVersion: POLICY_VERSION,
              firstProposedAt: calculatedAt,
              lastEvidenceChangedAt: calculatedAt,
            },
          });
        }
      }

      await tx.patientRiskStratification.upsert({
        where: {
          carePlanId_snapshotHash: {
            carePlanId: plan.id,
            snapshotHash,
          },
        },
        update: {},
        create: {
          carePlanId: plan.id,
          patientId,
          riskLevel,
          priorityScore,
          reasons: this.asJson(stratificationReasons),
          policyVersion: POLICY_VERSION,
          snapshotHash,
          calculatedAt,
        },
      });

      await tx.auditLog.create({
        data: {
          operatorId: context.actorId,
          action: context.actorType === 'SYSTEM'
            ? 'SYSTEM_CARE_PLAN_REFRESH'
            : 'USER_CARE_PLAN_RECALCULATE',
          targetType: 'CarePlan',
          targetId: plan.id,
          afterData: this.asJson({
            actorType: context.actorType,
            patientId,
            policyVersion: POLICY_VERSION,
            riskLevel,
            priorityScore,
            snapshotHash,
            candidateCount: candidates.length,
          }),
        },
      });
    });

    return this.prisma.carePlan.findUnique({
      where: { id: plan.id },
      include: {
        patient: true,
        riskStratifications: { orderBy: { calculatedAt: 'desc' }, take: 5 },
        nextBestActions: { where: { status: PROPOSED }, orderBy: [{ priorityScore: 'desc' }, { dueAt: 'asc' }] },
      },
    });
  }

  async createTaskFromAction(id: string, user: RequestUser) {
    const action = await this.prisma.nextBestAction.findUnique({ where: { id } });
    if (!action) throw new NotFoundException('NextBestAction not found');
    await this.access.assertPatientWritable(user, action.patientId);

    const assigneeId = await this.access.resolveTaskAssignee(user, action.patientId);
    const result = await this.prisma.$transaction(async (tx) => {
      const existingBySource = await tx.task.findUnique({
        where: { sourceNextBestActionId: id },
      });
      if (existingBySource) {
        await tx.nextBestAction.updateMany({
          where: { id, linkedTaskId: null },
          data: {
            status: 'ACCEPTED',
            activeKey: null,
            linkedTaskId: existingBySource.id,
            acceptedBy: user.id,
            acceptedAt: new Date(),
          },
        });
        return { task: existingBySource, created: false };
      }

      const current = await tx.nextBestAction.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('NextBestAction not found');
      if (current.linkedTaskId) {
        const linked = await tx.task.findUnique({ where: { id: current.linkedTaskId } });
        if (linked) return { task: linked, created: false };
      }
      if (!['PROPOSED', 'ACCEPTED'].includes(current.status)) {
        throw new BadRequestException('Only active recommendations can create a task');
      }

      // Atomic claim. Only one concurrent request may progress to task creation.
      const claimed = await tx.nextBestAction.updateMany({
        where: {
          id,
          linkedTaskId: null,
          status: { in: ['PROPOSED', 'ACCEPTED'] },
        },
        data: {
          status: 'ACCEPTING',
          activeKey: null,
          acceptedBy: user.id,
          acceptedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('NextBestAction is already being accepted');
      }

      const created = await tx.task.create({
        data: {
          sourceNextBestActionId: id,
          patientId: current.patientId,
          title: current.title,
          type: `CARE_PLAN_${current.actionType}`,
          status: TaskStatus.PENDING,
          dueAt: current.dueAt ?? undefined,
          assigneeId,
          priority: current.priorityScore >= 50 ? 0 : current.priorityScore >= 30 ? 1 : 2,
        },
      });
      await tx.nextBestAction.update({
        where: { id },
        data: {
          status: 'ACCEPTED',
          activeKey: null,
          linkedTaskId: created.id,
        },
      });
      await tx.taskProcessingEvent.create({
        data: {
          taskId: created.id,
          patientId: current.patientId,
          eventType: 'CREATED_FROM_NEXT_BEST_ACTION',
          title: '由患者级分层建议生成处置任务',
          description: current.reasonSummary,
          sourceType: 'NextBestAction',
          sourceId: id,
          operatorId: user.id,
        },
      });
      return { task: created, created: true };
    });

    if (result.created) {
      await this.audit.record({
        user,
        action: 'CREATE_TASK_FROM_NEXT_BEST_ACTION',
        targetType: 'NextBestAction',
        targetId: id,
        afterData: {
          patientId: action.patientId,
          taskId: result.task.id,
          actionType: action.actionType,
        },
      });
    }
    return result.task;
  }

  async dismissAction(id: string, reason: string, user: RequestUser) {
    const action = await this.prisma.nextBestAction.findUnique({ where: { id } });
    if (!action) throw new NotFoundException('NextBestAction not found');
    await this.access.assertPatientWritable(user, action.patientId);
    if (action.status !== PROPOSED) throw new BadRequestException('Only proposed actions can be dismissed');
    const updated = await this.prisma.nextBestAction.update({
      where: { id },
      data: {
        status: 'DISMISSED',
        activeKey: null,
        dismissedBy: user.id,
        dismissedAt: new Date(),
        dismissReason: reason,
      },
    });
    await this.audit.record({
      user,
      action: 'DISMISS_NEXT_BEST_ACTION',
      targetType: 'NextBestAction',
      targetId: id,
      afterData: { patientId: action.patientId, reason },
    });
    return updated;
  }
}
