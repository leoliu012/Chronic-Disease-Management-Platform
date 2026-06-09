import { Injectable } from '@nestjs/common';
import {
  AlertStatus,
  IntegrationPromotionStatus,
  Prisma,
  RiskLevel,
  TaskStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryWorkItemsDto } from './dto/query-work-items.dto';
import { ClinicalAccessScopeService } from '../security/clinical-access-scope.service';
import type { RequestUser } from '../security/request-user.type';

const OPEN_TASK_STATUSES: TaskStatus[] = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS];
const OPEN_ALERT_STATUSES: AlertStatus[] = [AlertStatus.OPEN, AlertStatus.IN_PROGRESS];
const CLOSED_STATUSES = ['DONE', 'CANCELED', 'RESOLVED', 'DISMISSED'];
const HOSPITAL_VISIT_TASK_TYPE = 'HOSPITAL_VISIT_FOLLOW_UP';

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
};

type WorkItem = {
  id: string;
  itemType:
    | 'FOLLOW_UP_TASK'
    | 'RISK_FOLLOW_UP_TASK'
    | 'HOSPITAL_VISIT_TASK'
    | 'RISK_ALERT_ONLY'
    | 'GATEWAY_CONFLICT'
    | 'CARE_REMINDER_ESCALATION';
  sourceType: 'TASK' | 'RISK_ALERT' | 'GATEWAY_CONFLICT' | 'CARE_REMINDER_OCCURRENCE';
  taskId?: string;
  alertId?: string;
  episodeId?: string;
  sourceId?: string;
  title: string;
  description?: string | null;
  status: string;
  priority: number;
  riskLevel?: RiskLevel;
  dueAt?: Date | null;
  createdAt: Date;
  patient: PatientSummary | null;
  task?: unknown;
  alert?: unknown;
  episode?: unknown;
  triggerCount?: number;
  triggerRule?: string | null;
  actionUrl: string;
  actionText: string;
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
  };
}

function isOpenTask(status: TaskStatus) {
  return OPEN_TASK_STATUSES.includes(status);
}

function taskPriority(task: { priority: number; dueAt?: Date | null; relatedAlertId?: string | null }, riskLevel?: RiskLevel | null) {
  if (task.dueAt && task.dueAt.getTime() < Date.now()) return 0;
  return Math.min(task.priority, riskLevel ? riskPriority[riskLevel] : task.relatedAlertId ? 1 : 3);
}

