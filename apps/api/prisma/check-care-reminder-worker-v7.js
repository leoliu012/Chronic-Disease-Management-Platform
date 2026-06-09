#!/usr/bin/env node
/*
 * Operational checker for care-reminder-worker-v7.
 * Run from apps/api after migration + generate while one or more API instances
 * are running. It reports heartbeat health, recent round metrics, backlog, stale
 * SENDING rows, and automatic duplicate-success evidence.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function envNumber(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main() {
  const now = new Date();
  const heartbeatStaleAfterMs = envNumber('CARE_REMINDER_WORKER_HEARTBEAT_STALE_AFTER_MS', 90_000);
  const stuckAfterMs = envNumber('CARE_REMINDER_WORKER_STUCK_SENDING_AFTER_MS', 15 * 60_000);
  const heartbeatCutoff = new Date(now.getTime() - heartbeatStaleAfterMs);
  const stuckCutoff = new Date(now.getTime() - stuckAfterMs);

  const [instances, runs, statuses, retryScheduled, stuckSending, duplicateAutomaticSuccesses] =
    await Promise.all([
      prisma.careReminderWorkerHeartbeat.findMany({ orderBy: { heartbeatAt: 'desc' }, take: 50 }),
      prisma.careReminderWorkerRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }),
      prisma.careReminderOccurrence.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.careReminderOccurrence.count({ where: { status: 'PENDING', nextRetryAt: { gt: now } } }),
      prisma.careReminderOccurrence.count({
        where: {
          status: 'SENDING',
          OR: [
            { sendingStartedAt: { lt: stuckCutoff } },
            { sendingStartedAt: null, updatedAt: { lt: stuckCutoff } },
          ],
        },
      }),
      prisma.$queryRaw`
        SELECT o."id" AS "occurrenceId", COUNT(a."id")::int AS "successfulAutomaticAttempts"
        FROM "CareReminderOccurrence" o
        JOIN "PatientOutboundAttempt" a ON a."messageId" = o."outboundMessageId"
        WHERE a."status" = 'SENT'
          AND COALESCE(a."triggerReason", 'INITIAL') <> 'NURSE_RESEND'
        GROUP BY o."id"
        HAVING COUNT(a."id") > 1
        ORDER BY COUNT(a."id") DESC
      `,
    ]);

  const view = {
    checkedAt: now.toISOString(),
    workerInstances: instances.map((instance) => ({
      instanceId: instance.instanceId,
      heartbeatAt: instance.heartbeatAt.toISOString(),
      stoppedAt: instance.stoppedAt?.toISOString() || null,
      lastSucceededAt: instance.lastSucceededAt?.toISOString() || null,
      active: instance.stoppedAt == null && instance.heartbeatAt >= heartbeatCutoff,
      heartbeatInterrupted: instance.stoppedAt == null && instance.heartbeatAt < heartbeatCutoff,
    })),
    recentRuns: runs.map((run) => ({
      id: run.id,
      instanceId: run.instanceId,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() || null,
      generated: run.generated,
      dispatched: run.dispatched,
      dispatchFailed: run.dispatchFailed,
      retried: run.retried,
      retryScheduled: run.retryScheduled,
      recoveredStuck: run.recoveredStuck,
      recoveredAsSent: run.recoveredAsSent,
      missed: run.missed,
      escalated: run.escalated,
      error: run.error,
    })),
    backlogByStatus: Object.fromEntries(statuses.map((row) => [row.status, row._count._all])),
    retryScheduled,
    stuckSending,
    duplicateAutomaticSuccesses,
  };

  console.log(JSON.stringify(view, null, 2));
  if (duplicateAutomaticSuccesses.length) {
    console.error('[FAIL] automatic duplicate successful attempts detected');
    process.exitCode = 1;
  } else {
    console.log('[PASS] no occurrence has more than one successful automatic delivery attempt');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
