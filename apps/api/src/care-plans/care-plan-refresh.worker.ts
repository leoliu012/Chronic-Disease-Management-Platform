import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CarePlansService } from './care-plans.service';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000;
const DEFAULT_HEARTBEAT_STALE_AFTER_MS = 90_000;
const DEFAULT_LOCK_HOLD_TIMEOUT_MS = 15 * 60 * 1000;
// Separate namespace from the reminder worker advisory-lock key.
const CARE_PLAN_REFRESH_LOCK_KEY = 739_224_892;

type RefreshSummary = {
  enrolled: number;
  refreshed: number;
  unchanged: number;
  failed: number;
  failedPatientIds: string[];
  errorSummaries: string[];
};

function envPositiveInt(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

@Injectable()
export class CarePlanRefreshWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(CarePlanRefreshWorker.name);
  private readonly instanceId = `${hostname()}:${process.pid}:${randomUUID()}`;
  private intervalTimer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private activeRunId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly carePlans: CarePlansService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.CARE_PLAN_REFRESH_WORKER_ENABLED !== 'true') {
      this.logger.log('Care-plan refresh worker disabled.');
      return;
    }

    const intervalMs = envPositiveInt(
      'CARE_PLAN_REFRESH_WORKER_INTERVAL_MS',
      DEFAULT_INTERVAL_MS,
    );
    const heartbeatMs = envPositiveInt(
      'CARE_PLAN_REFRESH_WORKER_HEARTBEAT_INTERVAL_MS',
      DEFAULT_HEARTBEAT_INTERVAL_MS,
    );

    this.touchHeartbeat().catch((error) => {
      this.logger.error(`initial heartbeat failed: ${(error as Error).message}`);
    });

    this.heartbeatTimer = setInterval(() => {
      this.touchHeartbeat().catch((error) => {
        this.logger.error(`heartbeat failed: ${(error as Error).message}`);
      });
    }, heartbeatMs);

    this.startupTimer = setTimeout(() => {
      this.runOnce().catch((error) => {
        this.logger.error(`initial pass failed: ${(error as Error).message}`);
      });
    }, 8_000);

    this.intervalTimer = setInterval(() => {
      this.runOnce().catch((error) => {
        this.logger.error(`scheduled pass failed: ${(error as Error).message}`);
      });
    }, intervalMs);

    this.logger.log(
      `Care-plan refresh worker scheduled every ${intervalMs}ms; instance=${this.instanceId}`,
    );
  }

  async onApplicationShutdown() {
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.intervalTimer = null;
    this.startupTimer = null;
    this.heartbeatTimer = null;

    await this.prisma.carePlanRefreshWorkerHeartbeat
      .updateMany({
        where: { instanceId: this.instanceId },
        data: { stoppedAt: new Date(), heartbeatAt: new Date() },
      })
      .catch(() => undefined);
  }

  async getStatus() {
    const now = new Date();
    const staleCutoff = new Date(
      now.getTime() -
        envPositiveInt(
          'CARE_PLAN_REFRESH_WORKER_HEARTBEAT_STALE_AFTER_MS',
          DEFAULT_HEARTBEAT_STALE_AFTER_MS,
        ),
    );
    const [instances, recentRuns, lastSuccessfulRun, stuckRuns] =
      await Promise.all([
        this.prisma.carePlanRefreshWorkerHeartbeat.findMany({
          orderBy: { heartbeatAt: 'desc' },
          take: 20,
        }),
        this.prisma.carePlanRefreshWorkerRun.findMany({
          orderBy: { startedAt: 'desc' },
          take: 20,
        }),
        this.prisma.carePlanRefreshWorkerRun.findFirst({
          where: { status: 'SUCCEEDED' },
          orderBy: { finishedAt: 'desc' },
        }),
        this.prisma.carePlanRefreshWorkerRun.findMany({
          where: {
            status: 'RUNNING',
            OR: [
              { heartbeatAt: { lt: staleCutoff } },
              { heartbeatAt: null, startedAt: { lt: staleCutoff } },
            ],
          },
          orderBy: { startedAt: 'asc' },
          take: 20,
        }),
      ]);

    return {
      enabled: process.env.CARE_PLAN_REFRESH_WORKER_ENABLED === 'true',
      localInstanceId: this.instanceId,
      localInFlight: this.inFlight,
      localActiveRunId: this.activeRunId,
      heartbeatStaleAfterMs: now.getTime() - staleCutoff.getTime(),
      lastSuccessfulRunAt: lastSuccessfulRun?.finishedAt ?? null,
      instances: instances.map((instance) => ({
        ...instance,
        isStale: instance.heartbeatAt < staleCutoff,
      })),
      recentRuns,
      stuckRuns,
    };
  }

  async runOnce() {
    if (this.inFlight) {
      this.logger.warn('local refresh pass already in flight; skipping tick.');
      return { skipped: true, reason: 'LOCAL_IN_FLIGHT' };
    }

    this.inFlight = true;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const lockRows = await tx.$queryRaw<Array<{ acquired: boolean }>>(
            Prisma.sql`SELECT pg_try_advisory_xact_lock(${CARE_PLAN_REFRESH_LOCK_KEY}) AS acquired`,
          );
          if (!lockRows[0]?.acquired) {
            this.logger.warn('another instance owns the care-plan refresh lock; skipping tick.');
            return { skipped: true, reason: 'ADVISORY_LOCK_BUSY' };
          }
          return this.executeLeaderRound();
        },
        {
          maxWait: 5_000,
          timeout: envPositiveInt(
            'CARE_PLAN_REFRESH_WORKER_LOCK_HOLD_TIMEOUT_MS',
            DEFAULT_LOCK_HOLD_TIMEOUT_MS,
          ),
        },
      );
    } finally {
      this.inFlight = false;
      this.activeRunId = null;
    }
  }

  private async executeLeaderRound() {
    const startedAt = new Date();
    const run = await this.prisma.carePlanRefreshWorkerRun.create({
      data: {
        instanceId: this.instanceId,
        status: 'RUNNING',
        startedAt,
        heartbeatAt: startedAt,
      },
    });
    this.activeRunId = run.id;

    await this.prisma.carePlanRefreshWorkerHeartbeat.upsert({
      where: { instanceId: this.instanceId },
      update: {
        heartbeatAt: startedAt,
        lastRunAt: startedAt,
        lastRunId: run.id,
        stoppedAt: null,
      },
      create: {
        instanceId: this.instanceId,
        heartbeatAt: startedAt,
        lastRunAt: startedAt,
        lastRunId: run.id,
      },
    });

    try {
      const summary = await this.carePlans.refreshActivePlans();
      const finishedAt = new Date();
      const status = summary.failed > 0 ? 'PARTIAL_FAILED' : 'SUCCEEDED';

      await this.prisma.carePlanRefreshWorkerRun.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt,
          heartbeatAt: finishedAt,
          enrolled: summary.enrolled,
          refreshed: summary.refreshed,
          unchanged: summary.unchanged,
          failed: summary.failed,
          failedPatientIds: summary.failedPatientIds,
          errorSummaries: summary.errorSummaries,
        },
      });
      await this.prisma.carePlanRefreshWorkerHeartbeat.update({
        where: { instanceId: this.instanceId },
        data: {
          heartbeatAt: finishedAt,
          lastRunAt: finishedAt,
          lastSucceededAt: status === 'SUCCEEDED' ? finishedAt : undefined,
          lastFailedAt: status === 'PARTIAL_FAILED' ? finishedAt : undefined,
          lastRunId: run.id,
          lastSummary: summary,
        },
      });
      return summary;
    } catch (error) {
      const finishedAt = new Date();
      const message = (error as Error).message.slice(0, 2_000);
      await this.prisma.carePlanRefreshWorkerRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          heartbeatAt: finishedAt,
          finishedAt,
          error: message,
        },
      });
      await this.prisma.carePlanRefreshWorkerHeartbeat.update({
        where: { instanceId: this.instanceId },
        data: {
          heartbeatAt: finishedAt,
          lastRunAt: finishedAt,
          lastFailedAt: finishedAt,
          lastRunId: run.id,
          lastSummary: { error: message },
        },
      });
      throw error;
    }
  }

  private async touchHeartbeat() {
    const now = new Date();
    await this.prisma.carePlanRefreshWorkerHeartbeat.upsert({
      where: { instanceId: this.instanceId },
      update: {
        heartbeatAt: now,
        stoppedAt: null,
        lastRunId: this.activeRunId ?? undefined,
      },
      create: {
        instanceId: this.instanceId,
        heartbeatAt: now,
        lastRunId: this.activeRunId ?? undefined,
      },
    });
    if (this.activeRunId) {
      await this.prisma.carePlanRefreshWorkerRun.updateMany({
        where: { id: this.activeRunId, status: 'RUNNING' },
        data: { heartbeatAt: now },
      });
    }
  }
}