@Injectable()
export class WorkItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClinicalAccessScopeService,
  ) {}

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

    const [tasks, openTasks, openAlerts, missedOccurrences, gatewayConflicts] = await Promise.all([
      this.prisma.task.findMany({
        where: taskWhere,
        include: { patient: true, riskEpisode: true },
        orderBy: [{ priority: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.task.findMany({
        where: { AND: [taskScope, patientFilter, { status: { in: OPEN_TASK_STATUSES } }] },
        select: { id: true, relatedAlertId: true, riskEpisodeId: true },
      }),
      this.prisma.riskAlert.findMany({
        where: { AND: [alertScope, patientFilter, { status: { in: OPEN_ALERT_STATUSES } }] },
        include: { patient: true, riskEpisode: true },
        orderBy: { createdAt: 'desc' },
      }),
      includeClosed
        ? Promise.resolve([])
        : this.prisma.careReminderOccurrence.findMany({
            where: {
              patient: patientScope,
              ...(query.patientId ? { patientId: query.patientId } : {}),
              status: 'MISSED',
              escalatedTaskId: null,
            },
            include: { patient: true, schedule: true },
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
        : Promise.resolve([]),
    ]);

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
        return {
          id: `task:${task.id}`,
          itemType: isHospitalVisit ? 'HOSPITAL_VISIT_TASK' : isRisk ? 'RISK_FOLLOW_UP_TASK' : 'FOLLOW_UP_TASK',
          sourceType: 'TASK',
          taskId: task.id,
          alertId: task.relatedAlertId ?? undefined,
          episodeId: task.riskEpisodeId ?? undefined,
          title: isHospitalVisit ? `到院提醒任务：${task.title}` : isRisk ? `风险处置任务：${task.title}` : task.title,
          description: alert?.description ?? null,
          status: task.status,
          priority: taskPriority(task, alert?.riskLevel),
          riskLevel: alert?.riskLevel ?? task.riskEpisode?.peakRiskLevel,
          dueAt: task.dueAt,
          createdAt: task.createdAt,
          patient,
          task,
          alert,
          episode: task.riskEpisode,
          triggerCount: task.riskEpisode?.triggerCount,
          triggerRule: alert?.triggerRule,
          actionUrl: patient ? `/patients/${patient.id}/task-processing?taskId=${task.id}` : '/nurse-dashboard',
          actionText: isHospitalVisit ? '处理到院提醒' : '进入任务处理页',
        };
      });

    // One alert-only projection per episode. Repeated evidence remains traceable
    // in RiskAlert, but never creates duplicate workbench rows.
    const emittedEpisodeKeys = new Set<string>();
    const alertOnlyItems: WorkItem[] = [];
    for (const alert of openAlerts) {
      const episodeKey = alert.riskEpisodeId ?? `alert:${alert.id}`;
      if (emittedEpisodeKeys.has(episodeKey)) continue;
      emittedEpisodeKeys.add(episodeKey);
      if (openTaskByAlertId.has(alert.id)) continue;
      if (alert.riskEpisodeId && openTaskByEpisodeId.has(alert.riskEpisodeId)) continue;
      const patient = patientSummary(alert.patient);
      alertOnlyItems.push({
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
        alert,
        episode: alert.riskEpisode,
        triggerCount: alert.riskEpisode?.triggerCount,
        triggerRule: alert.triggerRule,
        actionUrl: patient ? `/patients/${patient.id}?workspace=follow-up` : '/nurse-dashboard',
        actionText: '创建处置任务',
      });
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
        return {
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
          actionUrl: patient ? `/patients/${patient.id}?workspace=patient-engagement` : '/nurse-dashboard',
          actionText: '查看遗漏提醒',
        };
      });

    // IntegrationSyncRecord has no hospitalTenantId yet. Surface conflicts only
    // to ADMIN until source-to-hospital mapping is added; do not leak them to nurses.
    const gatewayConflictItems: WorkItem[] = gatewayConflicts.map((record) => ({
      id: `gateway-conflict:${record.id}`,
      itemType: 'GATEWAY_CONFLICT',
      sourceType: 'GATEWAY_CONFLICT',
      sourceId: record.id,
      title: `网关冲突待确认：${record.externalRecordType}`,
      description: record.promotionMessage ?? record.errorMessage ?? '外部记录无法自动归档，需要管理员人工核验。',
      status: record.promotionStatus,
      priority: 1,
      createdAt: record.createdAt,
      patient: null,
      actionUrl: '/integrations',
      actionText: '进入接口中心核验',
    }));

    const items = [...taskItems, ...alertOnlyItems, ...reminderEscalationItems, ...gatewayConflictItems]
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        const aDue = a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bDue = b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (aDue !== bDue) return aDue - bDue;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

    return {
      summary: {
        totalOpen: items.filter((item) => !CLOSED_STATUSES.includes(item.status)).length,
        regularTaskCount: items.filter((item) => item.itemType === 'FOLLOW_UP_TASK').length,
        riskTaskCount: items.filter((item) => item.itemType === 'RISK_FOLLOW_UP_TASK' || item.itemType === 'HOSPITAL_VISIT_TASK').length,
        alertOnlyCount: alertOnlyItems.length,
        gatewayConflictCount: gatewayConflictItems.length,
        careReminderEscalationCount: reminderEscalationItems.length,
        overdueCount: items.filter((item) => item.dueAt && item.dueAt.getTime() < now.getTime()).length,
      },
      items,
    };
  }
}
