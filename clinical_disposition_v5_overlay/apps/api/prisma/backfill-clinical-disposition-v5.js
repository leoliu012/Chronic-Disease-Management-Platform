#!/usr/bin/env node
/*
 * Backfill clinical disposition v5.
 *
 * Run from apps/api after prisma migrate + prisma generate:
 *   node prisma/backfill-clinical-disposition-v5.js --dry-run
 *   node prisma/backfill-clinical-disposition-v5.js
 *
 * Goals:
 *   - attach legacy OPEN / IN_PROGRESS RiskAlert rows to a RiskEpisode;
 *   - retain one OPEN disposition Task per episode;
 *   - cancel duplicate legacy risk tasks instead of deleting audit history;
 *   - populate RiskEpisode.openTaskId + Task.openRiskEpisodeKey;
 *   - connect existing active HospitalVisitReminder rows to the episode/task.
 */
const {
  AlertStatus,
  PrismaClient,
  RiskEpisodeStatus,
  RiskLevel,
  TaskStatus,
} = require('@prisma/client');

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const OPEN_ALERT = [AlertStatus.OPEN, AlertStatus.IN_PROGRESS];
const OPEN_TASK = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS];
const rank = { LOW: 0, MEDIUM: 1, HIGH: 2, VERY_HIGH: 3 };
const priority = { LOW: 3, MEDIUM: 2, HIGH: 1, VERY_HIGH: 0 };

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function correlationFor(alert) {
  const basis = normalize(alert.triggerRule || alert.title || alert.riskType || 'UNKNOWN');
  return `BACKFILL:${normalize(alert.riskType || 'UNKNOWN')}:${basis}`;
}

function peakRisk(alerts) {
  return alerts.reduce((peak, alert) => rank[alert.riskLevel] > rank[peak] ? alert.riskLevel : peak, RiskLevel.LOW);
}

