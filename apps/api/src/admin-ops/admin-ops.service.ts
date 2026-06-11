import { Injectable } from '@nestjs/common';
import {
  AlertStatus,
  IntegrationPromotionStatus,
  RiskEpisodeStatus,
  TaskStatus,
} from '@prisma/client';
import { HealthService } from '../health/health.service';
import { PrismaService } from '../prisma/prisma.service';

type DuplicateScheduleRow = {
  hospitalTenantId: string;
  patientId: string;
  sourceType: string;
  sourceId: string;
  count: number;
};

type DuplicateExternalRecordRow = {
  sourceId: string;
  externalRecordType: string;
  externalRecordId: string;
  count: number;
};

@Injectable()
export class AdminOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthService,
  ) {}

  async getSummary() {
    const [readiness, reminderWorker, gateway, dataIntegrity, recentHighRiskAudit] =
      await Promise.all([
        this.health.ready(),
        this.getReminderWorker(),
        this.getGateway(),
        this.getDataIntegrity(),
        this.prisma.auditLog.findMany({
          where: {
            action: {
              in: [
                'ADMIN_CROSS_TENANT_READ',
                'ADMIN_CROSS_TENANT_WRITE',
                'GATEWAY_API_KEY_ISSUED',
                'GATEWAY_API_KEY_REVOKED',
                'ISSUE_GATEWAY_API_KEY',
                'REVOKE_GATEWAY_API_KEY',
                'CARE_REMINDER_OCCURRENCE_REPLAY_REQUESTED',
                'REPLAY_CARE_REMINDER_OCCURRENCE',
              ],
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 12,
        }),
      ]);

    return {
      checkedAt: new Date().toISOString(),
      system: readiness,
      reminderWorker,
      gateway,
      dataIntegrity,
      audit: {
        recentHighRiskActions: recentHighRiskAudit,
      },
    };
  }

  async getReminderWorker() {
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const heartbeatCutoff = new Date(
      now.getTime() - this.numberEnv('CARE_REMINDER_WORKER_HEARTBEAT_STALE_AFTER_MS', 90_000),
    );
    const stuckCutoff = new Date(
      now.getTime() - this.numberEnv('CARE_REMINDER_WORKER_STUCK_SENDING_AFTER_MS', 15 * 60_000),
    );

    const [
      latestSuccessfulRun,
      latestRun,
      metrics24h,
      backlogRows,
      retryScheduled,
      stuckSending,
      instances,
    ] = await Promise.all([
      this.prisma.careReminderWorkerRun.findFirst({
        where: { status: 'SUCCEEDED' },
        orderBy: { finishedAt: 'desc' },
      }),
      this.prisma.careReminderWorkerRun.findFirst({
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.careReminderWorkerRun.aggregate({
        where: { startedAt: { gte: since24h } },
        _sum: {
          generated: true,
          dispatched: true,
          dispatchFailed: true,
          retried: true,
          retryScheduled: true,
          recoveredStuck: true,
          recoveredAsSent: true,
          expiredLinks: true,
          missed: true,
          escalated: true,
        },
        _count: { _all: true },
      }),
      this.prisma.careReminderOccurrence.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.careReminderOccurrence.count({
        where: { status: 'PENDING', nextRetryAt: { gt: now } },
      }),
      this.prisma.careReminderOccurrence.count({
        where: {
          status: 'SENDING',
          OR: [
            { sendingStartedAt: { lt: stuckCutoff } },
            { sendingStartedAt: null, updatedAt: { lt: stuckCutoff } },
          ],
        },
      }),
      this.prisma.careReminderWorkerHeartbeat.findMany({
        orderBy: { heartbeatAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      latestSuccessfulRunAt: latestSuccessfulRun?.finishedAt ?? null,
      latestRun,
      metrics24h: {
        runCount: metrics24h._count._all,
        generated: metrics24h._sum.generated ?? 0,
        dispatched: metrics24h._sum.dispatched ?? 0,
        dispatchFailed: metrics24h._sum.dispatchFailed ?? 0,
        retried: metrics24h._sum.retried ?? 0,
        retryScheduled: metrics24h._sum.retryScheduled ?? 0,
        recoveredStuck: metrics24h._sum.recoveredStuck ?? 0,
        recoveredAsSent: metrics24h._sum.recoveredAsSent ?? 0,
        expiredLinks: metrics24h._sum.expiredLinks ?? 0,
        missed: metrics24h._sum.missed ?? 0,
        escalated: metrics24h._sum.escalated ?? 0,
      },
      backlog: {
        byStatus: Object.fromEntries(backlogRows.map((row) => [row.status, row._count._all])),
        retryScheduled,
        stuckSending,
      },
      instances: instances.map((instance) => ({
        ...instance,
        active:
          instance.stoppedAt == null &&
          instance.heartbeatAt.getTime() >= heartbeatCutoff.getTime(),
        heartbeatInterrupted:
          instance.stoppedAt == null &&
          instance.heartbeatAt.getTime() < heartbeatCutoff.getTime(),
      })),
    };
  }

  async getGateway() {
    const maxAttempts = Math.floor(
      this.numberEnv('GATEWAY_PROMOTION_WORKER_MAX_ATTEMPTS', 6),
    );

    const [
      enabledSources,
      conflictCount,
      retryExhaustedCount,
      retryScheduledCount,
      latestBatch,
      failedBatches24h,
      recentConflicts,
    ] = await Promise.all([
      this.prisma.integrationSource.count({ where: { isEnabled: true } }),
      this.prisma.integrationSyncRecord.count({
        where: { promotionStatus: IntegrationPromotionStatus.CONFLICT },
      }),
      this.prisma.integrationSyncRecord.count({
        where: {
          promotionStatus: IntegrationPromotionStatus.FAILED,
          promotionAttempts: { gte: maxAttempts },
        },
      }),
      this.prisma.integrationSyncRecord.count({
        where: {
          promotionStatus: IntegrationPromotionStatus.FAILED,
          promotionAttempts: { lt: maxAttempts },
          nextRetryAt: { not: null },
        },
      }),
      this.prisma.integrationSyncBatch.findFirst({
        orderBy: { startedAt: 'desc' },
        include: {
          source: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.integrationSyncBatch.count({
        where: {
          startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          status: { in: ['FAILED', 'PARTIAL_FAILED'] },
        },
      }),
      this.prisma.integrationSyncRecord.findMany({
        where: { promotionStatus: IntegrationPromotionStatus.CONFLICT },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          id: true,
          sourceId: true,
          externalRecordType: true,
          externalRecordId: true,
          promotionMessage: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      enabledSources,
      conflictCount,
      retryExhaustedCount,
      retryScheduledCount,
      failedBatches24h,
      maxAttempts,
      latestBatch,
      recentConflicts,
    };
  }

  async getDataIntegrity() {
    const now = new Date();
    const expiringSoon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const openTaskStatuses = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS];
    const openAlertStatuses = [AlertStatus.OPEN, AlertStatus.IN_PROGRESS];
    const openEpisodeStatuses = [RiskEpisodeStatus.OPEN, RiskEpisodeStatus.IN_PROGRESS];

    const [
      patientsWithoutTenant,
      patientsWithoutResponsibleNurse,
      staleOpenTasks,
      orphanOpenAlerts,
      openEpisodesWithoutTask,
      sourceLessBoundSchedules,
      activeLinksExpiringSoon,
      activeLinksAlreadyExpired,
      duplicateSchedules,
      duplicateExternalRecords,
    ] = await Promise.all([
      this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS "count"
        FROM "Patient"
        WHERE "hospitalTenantId" IS NULL
      `.then(([row]) => row?.count ?? 0),
      this.prisma.patient.count({ where: { responsibleNurseId: null } }),
      this.prisma.task.count({
        where: {
          status: { in: openTaskStatuses },
          dueAt: { lt: now },
        },
      }),
      this.prisma.riskAlert.count({
        where: {
          status: { in: openAlertStatuses },
          riskEpisodeId: null,
        },
      }),
      this.prisma.riskEpisode.count({
        where: {
          status: { in: openEpisodeStatuses },
          openTaskId: null,
        },
      }),
      this.prisma.careReminderSchedule.count({
        where: {
          sourceType: { in: ['MEDICATION', 'VITAL'] },
          sourceId: null,
        },
      }),
      this.prisma.patientFormLink.count({
        where: {
          status: 'ACTIVE',
          expiresAt: { gt: now, lte: expiringSoon },
        },
      }),
      this.prisma.patientFormLink.count({
        where: {
          status: 'ACTIVE',
          expiresAt: { lte: now },
        },
      }),
      this.findDuplicateSchedules(),
      this.findDuplicateExternalRecords(),
    ]);

    return {
      staleOpenTasks,
      orphanOpenAlerts,
      openEpisodesWithoutTask,
      patientsWithoutTenant,
      patientsWithoutResponsibleNurse,
      sourceLessBoundSchedules,
      duplicateScheduleGroups: duplicateSchedules.length,
      duplicateSchedules,
      duplicateExternalRecordGroups: duplicateExternalRecords.length,
      duplicateExternalRecords,
      activeLinksExpiringSoon,
      activeLinksAlreadyExpired,
    };
  }

  private async findDuplicateSchedules(): Promise<DuplicateScheduleRow[]> {
    return this.prisma.$queryRaw<DuplicateScheduleRow[]>`
      SELECT
        "hospitalTenantId",
        "patientId",
        "sourceType",
        "sourceId",
        COUNT(*)::int AS "count"
      FROM "CareReminderSchedule"
      WHERE "isActive" = true
        AND "sourceId" IS NOT NULL
      GROUP BY "hospitalTenantId", "patientId", "sourceType", "sourceId"
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `;
  }

  private async findDuplicateExternalRecords(): Promise<DuplicateExternalRecordRow[]> {
    return this.prisma.$queryRaw<DuplicateExternalRecordRow[]>`
      SELECT
        "sourceId",
        "externalRecordType",
        "externalRecordId",
        COUNT(*)::int AS "count"
      FROM "IntegrationSyncRecord"
      GROUP BY "sourceId", "externalRecordType", "externalRecordId"
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `;
  }

  private numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name] ?? fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}


