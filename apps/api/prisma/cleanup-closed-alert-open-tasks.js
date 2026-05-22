#!/usr/bin/env node
/*
 * Close stale open tasks/reminders whose related risk alert has already been resolved or dismissed.
 * Run from apps/api after applying this patch:
 *   node prisma/cleanup-closed-alert-open-tasks.js
 */

const {
  AlertStatus,
  HospitalVisitReminderStatus,
  PrismaClient,
  TaskStatus,
} = require('@prisma/client');

const prisma = new PrismaClient();

const OPEN_TASK_STATUSES = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS];
const CLOSED_ALERT_STATUSES = [AlertStatus.RESOLVED, AlertStatus.DISMISSED];

async function main() {
  const closedAlerts = await prisma.riskAlert.findMany({
    where: { status: { in: CLOSED_ALERT_STATUSES } },
    select: { id: true, patientId: true, status: true },
  });

  let closedTaskCount = 0;
  let revokedReminderCount = 0;

  for (const alert of closedAlerts) {
    const finalTaskStatus = alert.status === AlertStatus.RESOLVED ? TaskStatus.DONE : TaskStatus.CANCELED;

    const taskResult = await prisma.task.updateMany({
      where: {
        patientId: alert.patientId,
        relatedAlertId: alert.id,
        status: { in: OPEN_TASK_STATUSES },
      },
      data: { status: finalTaskStatus },
    });
    closedTaskCount += taskResult.count;

    const reminderResult = await prisma.hospitalVisitReminder.updateMany({
      where: {
        patientId: alert.patientId,
        sourceRiskAlertId: alert.id,
        status: HospitalVisitReminderStatus.ACTIVE,
      },
      data: {
        status: HospitalVisitReminderStatus.REVOKED,
        revokedAt: new Date(),
        revokeReason: '关联风险预警已完成处置，清理仍处于有效状态的到院提醒。',
      },
    });
    revokedReminderCount += reminderResult.count;
  }

  console.log(`Closed ${closedTaskCount} stale open task(s).`);
  console.log(`Revoked ${revokedReminderCount} stale active hospital visit reminder(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
