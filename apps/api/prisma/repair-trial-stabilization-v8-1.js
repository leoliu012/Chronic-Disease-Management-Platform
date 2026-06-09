#!/usr/bin/env node
/*
 * trial-stabilization-v8.1 existing-database repair
 *
 * Run from apps/api after prisma migrate + prisma generate:
 *   node prisma/repair-trial-stabilization-v8-1.js --dry-run
 *   node prisma/repair-trial-stabilization-v8-1.js
 *
 * Safe scope:
 *   1) converge expired ACTIVE PatientFormLink rows to EXPIRED;
 *   2) repair the exact cross-tenant demo fixture demo-care-sched-101-med;
 *   3) report, but never guess or mutate, any remaining non-demo source-less
 *      MEDICATION / VITAL schedules.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function repairExpiredLinks(now) {
  const where = { status: 'ACTIVE', expiresAt: { lte: now } };
  const count = await prisma.patientFormLink.count({ where });
  console.log(`[h5-expiry] ${count} ACTIVE link(s) already expired${DRY_RUN ? ' (dry-run)' : ''}.`);
  if (!DRY_RUN && count) {
    const updated = await prisma.patientFormLink.updateMany({
      where,
      data: { status: 'EXPIRED' },
    });
    console.log(`[h5-expiry] converged ${updated.count} link(s) to EXPIRED.`);
  }
  return count;
}

async function repairDemoTenant2MedicationFixture() {
  const schedule = await prisma.careReminderSchedule.findUnique({
    where: { id: 'demo-care-sched-101-med' },
  });
  if (!schedule) {
    console.log('[demo-fixture] demo-care-sched-101-med not present; nothing to repair.');
    return false;
  }
  if (schedule.patientId !== 'demo-patient-101' || schedule.sourceType !== 'MEDICATION') {
    throw new Error(
      `[demo-fixture] refusing to mutate unexpected schedule ${schedule.id}: ` +
      `patientId=${schedule.patientId} sourceType=${schedule.sourceType}`,
    );
  }

  const needsRepair = schedule.sourceId !== 'demo-med-101';
  console.log(
    `[demo-fixture] ${schedule.id} sourceId=${schedule.sourceId || 'NULL'} ` +
    `${needsRepair ? 'needs repair' : 'already bound'}.`,
  );
  if (DRY_RUN) return needsRepair;

  const medication = await prisma.medicationRecord.upsert({
    where: { id: 'demo-med-101' },
    update: {
      patientId: 'demo-patient-101',
      medicationName: '示例药物',
      dosage: '示例剂量',
      frequency: '每日 1 次',
      frequencyUnit: 'DAY',
      timesPerUnit: 1,
      timingRelation: 'NONE',
      customDoseTimes: ['09:00'],
      reminderLeadMinutes: 180,
      checkInWindowBeforeMinutes: 60,
      missedWindowAfterMinutes: 240,
      dataSource: 'EMR',
      isActive: true,
    },
    create: {
      id: 'demo-med-101',
      patientId: 'demo-patient-101',
      medicationName: '示例药物',
      dosage: '示例剂量',
      frequency: '每日 1 次',
      frequencyUnit: 'DAY',
      timesPerUnit: 1,
      timingRelation: 'NONE',
      customDoseTimes: ['09:00'],
      reminderLeadMinutes: 180,
      checkInWindowBeforeMinutes: 60,
      missedWindowAfterMinutes: 240,
      dataSource: 'EMR',
      isActive: true,
    },
  });

  await prisma.careReminderSchedule.update({
    where: { id: schedule.id },
    data: {
      sourceId: medication.id,
      payload: {
        medicationId: medication.id,
        medicationName: medication.medicationName,
        dosage: medication.dosage,
      },
    },
  });
  console.log(`[demo-fixture] bound ${schedule.id} -> ${medication.id}.`);
  return true;
}

async function reportRemainingSourceLessSchedules() {
  const rows = await prisma.careReminderSchedule.findMany({
    where: {
      sourceType: { in: ['MEDICATION', 'VITAL'] },
      sourceId: null,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      patientId: true,
      sourceType: true,
      title: true,
      payload: true,
    },
  });
  if (!rows.length) {
    console.log('[source-check] no source-less MEDICATION / VITAL schedules remain.');
    return;
  }
  console.warn(`[source-check] ${rows.length} source-less schedule(s) still require manual review:`);
  for (const row of rows) {
    console.warn(`- ${row.id} patient=${row.patientId} type=${row.sourceType} title=${row.title}`);
  }
}

async function main() {
  console.log(`trial-stabilization-v8.1 repair ${DRY_RUN ? '(dry-run)' : '(apply)'}`);
  await repairExpiredLinks(new Date());
  await repairDemoTenant2MedicationFixture();
  await reportRemainingSourceLessSchedules();
  console.log('[done] trial-stabilization-v8.1 repair complete.');
}

main()
  .catch((error) => {
    console.error('\n[FAIL]', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