function chooseTask(tasks, preferredId) {
  return [...tasks].sort((a, b) => {
    if (a.openRiskEpisodeKey && !b.openRiskEpisodeKey) return -1;
    if (b.openRiskEpisodeKey && !a.openRiskEpisodeKey) return 1;
    if (a.id === preferredId && b.id !== preferredId) return -1;
    if (b.id === preferredId && a.id !== preferredId) return 1;
    if (a.status === TaskStatus.IN_PROGRESS && b.status !== TaskStatus.IN_PROGRESS) return -1;
    if (b.status === TaskStatus.IN_PROGRESS && a.status !== TaskStatus.IN_PROGRESS) return 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    const ad = a.dueAt ? a.dueAt.getTime() : Number.MAX_SAFE_INTEGER;
    const bd = b.dueAt ? b.dueAt.getTime() : Number.MAX_SAFE_INTEGER;
    if (ad !== bd) return ad - bd;
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0] || null;
}

async function repairEpisode(episode) {
  const tasks = await prisma.task.findMany({
    where: { riskEpisodeId: episode.id, status: { in: OPEN_TASK } },
    orderBy: { createdAt: 'asc' },
  });
  const survivor = chooseTask(tasks, episode.openTaskId);
  const duplicateIds = survivor ? tasks.filter((item) => item.id !== survivor.id).map((item) => item.id) : [];

  console.log(`[episode] ${episode.id} ${episode.riskCategory}: open tasks=${tasks.length}` +
    (survivor ? ` keep=${survivor.id}` : ' alert-only') +
    (duplicateIds.length ? ` cancel=${duplicateIds.length}` : ''));

  if (DRY_RUN) return { repaired: 0, canceled: duplicateIds.length };

  await prisma.$transaction(async (tx) => {
    if (duplicateIds.length) {
      await tx.task.updateMany({
        where: { id: { in: duplicateIds } },
        data: { status: TaskStatus.CANCELED, openRiskEpisodeKey: null },
      });
    }
    if (survivor) {
      await tx.task.update({
        where: { id: survivor.id },
        data: { riskEpisodeId: episode.id, openRiskEpisodeKey: episode.id },
      });
    }
    await tx.riskEpisode.update({
      where: { id: episode.id },
      data: { openTaskId: survivor?.id ?? null },
    });
    await tx.hospitalVisitReminder.updateMany({
      where: { riskEpisodeId: episode.id, sourceTaskId: null },
      data: { sourceTaskId: survivor?.id ?? undefined },
    });
  });
  return { repaired: 1, canceled: duplicateIds.length };
}

async function backfillLegacyGroup(alerts) {
  const latest = [...alerts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const correlationKey = correlationFor(latest);
  const openKey = `${latest.patientId}::${correlationKey}`;
  const risk = peakRisk(alerts);
  const alertIds = alerts.map((item) => item.id);
  const tasks = await prisma.task.findMany({
    where: { relatedAlertId: { in: alertIds }, status: { in: OPEN_TASK } },
    orderBy: { createdAt: 'asc' },
  });
  const survivor = chooseTask(tasks, null);
  const duplicateIds = survivor ? tasks.filter((item) => item.id !== survivor.id).map((item) => item.id) : [];

  console.log(`[legacy] patient=${latest.patientId} category=${latest.riskType} alerts=${alerts.length} tasks=${tasks.length}` +
    (survivor ? ` keep=${survivor.id}` : ' project-as-alert-only') +
    (duplicateIds.length ? ` cancel=${duplicateIds.length}` : ''));

  if (DRY_RUN) return { episodes: 1, linkedAlerts: alerts.length, canceled: duplicateIds.length };

  await prisma.$transaction(async (tx) => {
    let episode = await tx.riskEpisode.findUnique({ where: { openKey } });
    if (!episode) {
      episode = await tx.riskEpisode.create({
        data: {
          patientId: latest.patientId,
          riskCategory: latest.riskType,
          correlationKey,
          openKey,
          firstTriggeredAt: alerts.reduce((min, item) => item.createdAt < min ? item.createdAt : min, latest.createdAt),
          lastTriggeredAt: latest.createdAt,
          peakRiskLevel: risk,
          status: alerts.some((item) => item.status === AlertStatus.IN_PROGRESS)
            ? RiskEpisodeStatus.IN_PROGRESS
            : RiskEpisodeStatus.OPEN,
          triggerCount: alerts.length,
          latestEvidence: { source: 'BACKFILL_V5', latestAlertId: latest.id },
        },
      });
    } else {
      episode = await tx.riskEpisode.update({
        where: { id: episode.id },
        data: {
          lastTriggeredAt: latest.createdAt,
          peakRiskLevel: rank[risk] > rank[episode.peakRiskLevel] ? risk : episode.peakRiskLevel,
          triggerCount: { increment: alerts.length },
          latestEvidence: { source: 'BACKFILL_V5', latestAlertId: latest.id },
        },
      });
    }

    await tx.riskAlert.updateMany({ where: { id: { in: alertIds } }, data: { riskEpisodeId: episode.id } });

    if (duplicateIds.length) {
      await tx.task.updateMany({
        where: { id: { in: duplicateIds } },
        data: { status: TaskStatus.CANCELED, openRiskEpisodeKey: null, riskEpisodeId: episode.id },
      });
    }

    if (survivor) {
      await tx.task.update({
        where: { id: survivor.id },
        data: {
          riskEpisodeId: episode.id,
          openRiskEpisodeKey: episode.id,
          priority: Math.min(survivor.priority, priority[risk]),
          relatedAlertId: latest.id,
        },
      });
    }

    await tx.riskEpisode.update({
      where: { id: episode.id },
      data: { openTaskId: survivor?.id ?? episode.openTaskId ?? null },
    });

    await tx.hospitalVisitReminder.updateMany({
      where: { sourceRiskAlertId: { in: alertIds } },
      data: { riskEpisodeId: episode.id, sourceTaskId: survivor?.id ?? undefined },
    });
  });

  return { episodes: 1, linkedAlerts: alerts.length, canceled: duplicateIds.length };
}

async function main() {
  console.log(`=== clinical disposition v5 backfill${DRY_RUN ? ' (dry-run)' : ''} ===`);
  const episodes = await prisma.riskEpisode.findMany({
    where: { status: { in: [RiskEpisodeStatus.OPEN, RiskEpisodeStatus.IN_PROGRESS] } },
    orderBy: { createdAt: 'asc' },
  });

  let repaired = 0;
  let canceled = 0;
  for (const episode of episodes) {
    const result = await repairEpisode(episode);
    repaired += result.repaired;
    canceled += result.canceled;
  }

  const legacyAlerts = await prisma.riskAlert.findMany({
    where: { riskEpisodeId: null, status: { in: OPEN_ALERT } },
    orderBy: { createdAt: 'asc' },
  });
  const groups = new Map();
  for (const alert of legacyAlerts) {
    const key = `${alert.patientId}::${correlationFor(alert)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(alert);
  }

  let createdEpisodes = 0;
  let linkedAlerts = 0;
  for (const alerts of groups.values()) {
    const result = await backfillLegacyGroup(alerts);
    createdEpisodes += result.episodes;
    linkedAlerts += result.linkedAlerts;
    canceled += result.canceled;
  }

  // Historical closed alerts must never leave ungrouped open tasks behind.
  const staleLegacyTasks = await prisma.task.findMany({
    where: {
      riskEpisodeId: null,
      status: { in: OPEN_TASK },
      relatedAlertId: { not: null },
      NOT: { relatedAlertId: { in: legacyAlerts.map((item) => item.id) } },
    },
    select: { id: true, relatedAlertId: true },
  });
  if (staleLegacyTasks.length) {
    console.log(`[cleanup] close ${staleLegacyTasks.length} legacy open task(s) whose related alert is no longer open`);
    if (!DRY_RUN) {
      await prisma.task.updateMany({
        where: { id: { in: staleLegacyTasks.map((item) => item.id) } },
        data: { status: TaskStatus.CANCELED, openRiskEpisodeKey: null },
      });
    }
  }

  console.log('');
  console.log(`${DRY_RUN ? '[dry-run]' : '[done]'} repaired existing episodes: ${repaired}`);
  console.log(`${DRY_RUN ? '[dry-run]' : '[done]'} created/backfilled legacy episodes: ${createdEpisodes}`);
  console.log(`${DRY_RUN ? '[dry-run]' : '[done]'} linked legacy alerts: ${linkedAlerts}`);
  console.log(`${DRY_RUN ? '[dry-run]' : '[done]'} canceled duplicate/stale tasks: ${canceled + staleLegacyTasks.length}`);
}

main()
  .catch((error) => { console.error('[err]', error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
