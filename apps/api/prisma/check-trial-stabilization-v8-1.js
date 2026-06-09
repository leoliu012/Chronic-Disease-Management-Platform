#!/usr/bin/env node
/*
 * Post-deploy data check for trial-stabilization-v8.1.
 * Run from apps/api after repair and Worker restart:
 *   node prisma/check-trial-stabilization-v8-1.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function fail(message) {
  throw new Error(message);
}

async function main() {
  const now = new Date();
  const [
    expiredActiveLinks,
    sourceLessBoundSchedules,
    demoSchedule,
    demoMedication,
    latestWorkerRun,
    staleOpenTasks,
    pendingAllocationPatients,
  ] = await Promise.all([
    prisma.patientFormLink.count({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
    }),
    prisma.careReminderSchedule.count({
      where: {
        sourceType: { in: ['MEDICATION', 'VITAL'] },
        sourceId: null,
      },
    }),
    prisma.careReminderSchedule.findUnique({
      where: { id: 'demo-care-sched-101-med' },
      select: { id: true, patientId: true, sourceType: true, sourceId: true, payload: true },
    }),
    prisma.medicationRecord.findUnique({
      where: { id: 'demo-med-101' },
      select: { id: true, patientId: true, medicationName: true, dosage: true, isActive: true },
    }),
    prisma.careReminderWorkerRun.findFirst({
      orderBy: { startedAt: 'desc' },
      select: { id: true, status: true, expiredLinks: true, startedAt: true, finishedAt: true },
    }),
    prisma.task.count({
      where: { status: { in: ['PENDING', 'IN_PROGRESS'] }, dueAt: { lt: now } },
    }),
    prisma.patient.count({ where: { responsibleNurseId: null } }),
  ]);

  if (expiredActiveLinks !== 0) {
    fail(`${expiredActiveLinks} PatientFormLink row(s) remain ACTIVE after expiry`);
  }
  if (sourceLessBoundSchedules !== 0) {
    fail(`${sourceLessBoundSchedules} MEDICATION / VITAL CareReminderSchedule row(s) still have NULL sourceId`);
  }
  if (demoSchedule && demoSchedule.sourceId !== 'demo-med-101') {
    fail(`demo-care-sched-101-med is bound to ${demoSchedule.sourceId || 'NULL'}, expected demo-med-101`);
  }
  if (demoSchedule && (!demoMedication || demoMedication.patientId !== 'demo-patient-101')) {
    fail('demo-med-101 missing or not owned by demo-patient-101');
  }

  console.log('[PASS] no expired ACTIVE PatientFormLink rows');
  console.log('[PASS] no source-less MEDICATION / VITAL CareReminderSchedule rows');
  if (demoSchedule) console.log('[PASS] demo-care-sched-101-med is bound to demo-med-101');
  console.log(`[INFO] latest Worker run: ${latestWorkerRun ? JSON.stringify(latestWorkerRun) : 'none yet'}`);
  console.log(`[INFO] stale open tasks: ${staleOpenTasks} (operational queue; review, do not delete)`);
  console.log(`[INFO] pending-allocation patients: ${pendingAllocationPatients} (valid queue state)`);
  console.log('\n[PASS] trial-stabilization-v8.1 data check succeeded');
}

main()
  .catch((error) => {
    console.error('\n[FAIL]', error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
