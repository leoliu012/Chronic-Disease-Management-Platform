import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AlertStatus,
  IntegrationPromotionStatus,
  Prisma,
  RiskLevel,
  TaskStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicalAccessScopeService } from '../security/clinical-access-scope.service';
import type { RequestUser } from '../security/request-user.type';
import { QueryWorkItemsDto, type WorkItemBucket } from './dto/query-work-items.dto';

const OPEN_TASK_STATUSES: TaskStatus[] = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS];
const OPEN_ALERT_STATUSES: AlertStatus[] = [AlertStatus.OPEN, AlertStatus.IN_PROGRESS];
const HOSPITAL_VISIT_TASK_TYPE = 'HOSPITAL_VISIT_FOLLOW_UP';
const QUESTIONNAIRE_REVIEW_TASK_TYPES = new Set(['QUESTIONNAIRE_REVIEW', 'CARE_PLAN_QUESTIONNAIRE_REVIEW']);
const DAY_MS = 24 * 60 * 60 * 1000;

const riskPriority: Record<RiskLevel, number> = {
  [RiskLevel.VERY_HIGH]: 0,
  [RiskLevel.HIGH]: 1,
  [RiskLevel.MEDIUM]: 2,
  [RiskLevel.LOW]: 3,
};

type PatientSummary = {
  id: string;
  name: string;
  hospitalPatientId?: string | null;
  phone?: string | null;
  responsibleDoctorId?: string | null;
  responsibleNurseId?: string | null;
  responsibleNurse?: { displayName: string } | null;
};

type WorkItem = {
  id: string;
  itemType:
    | 'FOLLOW_UP_TASK'
    | 'RISK_FOLLOW_UP_TASK'
    | 'HOSPITAL_VISIT_TASK'
    | 'RISK_ALERT_ONLY'
    | 'GATEWAY_CONFLICT'
    | 'CARE_REMINDER_ESCALATION'
    | 'CARE_PLAN_RECOMMENDATION'
    | 'PATIENT_SUBMISSION_REVIEW'
    | 'MANUAL_OUTBOUND_ACTION';
  sourceType:
    | 'TASK'
    | 'RISK_ALERT'
    | 'GATEWAY_CONFLICT'
    | 'CARE_REMINDER_OCCURRENCE'
    | 'NEXT_BEST_ACTION'
    | 'PATIENT_FORM_LINK'
    | 'PATIENT_OUTBOUND_MESSAGE';
  taskId?: string;
  alertId?: string;
  episodeId?: string;
  sourceId?: string;
  nextBestActionId?: string;
  title: string;
  description?: string | null;
  status: string;
  priority: number;
  riskLevel?: RiskLevel;
  dueAt?: Date | null;
  createdAt: Date;
  patient: PatientSummary | null;
  riskReason: string;
  mostRecentEvidence: string;
  waitingSeconds: number;
  slaRemainingSeconds: number | null;
  assignedStaff: string;
  recommendedAction: string;
  bucketKeys: WorkItemBucket[];
  triggerCount?: number;
  triggerRule?: string | null;
  actionUrl: string;
  actionText: string;
};

type MissedOccurrence = Prisma.CareReminderOccurrenceGetPayload<{
  include: { patient: { include: { responsibleNurse: true } }; schedule: true };
}>;

type GatewayConflict = Prisma.IntegrationSyncRecordGetPayload<{
  include: { source: true; batch: true };
}>;

type Recommendation = Prisma.NextBestActionGetPayload<{
  include: { patient: { include: { responsibleNurse: true } }; carePlan: true };
}>;

type PatientSubmissionReview = Prisma.PatientFormLinkGetPayload<{
  include: { patient: { include: { responsibleNurse: true } } };
}>;

type ManualOutboundMessage = Prisma.PatientOutboundMessageGetPayload<{
  include: { patient: { include: { responsibleNurse: true } } };
}>;

