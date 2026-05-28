#!/usr/bin/env python3
"""
apply_v3_schema.py
-------------------
Idempotent Prisma schema patcher for care-reminders v3.

  1. HospitalTenant: add `timezone String @default("Asia/Shanghai")`
                      + back-relations to CareReminderSchedule[], CareReminderOccurrence[],
                        PatientDirectMessage[]
  2. Patient:        add back-relations to CareReminderSchedule[], CareReminderOccurrence[],
                                          PatientDirectMessage[]
  3. User:           add `sentDirectMessages PatientDirectMessage[]` back-relation
  4. Append models: CareReminderSchedule, CareReminderOccurrence, PatientDirectMessage
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

SCHEMA = Path("apps/api/prisma/schema.prisma")

NEW_MODELS = """

// ============================================================================
// care-reminders v3
// ============================================================================

model CareReminderSchedule {
  id                          String   @id @default(uuid())
  hospitalTenantId            String
  patientId                   String
  // 来源: MEDICATION / VITAL / QUESTIONNAIRE / FOLLOW_UP / MANUAL_MESSAGE
  sourceType                  String
  // MedicationRecord.id / VitalMonitoringPlan.id / Task.id ...
  sourceId                    String?
  title                       String
  description                 String?
  // MEDICATION_CHECKIN / VITAL_RECHECK / QUESTIONNAIRE / GENERAL_MESSAGE
  reminderType                String
  // DAY / WEEK / MONTH
  frequencyUnit               String   @default("DAY")
  timesPerUnit                Int      @default(1)
  // ["08:00", "20:00"]  — wall-clock in tenant timezone
  scheduledTimes              Json?
  // weekly: ["MON", "WED", "FRI"]
  scheduledDays               Json?
  // arbitrary payload (medicationId, vitalType, etc.)
  payload                     Json?
  reminderLeadMinutes         Int      @default(0)
  checkInWindowBeforeMinutes  Int      @default(180)
  checkInWindowAfterMinutes   Int      @default(180)
  escalationAfterMinutes      Int?
  isActive                    Boolean  @default(true)
  pausedAt                    DateTime?
  startDate                   DateTime?
  endDate                     DateTime?
  createdBy                   String?
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt

  hospitalTenant HospitalTenant            @relation(fields: [hospitalTenantId], references: [id], onDelete: Cascade)
  patient        Patient                   @relation(fields: [patientId], references: [id], onDelete: Cascade)
  occurrences    CareReminderOccurrence[]

  @@index([hospitalTenantId, patientId, isActive])
  @@index([sourceType, sourceId])
}

model CareReminderOccurrence {
  id                String   @id @default(uuid())
  hospitalTenantId  String
  patientId         String
  scheduleId        String
  // MEDICATION_CHECKIN / VITAL_RECHECK / QUESTIONNAIRE / GENERAL_MESSAGE
  occurrenceType    String
  title             String
  dueAt             DateTime
  availableFrom     DateTime
  availableUntil    DateTime
  // PENDING / SENDING / SENT / CLICKED / COMPLETED / MISSED / ESCALATED / CANCELED
  status            String   @default("PENDING")
  formLinkId        String?
  outboundMessageId String?
  sentAt            DateTime?
  completedAt       DateTime?
  missedAt          DateTime?
  escalatedAt       DateTime?
  escalatedTaskId   String?
  // MedicationCheckIn / VitalRecord / QuestionnaireResult / DirectMessageAck
  resultType        String?
  resultId          String?
  lastError         String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  hospitalTenant HospitalTenant       @relation(fields: [hospitalTenantId], references: [id], onDelete: Cascade)
  patient        Patient              @relation(fields: [patientId], references: [id], onDelete: Cascade)
  schedule       CareReminderSchedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)

  @@unique([scheduleId, dueAt])
  @@index([hospitalTenantId, patientId, dueAt])
  @@index([status, dueAt])
  @@index([formLinkId])
}

