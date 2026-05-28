#!/usr/bin/env python3
"""
apply_v3_seed.py
-----------------
Append a `seedCareReminders()` block to apps/api/prisma/seed-all.js, called
from main() right after seedPatientEngagement().

Inserts:
  - backfill HospitalTenant.timezone for both demo tenants
  - CareReminderSchedule:
      * demo-med-001 daily 08:00 medication reminder for demo-patient-001
      * BLOOD_PRESSURE daily 20:00 for demo-patient-001
      * BLOOD_GLUCOSE daily 07:30 for demo-patient-003 (SMS fallback case)
      * medication daily 09:00 for demo-patient-101 (cross-tenant)
  - A handful of CareReminderOccurrence rows for the UI demo:
      * one PENDING in the next hour
      * one SENT (with formLinkId pointing at an existing demo form link)
      * one COMPLETED
      * one MISSED
  - One PatientDirectMessage (requiresAck=true) for demo-patient-001

Idempotent.
"""
from __future__ import annotations
import sys
from pathlib import Path

SEED = Path("apps/api/prisma/seed-all.js")

# Anchor: just before `async function main()`.
ANCHOR = "async function main() {"

BLOCK = r"""
/* care-reminders v3 demo seed (idempotent — relies on upsert + skipDuplicates) */
async function seedCareReminders() {
  // 1) Backfill timezone on both demo tenants (the column is NOT NULL with a
  // default, so this is mostly cosmetic, but it makes the value explicit).
  await prisma.hospitalTenant.update({
    where: { id: 'demo-tenant-001' },
    data: { timezone: 'Asia/Shanghai' },
  }).catch(() => {});
  await prisma.hospitalTenant.update({
    where: { id: 'demo-tenant-002' },
    data: { timezone: 'Asia/Shanghai' },
  }).catch(() => {});

  // 2) Schedules
  const sched1 = await prisma.careReminderSchedule.upsert({
    where: { id: 'demo-care-sched-001-med' },
    update: {},
    create: {
      id: 'demo-care-sched-001-med',
      hospitalTenantId: 'demo-tenant-001',
      patientId: 'demo-patient-001',
      sourceType: 'MEDICATION',
      sourceId: 'demo-med-001',
      title: '服药提醒: 苯磺酸氨氯地平片 5mg',
      description: '请按时服用降压药，并在小程序或本链接确认。',
      reminderType: 'MEDICATION_CHECKIN',
      frequencyUnit: 'DAY',
      timesPerUnit: 1,
      scheduledTimes: ['08:00'],
      payload: { medicationId: 'demo-med-001', medicationName: '苯磺酸氨氯地平片', dosage: '5mg' },
      checkInWindowBeforeMinutes: 60,
      checkInWindowAfterMinutes: 240,
      escalationAfterMinutes: 240,
      isActive: true,
      createdBy: 'nurse-001',
    },
  });

  const sched2 = await prisma.careReminderSchedule.upsert({
    where: { id: 'demo-care-sched-001-bp' },
    update: {},
    create: {
      id: 'demo-care-sched-001-bp',
      hospitalTenantId: 'demo-tenant-001',
      patientId: 'demo-patient-001',
      sourceType: 'VITAL',
      title: '血压打卡提醒',
      description: '请每日睡前测量并上传血压。',
      reminderType: 'VITAL_RECHECK',
      frequencyUnit: 'DAY',
      timesPerUnit: 1,
      scheduledTimes: ['20:00'],
      payload: { vitalType: 'BLOOD_PRESSURE' },
      checkInWindowBeforeMinutes: 60,
      checkInWindowAfterMinutes: 360,
      escalationAfterMinutes: 360,
      isActive: true,
      createdBy: 'nurse-001',
    },
  });

  await prisma.careReminderSchedule.upsert({
    where: { id: 'demo-care-sched-003-glu' },
    update: {},
    create: {
      id: 'demo-care-sched-003-glu',
      hospitalTenantId: 'demo-tenant-001',
      patientId: 'demo-patient-003',
      sourceType: 'VITAL',
      title: '血糖打卡提醒 (短信兜底)',
      description: '请按时打卡空腹血糖。',
      reminderType: 'VITAL_RECHECK',
      frequencyUnit: 'DAY',
      timesPerUnit: 1,
      scheduledTimes: ['07:30'],
      payload: { vitalType: 'BLOOD_GLUCOSE' },
      checkInWindowBeforeMinutes: 30,
      checkInWindowAfterMinutes: 180,
      escalationAfterMinutes: 180,
      isActive: true,
      createdBy: 'nurse-001',
    },
  });

  await prisma.careReminderSchedule.upsert({
    where: { id: 'demo-care-sched-101-med' },
    update: {},
    create: {
      id: 'demo-care-sched-101-med',
      hospitalTenantId: 'demo-tenant-002',
      patientId: 'demo-patient-101',
      sourceType: 'MEDICATION',
      title: '服药提醒 (示例三甲)',
      description: '示例三甲医院的演示提醒，用于跨租户验证。',
      reminderType: 'MEDICATION_CHECKIN',
      frequencyUnit: 'DAY',
      timesPerUnit: 1,
      scheduledTimes: ['09:00'],
      payload: { medicationName: '示例药物' },
      checkInWindowBeforeMinutes: 60,
      checkInWindowAfterMinutes: 240,
      isActive: true,
      createdBy: 'nurse-001',
    },
  });

  // 3) Sample occurrences for the UI demo. Use deterministic ids so re-running
  //    is a no-op via upsert.
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
  const yesterday20 = new Date(now.getTime() - 26 * 60 * 60 * 1000);
  const yesterday8 = new Date(now.getTime() - 38 * 60 * 60 * 1000);
  const twoDaysAgo8 = new Date(now.getTime() - 62 * 60 * 60 * 1000);

  const sampleOccurrences = [
    {
      id: 'demo-care-occ-pending-001',
      scheduleId: sched1.id,
      occurrenceType: 'MEDICATION_CHECKIN',
      title: sched1.title,
      dueAt: inOneHour,
      availableFrom: new Date(inOneHour.getTime() - 60 * 60 * 1000),
      availableUntil: new Date(inOneHour.getTime() + 4 * 60 * 60 * 1000),
      status: 'PENDING',
    },
    {
      id: 'demo-care-occ-completed-001',
      scheduleId: sched1.id,
      occurrenceType: 'MEDICATION_CHECKIN',
      title: sched1.title,
      dueAt: yesterday8,
      availableFrom: new Date(yesterday8.getTime() - 60 * 60 * 1000),
      availableUntil: new Date(yesterday8.getTime() + 4 * 60 * 60 * 1000),
      status: 'COMPLETED',
      completedAt: new Date(yesterday8.getTime() + 30 * 60 * 1000),
      resultType: 'MedicationCheckIn',
      resultId: 'demo-med-check-001-d01',
    },
    {
      id: 'demo-care-occ-missed-001',
      scheduleId: sched2.id,
      occurrenceType: 'VITAL_RECHECK',
      title: sched2.title,
      dueAt: yesterday20,
      availableFrom: new Date(yesterday20.getTime() - 60 * 60 * 1000),
      availableUntil: new Date(yesterday20.getTime() + 6 * 60 * 60 * 1000),
      status: 'MISSED',
      missedAt: new Date(yesterday20.getTime() + 6 * 60 * 60 * 1000),
    },
    {
      id: 'demo-care-occ-pending-002',
      scheduleId: sched1.id,
      occurrenceType: 'MEDICATION_CHECKIN',
      title: sched1.title,
      dueAt: twoDaysAgo8,
      availableFrom: new Date(twoDaysAgo8.getTime() - 60 * 60 * 1000),
      availableUntil: new Date(twoDaysAgo8.getTime() + 4 * 60 * 60 * 1000),
      status: 'MISSED',
      missedAt: new Date(twoDaysAgo8.getTime() + 4 * 60 * 60 * 1000),
    },
  ];

  for (const seed of sampleOccurrences) {
    await prisma.careReminderOccurrence.upsert({
      where: { id: seed.id },
      update: {},
      create: {
        ...seed,
        hospitalTenantId: 'demo-tenant-001',
        patientId: 'demo-patient-001',
      },
    });
  }

  // 4) One demo direct message (requiresAck) from nurse-001 to demo-patient-001.
  // Skip if it exists.
  const existingDirect = await prisma.patientDirectMessage.findFirst({
    where: { id: 'demo-direct-msg-001' },
    select: { id: true },
  });
  if (!existingDirect) {
    await prisma.patientDirectMessage.create({
      data: {
        id: 'demo-direct-msg-001',
        hospitalTenantId: 'demo-tenant-001',
        patientId: 'demo-patient-001',
        senderId: 'nurse-001',
        title: '请确认本周复查时间',
        content: '王先生您好, 您本周三上午 9:00 复查门诊, 请按时来院。如有疑问请回复或致电护士站。',
        priority: 'IMPORTANT',
        channel: 'WECHAT_OFFICIAL_ACCOUNT',
        status: 'SENT',
        requiresAck: true,
      },
    });
  }

  console.log('Care reminders v3 demo seeded:');
  console.log('- 4 CareReminderSchedule rows (med×2, vital×2)');
  console.log('- 4 CareReminderOccurrence rows (PENDING / COMPLETED / MISSED ×2)');
  console.log('- 1 PatientDirectMessage (requiresAck=true)');
}

"""

