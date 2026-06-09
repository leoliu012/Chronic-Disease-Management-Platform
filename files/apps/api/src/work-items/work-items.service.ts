import { Injectable } from '@nestjs/common';
import { AlertStatus, Prisma, RiskLevel, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryWorkItemsDto } from './dto/query-work-items.dto';
import { ClinicalAccessScopeService } from '../security/clinical-access-scope.service';
import type { RequestUser } from '../security/request-user.type';

type PatientSummary = {
  id: string;
  name: string;
  hospitalPatientId?: string | null;
  phone?: string | null;
  responsibleDoctorId?: string | null;
  responsibleNurseId?: string | null;
};

const HOSPITAL_VISIT_TASK_TYPE = 'HOSPITAL_VISIT_FOLLOW_UP';

type WorkItem = {
  id: string;
  itemType: 'FOLLOW_UP_TASK' | 'RISK_FOLLOW_UP_TASK' | 'HOSPITAL_VISIT_TASK';
  sourceType: 'TASK';
  taskId: string;
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
const CLOSED_ALERT_STATUSES: AlertStatus[] = [AlertStatus.RESOLVED, AlertStatus.DISMISSED];

function isOpenTaskStatus(status: TaskStatus) {
  return OPEN_TASK_STATUSES.includes(status);
}

function isClosedAlertStatus(status?: AlertStatus | null) {
  return Boolean(status && CLOSED_ALERT_STATUSES.includes(status));
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

@Injectable()
export class WorkItemsService {
  constructor(private readonly prisma: PrismaService, private readonly access: ClinicalAccessScopeService) {}

  async findAll(query: QueryWorkItemsDto, user: RequestUser) {
    const accessScope = await this.access.buildTaskScope(user, query.hospitalTenantId);
    const includeClosed = query.status === 'ALL';

    const taskWhere: Prisma.TaskWhereInput = {
      AND: [
        accessScope,
        ...(query.patientId ? [{ patientId: query.patientId }] : []),
        ...(includeClosed ? [] : [{ status: { in: OPEN_TASK_STATUSES } }]),
      ],
    };

    const tasks = await this.prisma.task.findMany({
      where: taskWhere,
      include: { patient: true },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
    });

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

    const items: WorkItem[] = tasks
      .filter((task) => {
        if (includeClosed) return true;
        if (!isOpenTaskStatus(task.status)) return false;

        const relatedAlert = task.relatedAlertId ? alertById.get(task.relatedAlertId) : null;
        return !relatedAlert || !isClosedAlertStatus(relatedAlert.status);
      })
      .map((task): WorkItem => {
        const relatedAlert = task.relatedAlertId ? alertById.get(task.relatedAlertId) : null;
        const isHospitalVisitTask = task.type === HOSPITAL_VISIT_TASK_TYPE;
        const isRiskTask = Boolean(task.relatedAlertId);
        const patient = patientSummary(task.patient);

        return {
          id: `task:${task.id}`,
          itemType: isHospitalVisitTask
            ? 'HOSPITAL_VISIT_TASK'
            : isRiskTask
              ? 'RISK_FOLLOW_UP_TASK'
              : 'FOLLOW_UP_TASK',
          sourceType: 'TASK',
          taskId: task.id,
          alertId: task.relatedAlertId ?? undefined,
          title: isHospitalVisitTask
            ? `到院提醒任务：${task.title}`
            : isRiskTask
              ? `风险随访任务：${task.title}`
              : task.title,
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
          actionUrl: patient
            ? isHospitalVisitTask
              ? `/patients/${patient.id}/task-processing?taskId=${task.id}`
              : `/patients/${patient.id}/task-processing?taskId=${task.id}&mode=phone`
            : '/nurse-dashboard',
          actionText: isHospitalVisitTask ? '处理到院提醒' : '进入任务处理页',
        };
      })
      .sort((a, b) => {
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
        riskTaskCount: items.filter(
          (item) => item.itemType === 'RISK_FOLLOW_UP_TASK' || item.itemType === 'HOSPITAL_VISIT_TASK',
        ).length,
        alertOnlyCount: 0,
        overdueCount: items.filter((item) => item.dueAt && item.dueAt.getTime() < Date.now()).length,
      },
      items,
    };
  }
}