type Summary = {
  totalOpen: number;
  criticalRiskPendingActionCount: number;
  overdueTaskCount: number;
  telephoneFollowUpsDueTodayCount: number;
  failedContactRetryCount: number;
  referralAwaitingConfirmationCount: number;
  patientSubmissionsAwaitingReviewCount: number;
  gatewayConflictCount: number;
  manualOutboundActionRequiredCount: number;
  carePlanRecommendationCount: number;
  careReminderEscalationCount: number;
};

function patientSummary(patient?: PatientSummary | null): PatientSummary | null {
  if (!patient) return null;
  return {
    id: patient.id,
    name: patient.name,
    hospitalPatientId: patient.hospitalPatientId,
    phone: patient.phone,
    responsibleDoctorId: patient.responsibleDoctorId,
    responsibleNurseId: patient.responsibleNurseId,
    responsibleNurse: patient.responsibleNurse ? { displayName: patient.responsibleNurse.displayName } : null,
  };
}

function isOpenTask(status: TaskStatus) {
  return OPEN_TASK_STATUSES.includes(status);
}

function isOverdue(dueAt?: Date | null, now = new Date()) {
  return Boolean(dueAt && dueAt.getTime() < now.getTime());
}

function isDueToday(dueAt?: Date | null, now = new Date()) {
  if (!dueAt) return false;
  return dueAt.getFullYear() === now.getFullYear()
    && dueAt.getMonth() === now.getMonth()
    && dueAt.getDate() === now.getDate();
}

function secondsSince(value: Date, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / 1000));
}

function secondsUntil(value?: Date | null, now = new Date()) {
  if (!value) return null;
  return Math.floor((value.getTime() - now.getTime()) / 1000);
}

function conciseEvidence(value: unknown, fallback = '暂无结构化证据摘要') {
  if (value == null) return fallback;
  if (typeof value === 'string') return value.slice(0, 260);
  try {
    return JSON.stringify(value).slice(0, 260);
  } catch {
    return fallback;
  }
}

function taskPriority(
  task: { priority: number; dueAt?: Date | null; relatedAlertId?: string | null },
  riskLevel?: RiskLevel | null,
  now = new Date(),
) {
  if (isOverdue(task.dueAt, now)) return 0;
  return Math.min(task.priority, riskLevel ? riskPriority[riskLevel] : task.relatedAlertId ? 1 : 3);
}

function staffLabel(patient: PatientSummary | null, assigneeId?: string | null, assigneeDisplayName?: string | null) {
  if (assigneeDisplayName) return assigneeDisplayName;
  if (assigneeId && assigneeId === patient?.responsibleNurseId && patient.responsibleNurse?.displayName) {
    return patient.responsibleNurse.displayName;
  }
  if (assigneeId) return `已分配 (${assigneeId.slice(0, 8)})`;
  return patient?.responsibleNurse?.displayName ?? patient?.responsibleNurseId ?? '待分配';
}

function actionBuckets(item: Omit<WorkItem, 'bucketKeys'>, now: Date): WorkItemBucket[] {
  const buckets: WorkItemBucket[] = ['ALL'];
  if (item.riskLevel === RiskLevel.VERY_HIGH) buckets.push('CRITICAL_RISK');
  if (isOverdue(item.dueAt, now)) buckets.push('OVERDUE');
  if (
    isDueToday(item.dueAt, now)
    && (
      item.title.includes('电话随访')
      || item.recommendedAction.includes('PHONE')
      || item.recommendedAction.includes('电话')
    )
  ) buckets.push('PHONE_DUE_TODAY');
  if (item.sourceType === 'NEXT_BEST_ACTION' && item.recommendedAction === 'RETRY_CONTACT') {
    buckets.push('FAILED_CONTACT_RETRY');
  }
  if (
    item.itemType === 'HOSPITAL_VISIT_TASK'
    || (item.sourceType === 'NEXT_BEST_ACTION' && item.recommendedAction === 'REFERRAL_CONFIRMATION')
  ) buckets.push('REFERRAL_CONFIRMATION');
  if (
    item.itemType === 'PATIENT_SUBMISSION_REVIEW'
    || (item.sourceType === 'RISK_ALERT' && item.riskReason.includes('问卷'))
    || (item.sourceType === 'NEXT_BEST_ACTION' && item.recommendedAction === 'QUESTIONNAIRE_REVIEW')
    || (item.sourceType === 'TASK' && QUESTIONNAIRE_REVIEW_TASK_TYPES.has(item.recommendedAction))
  ) buckets.push('SUBMISSION_REVIEW');
  if (item.itemType === 'GATEWAY_CONFLICT') buckets.push('GATEWAY_CONFLICT');
  if (item.itemType === 'MANUAL_OUTBOUND_ACTION') buckets.push('MANUAL_OUTBOUND_ACTION');
  return buckets;
}

