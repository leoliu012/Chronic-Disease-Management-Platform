#!/usr/bin/env node
/*
 * Backfill task titles so risk-related tasks use their RiskAlert.title.
 * Run from apps/api:
 *   node prisma/backfill-risk-task-titles.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const tasks = await prisma.task.findMany({
    where: {
      relatedAlertId: { not: null },
    },
    select: {
      id: true,
      title: true,
      relatedAlertId: true,
    },
  });

  const alertIds = Array.from(new Set(tasks.map((task) => task.relatedAlertId).filter(Boolean)));
  const alerts = await prisma.riskAlert.findMany({
    where: { id: { in: alertIds } },
    select: { id: true, title: true },
  });
  const alertTitleById = new Map(alerts.map((alert) => [alert.id, alert.title]));

  let updatedCount = 0;
  for (const task of tasks) {
    const alertTitle = task.relatedAlertId ? alertTitleById.get(task.relatedAlertId) : null;
    if (!alertTitle || task.title === alertTitle) continue;

    await prisma.task.update({
      where: { id: task.id },
      data: { title: alertTitle },
    });
    updatedCount += 1;
  }

  console.log(`Backfilled ${updatedCount} risk-related task title(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