CALL_LINE = "  await seedCareReminders();\n"


def main() -> int:
    if not SEED.exists():
        print(f"[err] {SEED} not found", file=sys.stderr)
        return 1
    src = SEED.read_text(encoding="utf-8")
    original = src
    notes: list[str] = []

    # 1) inject the seedCareReminders function just before main()
    if "async function seedCareReminders" not in src:
        if ANCHOR not in src:
            print("[err] could not find 'async function main()' anchor", file=sys.stderr)
            return 1
        src = src.replace(ANCHOR, BLOCK + ANCHOR, 1)
        notes.append("appended seedCareReminders() function")

    # 2) call it from main() after seedPatientEngagement()
    if "await seedCareReminders()" not in src:
        if "await seedPatientEngagement();" in src:
            src = src.replace(
                "await seedPatientEngagement();",
                "await seedPatientEngagement();\n" + CALL_LINE.rstrip("\n"),
                1,
            )
            notes.append("call seedCareReminders() from main()")
        else:
            print("[warn] couldn't find 'await seedPatientEngagement();' anchor. "
                  "You may need to call seedCareReminders() manually.")

    if src == original:
        print("[skip] seed-all.js already has v3 care-reminders seed.")
        return 0

    SEED.write_text(src, encoding="utf-8")
    print("[ok] seed-all.js patched:")
    for n in notes:
        print(f"     - {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