function withBuckets(item: Omit<WorkItem, 'bucketKeys'>, now: Date): WorkItem {
  return { ...item, bucketKeys: actionBuckets(item, now) };
}

function summarize(items: WorkItem[]): Summary {
  const count = (bucket: WorkItemBucket) => items.filter((item) => item.bucketKeys.includes(bucket)).length;
  return {
    totalOpen: items.length,
    criticalRiskPendingActionCount: count('CRITICAL_RISK'),
    overdueTaskCount: count('OVERDUE'),
    telephoneFollowUpsDueTodayCount: count('PHONE_DUE_TODAY'),
    failedContactRetryCount: count('FAILED_CONTACT_RETRY'),
    referralAwaitingConfirmationCount: count('REFERRAL_CONFIRMATION'),
    patientSubmissionsAwaitingReviewCount: count('SUBMISSION_REVIEW'),
    gatewayConflictCount: count('GATEWAY_CONFLICT'),
    manualOutboundActionRequiredCount: count('MANUAL_OUTBOUND_ACTION'),
    carePlanRecommendationCount: items.filter((item) => item.itemType === 'CARE_PLAN_RECOMMENDATION').length,
    careReminderEscalationCount: items.filter((item) => item.itemType === 'CARE_REMINDER_ESCALATION').length,
  };
}

