import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AlertStatus,
  HospitalVisitReminderStatus,
  Prisma,
  RiskEpisodeStatus,
  RiskLevel,
  type Task,
  TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type DbClient = Prisma.TransactionClient | PrismaService;

const OPEN_ALERT_STATUSES: AlertStatus[] = [AlertStatus.OPEN, AlertStatus.IN_PROGRESS];
const OPEN_TASK_STATUSES: TaskStatus[] = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS];

const riskRank: Record<RiskLevel, number> = {
  [RiskLevel.LOW]: 0,
  [RiskLevel.MEDIUM]: 1,
  [RiskLevel.HIGH]: 2,
  [RiskLevel.VERY_HIGH]: 3,
};

const priorityForRisk: Record<RiskLevel, number> = {
  [RiskLevel.VERY_HIGH]: 0,
  [RiskLevel.HIGH]: 1,
  [RiskLevel.MEDIUM]: 2,
  [RiskLevel.LOW]: 3,
};

export type RuleTraceInput = {
  ruleId?: string | null;
  ruleVersion?: string | null;
  ruleSnapshot?: unknown;
  evidenceBasis?: string | null;
  evaluatedAt?: Date;
  inputSnapshot?: unknown;
  matchedConditions?: unknown;
};

export type SignalRiskInput = {
  patientId: string;
  riskCategory: string;
  correlationKey: string;
  riskLevel: RiskLevel;
  title: string;
  description?: string | null;
  triggerRule?: string | null;
  sourceVitalRecordId?: string | null;
  sourceQuestionnaireResultId?: string | null;
  evidence?: unknown;
  ruleTrace?: RuleTraceInput;
  triggeredAt?: Date;
  createTask?: boolean;
  taskTitle?: string;
  taskType?: string;
  dueAt?: Date | null;
  assigneeId?: string | null;
};

export type EnsureTaskForAlertInput = {
  alertId: string;
  taskTitle: string;
  taskType: string;
  dueAt?: Date | null;
  assigneeId?: string | null;
};

function isUniqueConflict(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}

