#!/usr/bin/env node
/*
 * Reconcile care-reminder schedules to their source plans (v3.3).
 *
 * CareReminderSchedule is a derived/cache layer. Its scheduledTimes /
 * timesPerUnit / frequencyUnit / title / isActive / payload must mirror the
 * bound MedicationRecord (sourceType=MEDICATION) or VitalMonitoringPlan
 * (sourceType=VITAL). Before v3.3, schedules kept their own times and could
 * drift (e.g. a twice-a-day BP plan showing once a day at a different time).
 *
 * This script:
 *   1. De-duplicates: keeps ONE canonical schedule per
 *      (patientId, sourceType, sourceId) — an active one if any, else the
 *      earliest-created — and deletes the rest (future PENDING occurrences of
 *      the losers go away; their occurrences cascade-delete via the FK).
 *   2. Reconciles the survivor's title / scheduledTimes / timesPerUnit /
 *      frequencyUnit / isActive / payload to the source plan.
 *
 * Schedules with a null sourceId (ad-hoc / manual) are left untouched.
 *
 * Run from apps/api:
 *   node prisma/reconcile-care-reminder-schedules.js --dry-run   # report only
 *   node prisma/reconcile-care-reminder-schedules.js             # apply
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

function toStringArray(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
}

function medicationWant(med) {
  return {
    title: `服药提醒: ${med.medicationName}`,
    reminderType: 'MEDICATION_CHECKIN',
    frequencyUnit: med.frequencyUnit || 'DAY',
    timesPerUnit: med.timesPerUnit || 1,
    scheduledTimes: toStringArray(med.customDoseTimes),
    scheduledDays: toStringArray(med.customDoseDays),
    isActive: med.isActive,
    payload: {
      medicationId: med.id,
      medicationName: med.medicationName,
      dosage: med.dosage,
      frequency: med.frequency,
    },
  };
}

function vitalWant(plan) {
  return {
    title: `${plan.displayName || plan.vitalType}打卡提醒`,
    reminderType: 'VITAL_RECHECK',
    frequencyUnit: plan.frequencyUnit || 'DAY',
    timesPerUnit: plan.timesPerUnit || 1,
    scheduledTimes: toStringArray(plan.customMeasureTimes),
    scheduledDays: toStringArray(plan.customMeasureDays),
    isActive: plan.isActive,
    payload: {
      vitalPlanId: plan.id,
      vitalType: plan.vitalType,
      displayName: plan.displayName,
      unit: plan.unit,
    },
  };
}

function matches(s, want) {
  return (
    s.title === want.title &&
    s.frequencyUnit === want.frequencyUnit &&
    s.timesPerUnit === want.timesPerUnit &&
    s.isActive === want.isActive &&
    JSON.stringify(toStringArray(s.scheduledTimes)) === JSON.stringify(want.scheduledTimes)
  );
}

async function backfillSourceIds() {
  // v3.3: heal legacy rows whose sourceId was never set (older seeds stored only
  // payload.vitalType / payload.medicationName). Match the patient's plans and
  // write sourceId back so they can be reconciled/deduped like the rest.
  const rows = await prisma.careReminderSchedule.findMany({
    where: {
      sourceType: { in: ['MEDICATION', 'VITAL'] },
      OR: [{ sourceId: null }, { sourceId: '' }],
    },
  });
  let healed = 0;
  for (const s of rows) {
    const payload = s.payload || {};
    let foundId = null;
    if (s.sourceType === 'VITAL') {
      if (payload.vitalPlanId) {
        const byId = await prisma.vitalMonitoringPlan.findUnique({ where: { id: payload.vitalPlanId } });
        if (byId && byId.patientId === s.patientId) foundId = byId.id;
      }
      if (!foundId && payload.vitalType) {
        const plan = await prisma.vitalMonitoringPlan.findFirst({
          where: { patientId: s.patientId, vitalType: payload.vitalType },
          orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        });
        if (plan) foundId = plan.id;
      }
    } else if (s.sourceType === 'MEDICATION') {
      if (payload.medicationId) {
        const byId = await prisma.medicationRecord.findUnique({ where: { id: payload.medicationId } });
        if (byId && byId.patientId === s.patientId) foundId = byId.id;
      }
      if (!foundId && payload.medicationName) {
        const med = await prisma.medicationRecord.findFirst({
          where: { patientId: s.patientId, medicationName: payload.medicationName },
          orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        });
        if (med) foundId = med.id;
      }
    }
    if (foundId) {
      console.log(`[backfill] ${s.id} (${s.sourceType}) sourceId → ${foundId}`);
      if (!DRY_RUN) {
        await prisma.careReminderSchedule.update({ where: { id: s.id }, data: { sourceId: foundId } });
      }
      healed += 1;
    } else {
      console.log(`[orphan] ${s.id} (${s.sourceType}) has no matching plan; left untouched`);
    }
  }
  if (rows.length) {
    console.log(`[backfill] ${DRY_RUN ? 'would heal' : 'healed'} ${healed}/${rows.length} schedule(s) with missing sourceId.`);
  }
}

async function main() {
  await backfillSourceIds();
  const schedules = await prisma.careReminderSchedule.findMany({
    where: { sourceType: { in: ['MEDICATION', 'VITAL'] }, sourceId: { not: null } },
    orderBy: { createdAt: 'asc' },
  });

  // 1) group + dedupe
  const groups = new Map();
  for (const s of schedules) {
    const key = `${s.patientId}|${s.sourceType}|${s.sourceId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  const survivors = [];
  const toDelete = [];
  let dupeGroups = 0;
  for (const [key, rows] of groups) {
    const survivor = rows.find((r) => r.isActive) || rows[0];
    survivors.push(survivor);
    const losers = rows.filter((r) => r.id !== survivor.id);
    if (losers.length) {
      dupeGroups += 1;
      toDelete.push(...losers.map((r) => r.id));
      console.log(`[dupe] ${key} — ${rows.length} schedules; keep ${survivor.id}, delete ${losers.length}`);
    }
  }

  // 2) reconcile survivors to source plans
  let reconciled = 0;
  const updates = [];
  for (const s of survivors) {
    let want = null;
    if (s.sourceType === 'MEDICATION') {
      const med = await prisma.medicationRecord.findUnique({ where: { id: s.sourceId } });
      if (med) want = medicationWant(med);
    } else if (s.sourceType === 'VITAL') {
      const plan = await prisma.vitalMonitoringPlan.findUnique({ where: { id: s.sourceId } });
      if (plan) want = vitalWant(plan);
    }
    if (!want) {
      console.log(`[orphan] schedule ${s.id} (${s.sourceType} ${s.sourceId}) — source plan not found; skipped`);
      continue;
    }
    if (matches(s, want)) continue;
    reconciled += 1;
    console.log(
      `[fix] ${s.id} (${s.sourceType}) times ${JSON.stringify(toStringArray(s.scheduledTimes))} → ` +
        `${JSON.stringify(want.scheduledTimes)}, x${s.timesPerUnit}→x${want.timesPerUnit}, active ${s.isActive}→${want.isActive}`,
    );
    updates.push({ id: s.id, want });
  }

  if (DRY_RUN) {
    console.log(
      `\n[dry-run] would delete ${toDelete.length} duplicate schedule(s) across ${dupeGroups} group(s), ` +
        `and reconcile ${reconciled} schedule(s) to their source plans. Re-run without --dry-run to apply.`,
    );
    return;
  }

  if (toDelete.length) {
    const occ = await prisma.careReminderOccurrence.deleteMany({ where: { scheduleId: { in: toDelete } } });
    const sched = await prisma.careReminderSchedule.deleteMany({ where: { id: { in: toDelete } } });
    console.log(`\n[dedupe] deleted ${sched.count} duplicate schedule(s) and ${occ.count} occurrence(s).`);
  }

  for (const u of updates) {
    await prisma.careReminderSchedule.update({
      where: { id: u.id },
      data: {
        title: u.want.title,
        reminderType: u.want.reminderType,
        frequencyUnit: u.want.frequencyUnit,
        timesPerUnit: u.want.timesPerUnit,
        scheduledTimes: u.want.scheduledTimes,
        scheduledDays: u.want.scheduledDays,
        payload: u.want.payload,
        isActive: u.want.isActive,
        pausedAt: u.want.isActive ? null : new Date(),
      },
    });
  }

  console.log(`[reconcile] updated ${updates.length} schedule(s) to match source plans.`);
  console.log('[done] reconcile complete.');
}

main()
  .catch((e) => {
    console.error('[err]', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