model PatientDirectMessage {
  id                String   @id @default(uuid())
  hospitalTenantId  String
  patientId         String
  senderId          String
  title             String
  content           String
  // NORMAL / IMPORTANT / URGENT
  priority          String   @default("NORMAL")
  // WECHAT_OFFICIAL_ACCOUNT / SMS / MANUAL_COPY
  channel           String
  formLinkId        String?
  outboundMessageId String?
  // PENDING / SENT / FAILED / CLICKED / ACKNOWLEDGED
  status            String   @default("PENDING")
  requiresAck       Boolean  @default(false)
  acknowledgedAt    DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  hospitalTenant HospitalTenant @relation(fields: [hospitalTenantId], references: [id], onDelete: Cascade)
  patient        Patient        @relation(fields: [patientId], references: [id], onDelete: Cascade)
  sender         User           @relation("UserSentDirectMessages", fields: [senderId], references: [id], onDelete: Restrict)

  @@index([hospitalTenantId, patientId, createdAt])
  @@index([senderId, createdAt])
  @@index([formLinkId])
}
"""


def _model_body_span(src: str, name: str):
    m = re.search(r"model\s+" + re.escape(name) + r"\s*\{", src)
    if not m:
        return None
    start = m.end()
    depth = 1
    i = start
    while i < len(src) and depth > 0:
        ch = src[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return start, i
        i += 1
    return None


def _inject_into_model(src: str, name: str, lines: str, marker: str) -> tuple[str, bool]:
    span = _model_body_span(src, name)
    if not span:
        return src, False
    start, end = span
    body = src[start:end]
    if marker in body:
        return src, False
    return src[:end] + lines + src[end:], True


def main() -> int:
    if not SCHEMA.exists():
        print(f"[err] {SCHEMA} not found", file=sys.stderr)
        return 1
    src = SCHEMA.read_text(encoding="utf-8")
    original = src
    notes: list[str] = []

    # 1) HospitalTenant.timezone column
    span = _model_body_span(src, "HospitalTenant")
    if not span:
        print("[err] HospitalTenant not found in schema.", file=sys.stderr)
        return 1
    start, end = span
    body = src[start:end]
    if "timezone " not in body and "timezone\n" not in body:
        # Insert just after the `isActive` line to keep grouping tidy.
        if 'isActive    Boolean  @default(true)' in body:
            new_body = body.replace(
                'isActive    Boolean  @default(true)',
                'isActive    Boolean  @default(true)\n  // care-reminders v3\n  timezone    String   @default("Asia/Shanghai")',
                1,
            )
            src = src[:start] + new_body + src[end:]
            notes.append("HospitalTenant.timezone added")

    # 2) HospitalTenant back-relations
    src, changed = _inject_into_model(
        src, "HospitalTenant",
        "  // care-reminders v3\n"
        "  careReminderSchedules   CareReminderSchedule[]\n"
        "  careReminderOccurrences CareReminderOccurrence[]\n"
        "  patientDirectMessages   PatientDirectMessage[]\n",
        marker="careReminderSchedules",
    )
    if changed:
        notes.append("HospitalTenant back-relations added")

    # 3) Patient back-relations
    src, changed = _inject_into_model(
        src, "Patient",
        "  // care-reminders v3\n"
        "  careReminderSchedules   CareReminderSchedule[]\n"
        "  careReminderOccurrences CareReminderOccurrence[]\n"
        "  patientDirectMessages   PatientDirectMessage[]\n",
        marker="careReminderSchedules",
    )
    if changed:
        notes.append("Patient back-relations added")

    # 4) User back-relation for direct messages (named relation; sender ↔ user)
    src, changed = _inject_into_model(
        src, "User",
        '  // care-reminders v3\n'
        '  sentDirectMessages PatientDirectMessage[] @relation("UserSentDirectMessages")\n',
        marker="sentDirectMessages",
    )
    if changed:
        notes.append("User.sentDirectMessages back-relation added")

    # 5) Append new models
    if "model CareReminderSchedule" not in src:
        if not src.endswith("\n"):
            src += "\n"
        src += NEW_MODELS
        notes.append("CareReminderSchedule / Occurrence / PatientDirectMessage models appended")

    if src == original:
        print("[skip] schema.prisma already at care-reminders v3.")
        return 0

    SCHEMA.write_text(src, encoding="utf-8")
    print("[ok] schema.prisma patched (care-reminders v3):")
    for n in notes:
        print(f"     - {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