@Injectable()
export class WorkItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClinicalAccessScopeService,
  ) {}

  async summary(query: QueryWorkItemsDto, user: RequestUser) {
    const response = await this.findAll({ ...query, bucket: 'ALL' }, user);
    return response.summary;
  }

  async findAll(query: QueryWorkItemsDto, user: RequestUser) {
    const now = new Date();
    const includeClosed = query.status === 'ALL';
    const taskScope = await this.access.buildTaskScope(user, query.hospitalTenantId);
    const patientScope = await this.access.buildPatientScope(user, query.hospitalTenantId);
    const alertScope = await this.access.buildAlertScope(user, query.hospitalTenantId);
    const patientFilter = query.patientId ? { patientId: query.patientId } : {};

    const taskWhere: Prisma.TaskWhereInput = {
      AND: [taskScope, patientFilter, ...(includeClosed ? [] : [{ status: { in: OPEN_TASK_STATUSES } }])],
    };

    const [tasks, openTasks, openAlerts, missedOccurrences, gatewayConflicts, recommendations, submissionReviews, manualOutboundMessages] = await Promise.all([
      this.prisma.task.findMany({
        where: taskWhere,
        include: { patient: { include: { responsibleNurse: true } }, riskEpisode: true },
        orderBy: [{ priority: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.task.findMany({
        where: { AND: [taskScope, patientFilter, { status: { in: OPEN_TASK_STATUSES } }] },
        select: { id: true, relatedAlertId: true, riskEpisodeId: true },
      }),
      this.prisma.riskAlert.findMany({
        where: { AND: [alertScope, patientFilter, { status: { in: OPEN_ALERT_STATUSES } }] },
        include: { patient: { include: { responsibleNurse: true } }, riskEpisode: true },
        orderBy: { createdAt: 'desc' },
      }),
      includeClosed
        ? Promise.resolve([] as MissedOccurrence[])
        : this.prisma.careReminderOccurrence.findMany({
            where: {
              patient: patientScope,
              ...(query.patientId ? { patientId: query.patientId } : {}),
              status: 'MISSED',
              escalatedTaskId: null,
            },
            include: { patient: { include: { responsibleNurse: true } }, schedule: true },
            orderBy: { missedAt: 'asc' },
            take: 200,
          }),
      user.role === UserRole.ADMIN && !query.patientId
        ? this.prisma.integrationSyncRecord.findMany({
            where: { promotionStatus: IntegrationPromotionStatus.CONFLICT },
            include: { source: true, batch: true },
            orderBy: { createdAt: 'asc' },
            take: 100,
          })
        : Promise.resolve([] as GatewayConflict[]),
      includeClosed
        ? Promise.resolve([] as Recommendation[])
        : this.prisma.nextBestAction.findMany({
            where: {
              patient: patientScope,
              ...(query.patientId ? { patientId: query.patientId } : {}),
              status: 'PROPOSED',
              activeKey: { not: null },
            },
            include: { patient: { include: { responsibleNurse: true } }, carePlan: true },
            orderBy: [{ priorityScore: 'desc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
            take: 300,
          }),
      includeClosed
        ? Promise.resolve([] as PatientSubmissionReview[])
        : this.prisma.patientFormLink.findMany({
            where: {
              patient: patientScope,
              ...(query.patientId ? { patientId: query.patientId } : {}),
              manualReviewStatus: 'PENDING',
              submittedAt: { not: null },
            },
            include: { patient: { include: { responsibleNurse: true } } },
            orderBy: [{ manualReviewDueAt: 'asc' }, { submittedAt: 'asc' }],
            take: 300,
          }),
      includeClosed
        ? Promise.resolve([] as ManualOutboundMessage[])
        : this.prisma.patientOutboundMessage.findMany({
            where: {
              patient: patientScope,
              ...(query.patientId ? { patientId: query.patientId } : {}),
              channel: 'MANUAL_COPY',
              status: 'MANUAL_ACTION_REQUIRED',
            },
            include: { patient: { include: { responsibleNurse: true } } },
            orderBy: { createdAt: 'asc' },
            take: 300,
          }),
    ]);

    const assigneeIds = [...new Set(tasks.map((task) => task.assigneeId).filter(Boolean) as string[])];
    const assignees = assigneeIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, displayName: true } })
      : [];
    const assigneeNameById = new Map(assignees.map((assignee) => [assignee.id, assignee.displayName]));
    const openTaskByAlertId = new Set(openTasks.map((task) => task.relatedAlertId).filter(Boolean) as string[]);
    const openTaskByEpisodeId = new Set(openTasks.map((task) => task.riskEpisodeId).filter(Boolean) as string[]);
    const alertById = new Map(openAlerts.map((alert) => [alert.id, alert]));

    const taskItems: WorkItem[] = tasks
      .filter((task) => includeClosed || isOpenTask(task.status))
      .map((task) => {
        const alert = task.relatedAlertId ? alertById.get(task.relatedAlertId) : null;
        const patient = patientSummary(task.patient);
        const isHospitalVisit = task.type === HOSPITAL_VISIT_TASK_TYPE;
        const isRisk = Boolean(task.relatedAlertId || task.riskEpisodeId);
        const riskLevel = alert?.riskLevel ?? task.riskEpisode?.peakRiskLevel;
        const riskReason = alert?.description ?? alert?.title ?? task.title;
        return withBuckets({
          id: `task:${task.id}`,
          itemType: isHospitalVisit ? 'HOSPITAL_VISIT_TASK' : isRisk ? 'RISK_FOLLOW_UP_TASK' : 'FOLLOW_UP_TASK',
          sourceType: 'TASK',
          taskId: task.id,
          alertId: task.relatedAlertId ?? undefined,
          episodeId: task.riskEpisodeId ?? undefined,
          title: isHospitalVisit ? `到院提醒任务：${task.title}` : isRisk ? `风险处置任务：${task.title}` : task.title,
          description: alert?.description ?? null,
          status: task.status,
          priority: taskPriority(task, riskLevel, now),
          riskLevel: riskLevel ?? undefined,
          dueAt: task.dueAt,
          createdAt: task.createdAt,
          patient,
          riskReason,
          mostRecentEvidence: conciseEvidence(alert?.inputSnapshot ?? task.riskEpisode?.latestEvidence, alert?.triggerRule ?? '来自护士任务'),
          waitingSeconds: secondsSince(task.createdAt, now),
          slaRemainingSeconds: secondsUntil(task.dueAt, now),
          assignedStaff: staffLabel(patient, task.assigneeId, task.assigneeId ? assigneeNameById.get(task.assigneeId) : undefined),
          recommendedAction: task.type,
          triggerCount: task.riskEpisode?.triggerCount,
          triggerRule: alert?.triggerRule,
          actionUrl: patient ? `/patients/${patient.id}/task-processing?taskId=${task.id}` : '/nurse-dashboard',
          actionText: isHospitalVisit ? '处理到院提醒' : '联系患者并记录处置',
        }, now);
      });

    const emittedEpisodeKeys = new Set<string>();
    const alertOnlyItems: WorkItem[] = [];
    for (const alert of openAlerts) {
      const episodeKey = alert.riskEpisodeId ?? `alert:${alert.id}`;
      if (emittedEpisodeKeys.has(episodeKey)) continue;
      emittedEpisodeKeys.add(episodeKey);
      if (openTaskByAlertId.has(alert.id)) continue;
      if (alert.riskEpisodeId && openTaskByEpisodeId.has(alert.riskEpisodeId)) continue;
      const patient = patientSummary(alert.patient);
      alertOnlyItems.push(withBuckets({
        id: `alert:${alert.id}`,
        itemType: 'RISK_ALERT_ONLY',
        sourceType: 'RISK_ALERT',
        alertId: alert.id,
        episodeId: alert.riskEpisodeId ?? undefined,
        title: `风险预警：${alert.title}`,
        description: alert.description,
        status: alert.status,
        priority: riskPriority[alert.riskLevel],
        riskLevel: alert.riskLevel,
        createdAt: alert.createdAt,
        patient,
        riskReason: alert.description ?? alert.title,
        mostRecentEvidence: conciseEvidence(alert.inputSnapshot, alert.triggerRule ?? '暂无输入快照'),
        waitingSeconds: secondsSince(alert.createdAt, now),
        slaRemainingSeconds: null,
        assignedStaff: staffLabel(patient),
        recommendedAction: 'CREATE_DISPOSITION_TASK',
        triggerCount: alert.riskEpisode?.triggerCount,
        triggerRule: alert.triggerRule,
        actionUrl: patient ? `/patients/${patient.id}?workspace=follow-up` : '/nurse-dashboard',
        actionText: '创建处置任务',
      }, now));
    }

    const reminderEscalationItems: WorkItem[] = missedOccurrences
      .filter((occurrence) => {
        const after = occurrence.schedule.escalationAfterMinutes;
        if (after == null) return false;
        const escalationAt = (occurrence.missedAt ?? occurrence.availableUntil).getTime() + after * 60_000;
        return escalationAt <= now.getTime();
      })
      .map((occurrence) => {
        const patient = patientSummary(occurrence.patient);
        return withBuckets({
          id: `care-reminder:${occurrence.id}`,
          itemType: 'CARE_REMINDER_ESCALATION',
          sourceType: 'CARE_REMINDER_OCCURRENCE',
          sourceId: occurrence.id,
          title: `患者遗漏提醒升级：${occurrence.title}`,
          description: '患者自管理动作已超过完成窗口且达到升级 SLA，提醒 worker 尚未附加护士任务。',
          status: occurrence.status,
          priority: 1,
          dueAt: occurrence.missedAt ?? occurrence.availableUntil,
          createdAt: occurrence.createdAt,
          patient,
          riskReason: '患者未在规定窗口内完成自管理动作',
          mostRecentEvidence: conciseEvidence({ dueAt: occurrence.dueAt, availableUntil: occurrence.availableUntil }),
          waitingSeconds: secondsSince(occurrence.missedAt ?? occurrence.availableUntil, now),
          slaRemainingSeconds: secondsUntil(occurrence.missedAt ?? occurrence.availableUntil, now),
          assignedStaff: staffLabel(patient),
          recommendedAction: 'REVIEW_MISSED_REMINDER',
          actionUrl: patient ? `/patients/${patient.id}?workspace=patient-engagement` : '/nurse-dashboard',
          actionText: '查看遗漏提醒',
        }, now);
      });

    const gatewayConflictItems: WorkItem[] = gatewayConflicts.map((record) => withBuckets({
      id: `gateway-conflict:${record.id}`,
      itemType: 'GATEWAY_CONFLICT',
      sourceType: 'GATEWAY_CONFLICT',
      sourceId: record.id,
      title: `接口冲突：${record.externalRecordType} / ${record.externalRecordId}`,
      description: record.promotionMessage ?? record.errorMessage ?? '网关记录无法自动落入正式患者档案，需要管理员核验。',
      status: record.promotionStatus,
      priority: 1,
      createdAt: record.createdAt,
      patient: null,
      riskReason: record.promotionMessage ?? record.errorMessage ?? '网关 promote 冲突',
      mostRecentEvidence: conciseEvidence(record.normalizedData ?? record.rawData, '暂无网关数据快照'),
      waitingSeconds: secondsSince(record.createdAt, now),
      slaRemainingSeconds: null,
      assignedStaff: '接口管理员',
      recommendedAction: 'RESOLVE_GATEWAY_CONFLICT',
      actionUrl: '/integrations?view=conflicts',
      actionText: '核验接口冲突',
    }, now));

    const recommendationItems: WorkItem[] = recommendations.map((action) => {
      const patient = patientSummary(action.patient);
      return withBuckets({
        id: `next-best-action:${action.id}`,
        itemType: 'CARE_PLAN_RECOMMENDATION',
        sourceType: 'NEXT_BEST_ACTION',
        nextBestActionId: action.id,
        sourceId: action.id,
        title: `患者级建议：${action.title}`,
        description: action.reasonSummary,
        status: action.status,
        priority: action.priorityScore >= 50 ? 0 : action.priorityScore >= 30 ? 1 : action.priorityScore >= 15 ? 2 : 3,
        riskLevel: action.carePlan.stratificationLevel,
        dueAt: action.dueAt,
        createdAt: action.firstProposedAt,
        patient,
        riskReason: action.reasonSummary,
        mostRecentEvidence: conciseEvidence(action.evidence),
        waitingSeconds: secondsSince(action.firstProposedAt, now),
        slaRemainingSeconds: secondsUntil(action.dueAt, now),
        assignedStaff: staffLabel(patient),
        recommendedAction: action.actionType,
        actionUrl: patient ? `/patients/${patient.id}` : '/nurse-dashboard',
        actionText: '创建处理任务',
      }, now);
    });

    const patientSubmissionReviewItems: WorkItem[] = submissionReviews.map((link) => {
      const patient = patientSummary(link.patient);
      return withBuckets({
        id: `patient-submission-review:${link.id}`,
        itemType: 'PATIENT_SUBMISSION_REVIEW',
        sourceType: 'PATIENT_FORM_LINK',
        sourceId: link.id,
        title: `患者提交待复核：${link.title}`,
        description: link.description,
        status: link.manualReviewStatus,
        priority: isOverdue(link.manualReviewDueAt, now) ? 0 : 2,
        dueAt: link.manualReviewDueAt,
        createdAt: link.submittedAt ?? link.updatedAt,
        patient,
        riskReason: '患者已完成健康管理提交，等待护士人工复核',
        mostRecentEvidence: conciseEvidence({
          formType: link.type,
          submissionType: link.submissionType,
          submissionId: link.submissionId,
          submittedAt: link.submittedAt,
        }),
        waitingSeconds: secondsSince(link.submittedAt ?? link.updatedAt, now),
        slaRemainingSeconds: secondsUntil(link.manualReviewDueAt, now),
        assignedStaff: staffLabel(patient),
        recommendedAction: 'REVIEW_PATIENT_SUBMISSION',
        actionUrl: patient ? `/patients/${patient.id}?workspace=patient-engagement&reviewFormLinkId=${link.id}` : '/nurse-dashboard',
        actionText: '确认已复核',
      }, now);
    });

    const manualOutboundItems: WorkItem[] = manualOutboundMessages.map((message) => {
      const patient = patientSummary(message.patient);
      return withBuckets({
        id: `manual-outbound:${message.id}`,
        itemType: 'MANUAL_OUTBOUND_ACTION',
        sourceType: 'PATIENT_OUTBOUND_MESSAGE',
        sourceId: message.id,
        title: `需要人工触达：${message.title}`,
        description: message.content,
        status: message.status,
        priority: 2,
        createdAt: message.createdAt,
        patient,
        riskReason: '患者没有可用的微信或短信电子渠道，需要护士人工复制链接并联系患者',
        mostRecentEvidence: conciseEvidence({
          channel: message.channel,
          createdAt: message.createdAt,
          formLinkId: message.formLinkId,
        }),
        waitingSeconds: secondsSince(message.createdAt, now),
        slaRemainingSeconds: null,
        assignedStaff: staffLabel(patient),
        recommendedAction: 'MANUAL_COPY_AND_CONTACT',
        actionUrl: patient ? `/patients/${patient.id}?workspace=patient-engagement` : '/nurse-dashboard',
        actionText: '复制链接并人工联系',
      }, now);
    });

    const allItems = [
      ...taskItems,
      ...alertOnlyItems,
      ...reminderEscalationItems,
      ...recommendationItems,
      ...patientSubmissionReviewItems,
      ...manualOutboundItems,
      ...gatewayConflictItems,
    ].sort((a, b) => a.priority - b.priority || (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) || a.createdAt.getTime() - b.createdAt.getTime());

    const queueSummary = summarize(allItems);
    const requestedBucket = query.bucket ?? 'ALL';
    const items = requestedBucket === 'ALL'
      ? allItems
      : allItems.filter((item) => item.bucketKeys.includes(requestedBucket));

    return { summary: queueSummary, activeBucket: requestedBucket, items };
  }

  async reviewPatientSubmission(formLinkId: string, note: string | undefined, user: RequestUser) {
    const link = await this.prisma.patientFormLink.findUnique({
      where: { id: formLinkId },
      select: { id: true, patientId: true, manualReviewStatus: true },
    });
    if (!link) throw new NotFoundException('Patient submission not found');
    await this.access.assertPatientWritable(user, link.patientId);
    if (link.manualReviewStatus !== 'PENDING') {
      throw new BadRequestException('该患者提交已不在待复核状态');
    }
    const result = await this.prisma.patientFormLink.updateMany({
      where: { id: formLinkId, manualReviewStatus: 'PENDING' },
      data: {
        manualReviewStatus: 'REVIEWED',
        manualReviewedAt: new Date(),
        manualReviewedBy: user.id,
        manualReviewNote: note?.trim() || '护士已完成人工复核。',
      },
    });
    if (result.count !== 1) throw new BadRequestException('该患者提交已被其他工作人员处理');
    return this.prisma.patientFormLink.findUnique({ where: { id: formLinkId } });
  }
}

