#!/usr/bin/env node
/* Read-only database invariant checker for clinical disposition v5. */
const {
  AlertStatus,
  PrismaClient,
  RiskEpisodeStatus,
  TaskStatus,
} = require('@prisma/client');
const prisma = new PrismaClient();
const OPEN_ALERT = [AlertStatus.OPEN, AlertStatus.IN_PROGRESS];
const OPEN_TASK = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS];

async function main() {
  console.log('=== clinical disposition v5 invariant check ===');
  const [episodes, openAlerts, openTasks, activeReminders] = await Promise.all([
    prisma.riskEpisode.findMany({
      where: { status: { in: [RiskEpisodeStatus.OPEN, RiskEpisodeStatus.IN_PROGRESS] } },
      include: { tasks: true, alerts: true },
    }),
    prisma.riskAlert.findMany({ where: { status: { in: OPEN_ALERT } } }),
    prisma.task.findMany({ where: { status: { in: OPEN_TASK } } }),
    prisma.hospitalVisitReminder.findMany({ where: { status: 'ACTIVE' } }),
  ]);

  const violations = [];
  let alertOnly = 0;
  for (const episode of episodes) {
    const tasks = episode.tasks.filter((item) => OPEN_TASK.includes(item.status));
    const primaryTasks = tasks.filter((item) => item.openRiskEpisodeKey === episode.id);
    if (primaryTasks.length > 1) violations.push(`episode ${episode.id}: ${primaryTasks.length} primary open tasks`);
    if (tasks.length > 1) violations.push(`episode ${episode.id}: ${tasks.length} open tasks total`);
    if (episode.openTaskId) {
      const pointer = tasks.find((item) => item.id === episode.openTaskId);
      if (!pointer) violations.push(`episode ${episode.id}: openTaskId points to missing/closed task ${episode.openTaskId}`);
      else if (pointer.openRiskEpisodeKey !== episode.id) violations.push(`episode ${episode.id}: open task token mismatch`);
    } else if (tasks.length === 0) {
      alertOnly += 1;
    }
  }

  for (const task of openTasks) {
    if (task.openRiskEpisodeKey && task.riskEpisodeId !== task.openRiskEpisodeKey) {
      violations.push(`task ${task.id}: token ${task.openRiskEpisodeKey} != riskEpisodeId ${task.riskEpisodeId}`);
    }
  }

  const closedAlertIds = (await prisma.riskAlert.findMany({
    where: { status: { in: [AlertStatus.RESOLVED, AlertStatus.DISMISSED] } },
    select: { id: true },
  })).map((item) => item.id);
  const staleLegacyTasks = closedAlertIds.length
    ? await prisma.task.count({
        where: { riskEpisodeId: null, relatedAlertId: { in: closedAlertIds }, status: { in: OPEN_TASK } },
      })
    : 0;
  if (staleLegacyTasks) violations.push(`${staleLegacyTasks} legacy task(s) remain open after their related alert was closed`);

  const ungroupedOpenAlerts = openAlerts.filter((item) => !item.riskEpisodeId).length;
  if (ungroupedOpenAlerts) violations.push(`${ungroupedOpenAlerts} open alert(s) are missing riskEpisodeId; run backfill`);

  const remindersWithoutSource = activeReminders.filter((item) => !item.sourceRiskAlertId && !item.sourceTaskId).length;
  console.log(`open episodes:                 ${episodes.length}`);
  console.log(`open alerts:                   ${openAlerts.length}`);
  console.log(`open tasks:                    ${openTasks.length}`);
  console.log(`alert-only workbench episodes: ${alertOnly}`);
  console.log(`active visit reminders:        ${activeReminders.length}`);
  console.log(`active reminders without source linkage (warning): ${remindersWithoutSource}`);

  if (violations.length) {
    console.error('\n[fail] invariant violations:');
    for (const item of violations) console.error(`  - ${item}`);
    process.exitCode = 1;
    return;
  }
  console.log('\n[ok] one-open-task-per-episode and closure invariants hold.');
}

main()
  .catch((error) => { console.error('[err]', error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
