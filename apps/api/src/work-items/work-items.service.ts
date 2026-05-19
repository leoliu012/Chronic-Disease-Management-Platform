import { Injectable } from '@nestjs/common';
import { AlertStatus, Prisma, RiskLevel, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryWorkItemsDto } from './dto/query-work-items.dto';

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
  itemType: 'FOLLOW_UP_TASK' | 'RISK_FOLLOW_UP_TASK' | 'RISK_ALERT_ONLY';
  sourceType: 'TASK' | 'RISK_ALERT';
  taskId?: string;
  alertId?: string;
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
  triggerRule?: string | null;
  actionUrl: string;
  actionText: string;
};

const OPEN_TASK_STATUSES: TaskStatus[] = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS];
const OPEN_ALERT_STATUSES: AlertStatus[] = [AlertStatus.OPEN, AlertStatus.IN_PROGRESS];

const riskPriority: Record<RiskLevel, number> = {
  VERY_HIGH: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
};

function isOpenTaskStatus(status: TaskStatus) {
  return OPEN_TASK_STATUSES.includes(status);
}

function taskPriority(task: { dueAt?: Date | null; relatedAlertId?: string | null }) {
  if (task.dueAt && task.dueAt.getTime() < Date.now()) return 0;
  return task.relatedAlertId ? 1 : 3;
}

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

function getAlertDueAt(alert: { riskLevel: RiskLevel; createdAt: Date }) {
  const dueAt = new Date(alert.createdAt);
  if (alert.riskLevel === RiskLevel.VERY_HIGH) dueAt.setHours(dueAt.getHours() + 4);
  else if (alert.riskLevel === RiskLevel.HIGH) dueAt.setHours(dueAt.getHours() + 24);
  else dueAt.setHours(dueAt.getHours() + 72);
  return dueAt;
}

@Injectable()
export class WorkItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryWorkItemsDto) {
    const includeClosed = query.status === 'ALL';

    const taskWhere: Prisma.TaskWhereInput = {
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.nurseId ? { assigneeId: query.nurseId } : {}),
      ...(includeClosed ? {} : { status: { in: OPEN_TASK_STATUSES } }),
    };

    const alertWhere: Prisma.RiskAlertWhereInput = {
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.nurseId ? { patient: { responsibleNurseId: query.nurseId } } : {}),
      ...(includeClosed ? {} : { status: { in: OPEN_ALERT_STATUSES } }),
    };

    const [tasks, alerts] = await Promise.all([
      this.prisma.task.findMany({
        where: taskWhere,
        include: { patient: true },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.riskAlert.findMany({
        where: alertWhere,
        include: { patient: true },
        orderBy: [{ createdAt: 'desc' }],
      }),
    ]);

    const alertIds = Array.from(
      new Set(tasks.map((task) => task.relatedAlertId).filter(Boolean) as string[]),
    );

    const relatedAlerts = alertIds.length
      ? await this.prisma.riskAlert.findMany({
          where: { id: { in: alertIds } },
          include: { patient: true },
        })
      : [];

    const alertById = new Map(relatedAlerts.map((alert) => [alert.id, alert]));
    const activeTaskAlertIds = new Set(
      tasks
        .filter((task) => isOpenTaskStatus(task.status))
        .map((task) => task.relatedAlertId)
        .filter(Boolean) as string[],
    );

    const taskItems: WorkItem[] = tasks.map((task) => {
      const relatedAlert = task.relatedAlertId ? alertById.get(task.relatedAlertId) : null;
      const isRiskTask = Boolean(task.relatedAlertId);
      const patient = patientSummary(task.patient);

      return {
        id: `task:${task.id}`,
        itemType: isRiskTask ? 'RISK_FOLLOW_UP_TASK' : 'FOLLOW_UP_TASK',
        sourceType: 'TASK',
        taskId: task.id,
        alertId: task.relatedAlertId ?? undefined,
        title: isRiskTask ? `风险随访任务：${task.title}` : task.title,
        description: relatedAlert?.description ?? null,
        status: task.status === TaskStatus.IN_PROGRESS ? TaskStatus.PENDING : task.status,
        priority: taskPriority(task),
        riskLevel: relatedAlert?.riskLevel,
        dueAt: task.dueAt,
        createdAt: task.createdAt,
        patient,
        task,
        alert: relatedAlert,
        triggerRule: relatedAlert?.triggerRule,
        actionUrl: patient ? `/patients/${patient.id}/task-processing?taskId=${task.id}&mode=phone` : '/nurse-dashboard',
        actionText: isRiskTask ? '进入任务处理页' : '进入任务处理页',
      };
    });

    const alertOnlyItems: WorkItem[] = alerts
      .filter((alert) => !activeTaskAlertIds.has(alert.id))
      .map((alert) => {
        const patient = patientSummary(alert.patient);
        const dueAt = getAlertDueAt(alert);
        return {
          id: `alert:${alert.id}`,
          itemType: 'RISK_ALERT_ONLY',
          sourceType: 'RISK_ALERT',
          alertId: alert.id,
          title: `风险预警：${alert.title}`,
          description: alert.description,
          status: alert.status === AlertStatus.IN_PROGRESS ? AlertStatus.OPEN : alert.status,
          priority: riskPriority[alert.riskLevel] ?? 5,
          riskLevel: alert.riskLevel,
          dueAt,
          createdAt: alert.createdAt,
          patient,
          alert,
          triggerRule: alert.triggerRule,
          actionUrl: patient ? `/patients/${patient.id}` : '/nurse-dashboard',
          actionText: '生成随访任务并处理',
        };
      });

    const items = [...taskItems, ...alertOnlyItems].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const aDue = a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bDue = b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return {
      summary: {
        totalOpen: items.filter(
          (item) => !['DONE', 'CANCELED', 'RESOLVED', 'DISMISSED'].includes(item.status),
        ).length,
        regularTaskCount: items.filter((item) => item.itemType === 'FOLLOW_UP_TASK').length,
        riskTaskCount: items.filter((item) => item.itemType === 'RISK_FOLLOW_UP_TASK').length,
        alertOnlyCount: items.filter((item) => item.itemType === 'RISK_ALERT_ONLY').length,
        overdueCount: items.filter((item) => item.dueAt && item.dueAt.getTime() < Date.now()).length,
      },
      items,
    };
  }
}
