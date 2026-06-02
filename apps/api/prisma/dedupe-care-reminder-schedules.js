#!/usr/bin/env node
/*
 * Merge duplicate plan-bound care-reminder schedules.
 *
 * Background: before the dedupe fix, POST .../medication-schedules and
 * .../vital-schedules unconditionally created a NEW CareReminderSchedule on
 * every call, so re-running the demo/smoke (or saving twice) stacked several
 * schedules onto the same medication / monitoring plan — which then generated
 * several reminders per day for a once-a-day plan.
 *
 * This script keeps ONE schedule per (patientId, sourceType, sourceId) and
 * deletes the rest. Their occurrences cascade-delete via the FK. The survivor
 * is chosen as: an active one if any, otherwise the earliest-created.
 *
 * Schedules with a null sourceId (ad-hoc / manual) are left untouched.
 *
 * Run from apps/api:
 *   node prisma/dedupe-care-reminder-schedules.js            # apply
 *   node prisma/dedupe-care-reminder-schedules.js --dry-run  # report only
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const schedules = await prisma.careReminderSchedule.findMany({
    where: { sourceId: { not: null } },
    select: {
      id: true,
      patientId: true,
      sourceType: true,
      sourceId: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // group by patientId|sourceType|sourceId
  const groups = new Map();
  for (const s of schedules) {
    const key = `${s.patientId}|${s.sourceType}|${s.sourceId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  let groupsWithDupes = 0;
  let deletedCount = 0;
  const toDelete = [];

  for (const [key, rows] of groups) {
    if (rows.length <= 1) continue;
    groupsWithDupes += 1;

    // survivor: first active (earliest, since list is asc), else earliest overall
    const survivor = rows.find((r) => r.isActive) || rows[0];
    const losers = rows.filter((r) => r.id !== survivor.id);
    deletedCount += losers.length;
    toDelete.push(...losers.map((r) => r.id));

    console.log(
      `[dupe] ${key} — ${rows.length} schedules; keep ${survivor.id}` +
        `${survivor.isActive ? ' (active)' : ''}, delete ${losers.length}`,
    );
  }

  if (toDelete.length === 0) {
    console.log('[done] no duplicate plan-bound schedules found.');
    return;
  }

  if (DRY_RUN) {
    console.log(
      `\n[dry-run] would delete ${deletedCount} duplicate schedule(s) across ` +
        `${groupsWithDupes} plan(s). Re-run without --dry-run to apply.`,
    );
    return;
  }

  // delete occurrences explicitly first (in case the FK isn't cascading in
  // some environments), then the schedules.
  const occ = await prisma.careReminderOccurrence.deleteMany({
    where: { scheduleId: { in: toDelete } },
  });
  const sched = await prisma.careReminderSchedule.deleteMany({
    where: { id: { in: toDelete } },
  });

  console.log(
    `\n[done] merged duplicates across ${groupsWithDupes} plan(s): ` +
      `deleted ${sched.count} schedule(s) and ${occ.count} occurrence(s).`,
  );
}

main()
  .catch((e) => {
    console.error('[err]', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