function earlierDate(a?: Date | null, b?: Date | null) {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

@Injectable()
export class ClinicalDispositionService {
  constructor(private readonly prisma: PrismaService) {}

  riskPriority(riskLevel: RiskLevel) {
    return priorityForRisk[riskLevel];
  }

  private asJson(value: unknown): Prisma.InputJsonValue | undefined {
    return value === undefined ? undefined : (value as Prisma.InputJsonValue);
  }

  private peakRiskLevel(current: RiskLevel, incoming: RiskLevel) {
    return riskRank[incoming] > riskRank[current] ? incoming : current;
  }

  private openKey(patientId: string, correlationKey: string) {
    return `${patientId}::${correlationKey}`;
  }

  private async createOrUpdateEpisode(db: DbClient, input: SignalRiskInput) {
    const now = input.triggeredAt ?? new Date();
    const openKey = this.openKey(input.patientId, input.correlationKey);
    const updateExisting = async () => {
      const existing = await db.riskEpisode.findUnique({ where: { openKey } });
      if (!existing) return null;
      return db.riskEpisode.update({
        where: { id: existing.id },
        data: {
          lastTriggeredAt: now,
          triggerCount: { increment: 1 },
          peakRiskLevel: this.peakRiskLevel(existing.peakRiskLevel, input.riskLevel),
          latestEvidence: this.asJson(input.evidence),
        },
      });
    };

    const existing = await updateExisting();
    if (existing) return { episode: existing, merged: true };

    try {
      const episode = await db.riskEpisode.create({
        data: {
          patientId: input.patientId,
          riskCategory: input.riskCategory,
          correlationKey: input.correlationKey,
          openKey,
          firstTriggeredAt: now,
          lastTriggeredAt: now,
          peakRiskLevel: input.riskLevel,
          latestEvidence: this.asJson(input.evidence),
        },
      });
      return { episode, merged: false };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const raced = await updateExisting();
      if (!raced) throw error;
      return { episode: raced, merged: true };
    }
  }

  private async findOpenEpisodeTask(db: DbClient, episodeId: string, openTaskId?: string | null) {
    if (openTaskId) {
      const task = await db.task.findFirst({
        where: { id: openTaskId, status: { in: OPEN_TASK_STATUSES } },
      });
      if (task) return task;
    }
    return db.task.findFirst({
      where: {
        status: { in: OPEN_TASK_STATUSES },
        OR: [
          { openRiskEpisodeKey: episodeId },
          { riskEpisodeId: episodeId },
        ],
      },
      orderBy: [{ priority: 'asc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async createOrUpdateEpisodeTask(
    db: DbClient,
    episode: { id: string; openTaskId?: string | null; peakRiskLevel: RiskLevel },
    alert: { id: string; riskLevel: RiskLevel },
    input: {
      patientId: string;
      taskTitle: string;
      taskType: string;
      dueAt?: Date | null;
      assigneeId?: string | null;
    },
  ) {
    const priority = this.riskPriority(alert.riskLevel);
    const existing = await this.findOpenEpisodeTask(db, episode.id, episode.openTaskId);
    if (existing) {
      const updated = await db.task.update({
        where: { id: existing.id },
        data: {
          title: riskRank[alert.riskLevel] >= riskRank[episode.peakRiskLevel] ? input.taskTitle : existing.title,
          dueAt: earlierDate(existing.dueAt, input.dueAt),
          priority: Math.min(existing.priority, priority),
          assigneeId: existing.assigneeId ?? input.assigneeId ?? undefined,
          relatedAlertId: alert.id,
          riskEpisodeId: episode.id,
          openRiskEpisodeKey: episode.id,
        },
      });
      await db.riskEpisode.update({ where: { id: episode.id }, data: { openTaskId: updated.id } });
      return { task: updated, reused: true };
    }

    try {
      const task = await db.task.create({
        data: {
          patientId: input.patientId,
          title: input.taskTitle,
          type: input.taskType,
          status: TaskStatus.PENDING,
          dueAt: input.dueAt ?? undefined,
          assigneeId: input.assigneeId ?? undefined,
          relatedAlertId: alert.id,
          riskEpisodeId: episode.id,
          openRiskEpisodeKey: episode.id,
          priority,
        },
      });
      await db.riskEpisode.update({ where: { id: episode.id }, data: { openTaskId: task.id } });
      return { task, reused: false };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const raced = await db.task.findUnique({ where: { openRiskEpisodeKey: episode.id } });
      if (!raced) throw error;
      const task = await db.task.update({
        where: { id: raced.id },
        data: {
          title: input.taskTitle,
          dueAt: earlierDate(raced.dueAt, input.dueAt),
          priority: Math.min(raced.priority, priority),
          assigneeId: raced.assigneeId ?? input.assigneeId ?? undefined,
          relatedAlertId: alert.id,
          riskEpisodeId: episode.id,
        },
      });
      await db.riskEpisode.update({ where: { id: episode.id }, data: { openTaskId: task.id } });
      return { task, reused: true };
    }
  }

  async signalRisk(db: DbClient, input: SignalRiskInput) {
    const { episode, merged } = await this.createOrUpdateEpisode(db, input);
    const alert = await db.riskAlert.create({
      data: {
        patientId: input.patientId,
        riskType: input.riskCategory,
        riskLevel: input.riskLevel,
        title: input.title,
        description: input.description ?? undefined,
        triggerRule: input.triggerRule ?? undefined,
        ruleId: input.ruleTrace?.ruleId ?? undefined,
        ruleVersion: input.ruleTrace?.ruleVersion ?? undefined,
        ruleSnapshot: this.asJson(input.ruleTrace?.ruleSnapshot),
        evidenceBasis: input.ruleTrace?.evidenceBasis ?? undefined,
        evaluatedAt: input.ruleTrace?.evaluatedAt ?? new Date(),
        inputSnapshot: this.asJson(input.ruleTrace?.inputSnapshot),
        matchedConditions: this.asJson(input.ruleTrace?.matchedConditions),
        sourceVitalRecordId: input.sourceVitalRecordId ?? undefined,
        sourceQuestionnaireResultId: input.sourceQuestionnaireResultId ?? undefined,
        riskEpisodeId: episode.id,
      },
    });

    let task: Task | null = null;
    let reusedTask = false;
    if (input.createTask !== false) {
      const taskResult = await this.createOrUpdateEpisodeTask(db, episode, alert, {
        patientId: input.patientId,
        taskTitle: input.taskTitle ?? input.title,
        taskType: input.taskType ?? 'RISK_ALERT_FOLLOW_UP',
        dueAt: input.dueAt,
        assigneeId: input.assigneeId,
      });
      task = taskResult.task;
      reusedTask = taskResult.reused;
    }

    return { episode, alert, task, mergedEpisode: merged, reusedTask };
  }

  async ensureOpenTaskForAlert(db: DbClient, input: EnsureTaskForAlertInput) {
    const alert = await db.riskAlert.findUnique({
      where: { id: input.alertId },
      include: { patient: true, riskEpisode: true },
    });
    if (!alert) throw new NotFoundException('Risk alert not found');
    if (!OPEN_ALERT_STATUSES.includes(alert.status)) {
      throw new BadRequestException('Closed risk alert cannot generate a new disposition task');
    }

    let episode = alert.riskEpisode;
    if (!episode) {
      const created = await this.createOrUpdateEpisode(db, {
        patientId: alert.patientId,
        riskCategory: alert.riskType,
        correlationKey: `LEGACY:${alert.riskType}:${alert.id}`,
        riskLevel: alert.riskLevel,
        title: alert.title,
        description: alert.description,
        triggerRule: alert.triggerRule,
        evidence: { legacyAlertId: alert.id },
        createTask: false,
      });
      episode = created.episode;
      await db.riskAlert.update({ where: { id: alert.id }, data: { riskEpisodeId: episode.id } });
    }

    return this.createOrUpdateEpisodeTask(db, episode, alert, {
      patientId: alert.patientId,
      taskTitle: input.taskTitle,
      taskType: input.taskType,
      dueAt: input.dueAt,
      assigneeId: input.assigneeId ?? alert.patient.responsibleNurseId,
    });
  }

  async markAlertInProgress(db: DbClient, alertId: string, handledBy?: string | null, handlingNote?: string | null) {
    const alert = await db.riskAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw new NotFoundException('Risk alert not found');
    const updated = await db.riskAlert.update({
      where: { id: alertId },
      data: { status: AlertStatus.IN_PROGRESS, handledBy: handledBy ?? undefined, handlingNote: handlingNote ?? undefined },
    });
    if (alert.riskEpisodeId) {
      await db.riskEpisode.updateMany({
        where: { id: alert.riskEpisodeId, status: RiskEpisodeStatus.OPEN },
        data: { status: RiskEpisodeStatus.IN_PROGRESS },
      });
      await db.task.updateMany({
        where: { riskEpisodeId: alert.riskEpisodeId, status: TaskStatus.PENDING },
        data: { status: TaskStatus.IN_PROGRESS },
      });
    } else {
      await db.task.updateMany({
        where: { relatedAlertId: alertId, status: TaskStatus.PENDING },
        data: { status: TaskStatus.IN_PROGRESS },
      });
    }
    return updated;
  }

  async closeByAlert(
    db: DbClient,
    alertId: string,
    finalAlertStatus: Extract<AlertStatus, 'RESOLVED' | 'DISMISSED'>,
    handledBy?: string | null,
    handlingNote?: string | null,
  ) {
    const note = String(handlingNote ?? '').trim();
    if (!note) throw new BadRequestException('关闭风险预警时必须填写处置结果');
    const alert = await db.riskAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw new NotFoundException('Risk alert not found');
    const taskStatus = finalAlertStatus === AlertStatus.RESOLVED ? TaskStatus.DONE : TaskStatus.CANCELED;
    const episodeStatus = finalAlertStatus === AlertStatus.RESOLVED ? RiskEpisodeStatus.RESOLVED : RiskEpisodeStatus.DISMISSED;
    const now = new Date();

    if (alert.riskEpisodeId) {
      const episodeAlerts = await db.riskAlert.findMany({
        where: { riskEpisodeId: alert.riskEpisodeId },
        select: { id: true },
      });
      const alertIds = episodeAlerts.map((item) => item.id);
      await db.riskAlert.updateMany({
        where: { riskEpisodeId: alert.riskEpisodeId, status: { in: OPEN_ALERT_STATUSES } },
        data: { status: finalAlertStatus, handledBy: handledBy ?? undefined, handledAt: now, handlingNote: note },
      });
      await db.task.updateMany({
        where: { riskEpisodeId: alert.riskEpisodeId, status: { in: OPEN_TASK_STATUSES } },
        data: { status: taskStatus, openRiskEpisodeKey: null },
      });
      await db.hospitalVisitReminder.updateMany({
        where: {
          status: HospitalVisitReminderStatus.ACTIVE,
          OR: [
            { riskEpisodeId: alert.riskEpisodeId },
            ...(alertIds.length ? [{ sourceRiskAlertId: { in: alertIds } }] : []),
          ],
        },
        data: {
          status: HospitalVisitReminderStatus.REVOKED,
          revokedAt: now,
          revokedBy: handledBy ?? undefined,
          revokeReason: '关联临床风险 episode 已完成处置，自动关闭仍处于有效状态的到院提醒。',
        },
      });
      await db.riskEpisode.update({
        where: { id: alert.riskEpisodeId },
        data: { status: episodeStatus, openKey: null, openTaskId: null },
      });
    } else {
      await db.riskAlert.update({
        where: { id: alertId },
        data: { status: finalAlertStatus, handledBy: handledBy ?? undefined, handledAt: now, handlingNote: note },
      });
      await db.task.updateMany({
        where: { relatedAlertId: alertId, status: { in: OPEN_TASK_STATUSES } },
        data: { status: taskStatus, openRiskEpisodeKey: null },
      });
      await db.hospitalVisitReminder.updateMany({
        where: { sourceRiskAlertId: alertId, status: HospitalVisitReminderStatus.ACTIVE },
        data: {
          status: HospitalVisitReminderStatus.REVOKED,
          revokedAt: now,
          revokedBy: handledBy ?? undefined,
          revokeReason: '关联风险预警已完成处置，自动关闭仍处于有效状态的到院提醒。',
        },
      });
    }
    return db.riskAlert.findUnique({ where: { id: alertId } });
  }

  async closeByTask(
    db: DbClient,
    taskId: string,
    finalTaskStatus: Extract<TaskStatus, 'DONE' | 'CANCELED'>,
    handledBy?: string | null,
    outcome?: string | null,
  ) {
    const note = String(outcome ?? '').trim();
    if (!note) throw new BadRequestException('关闭处置任务时必须填写处置结果');
    const task = await db.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    const alertStatus = finalTaskStatus === TaskStatus.DONE ? AlertStatus.RESOLVED : AlertStatus.DISMISSED;
    await db.task.update({ where: { id: taskId }, data: { status: finalTaskStatus, openRiskEpisodeKey: null } });
    if (task.relatedAlertId) {
      await this.closeByAlert(db, task.relatedAlertId, alertStatus, handledBy ?? task.assigneeId, note);
    }
    return db.task.findUnique({ where: { id: taskId } });
  }
}

