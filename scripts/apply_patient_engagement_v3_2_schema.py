#!/usr/bin/env python3
"""
apply_patient_engagement_v3_2_schema.py
---------------------------------------
Idempotent Prisma schema patcher for Patient Engagement v3.2.

  1. PatientOutboundMessage
       + attempts        PatientOutboundAttempt[]
       + lastAttemptAt   DateTime?
       + deliverySummary Json?
  2. PatientFormLink
       + submissionType  String?
       + submissionId    String?
       + submittedAt     DateTime?
  3. Patient
       + outboundAttempts      PatientOutboundAttempt[]
       + hospitalVisitFeedbacks HospitalVisitFeedback[]
  4. Append models:
       - PatientOutboundAttempt  (one delivery attempt per WeChat/SMS try)
       - HospitalVisitFeedback   (structured patient 到院反馈)

Run from repo root:
  python3 scripts/apply_patient_engagement_v3_2_schema.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

SCHEMA = Path("apps/api/prisma/schema.prisma")

NEW_MODELS = """

// ============================================================================
// patient_engagement_v3_2 — delivery attempts + structured visit feedback
// ============================================================================

model PatientOutboundAttempt {
  id                String   @id @default(uuid())
  messageId         String
  hospitalTenantId  String?
  patientId         String
  formLinkId        String?
  // WECHAT_OFFICIAL_ACCOUNT / SMS
  channel           String
  // SENT / FAILED
  status            String
  recipientMasked   String?
  providerMessageId String?
  errorMessage      String?
  attemptNo         Int
  // INITIAL / AUTO_FALLBACK / NURSE_RESEND
  triggerReason     String?
  triggeredBy       String?
  sentAt            DateTime?
  createdAt         DateTime @default(now())

  message PatientOutboundMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
  patient Patient                @relation(fields: [patientId], references: [id], onDelete: Cascade)

  @@index([messageId, createdAt])
  @@index([hospitalTenantId, patientId, createdAt])
  @@index([channel, status])
}

model HospitalVisitFeedback {
  id                      String   @id @default(uuid())
  hospitalTenantId        String
  patientId               String
  formLinkId              String?
  messageId               String?
  hospitalVisitReminderId String?
  taskId                  String?
  riskAlertId             String?
  // WILL_VISIT / ARRIVED / CANNOT_VISIT / REFUSED
  action                  String
  note                    String?
  submittedAt             DateTime @default(now())
  source                  String   @default("H5_LINK")
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt

  patient Patient @relation(fields: [patientId], references: [id], onDelete: Cascade)

  @@index([hospitalTenantId, patientId, submittedAt])
  @@index([formLinkId])
  @@index([messageId])
  @@index([hospitalVisitReminderId])
  @@index([taskId])
  @@index([riskAlertId])
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


def _inject_before_close(src: str, name: str, lines: str, marker: str) -> tuple[str, bool]:
    span = _model_body_span(src, name)
    if not span:
        print(f"[err] model {name} not found", file=sys.stderr)
        sys.exit(1)
    start, end = span
    body = src[start:end]
    if marker in body:
        return src, False
    return src[:end] + lines + src[end:], True


def main() -> int:
    if not SCHEMA.exists():
        print(f"[err] {SCHEMA} not found (run from repo root)", file=sys.stderr)
        return 1
    src = SCHEMA.read_text(encoding="utf-8")
    original = src
    notes: list[str] = []

    # 1) PatientOutboundMessage: attempts + lastAttemptAt + deliverySummary
    src, changed = _inject_before_close(
        src,
        "PatientOutboundMessage",
        "  // patient_engagement_v3_2\n"
        "  attempts          PatientOutboundAttempt[]\n"
        "  lastAttemptAt     DateTime?\n"
        "  deliverySummary   Json?\n",
        marker="attempts",
    )
    if changed:
        notes.append("PatientOutboundMessage.attempts/lastAttemptAt/deliverySummary added")

    # 2) PatientFormLink: submission linkage
    src, changed = _inject_before_close(
        src,
        "PatientFormLink",
        "  // patient_engagement_v3_2 — submission linkage\n"
        "  submissionType String?\n"
        "  submissionId   String?\n"
        "  submittedAt    DateTime?\n",
        marker="submissionType",
    )
    if changed:
        notes.append("PatientFormLink.submissionType/submissionId/submittedAt added")

    # 3) Patient back-relations
    src, changed = _inject_before_close(
        src,
        "Patient",
        "  // patient_engagement_v3_2\n"
        "  outboundAttempts        PatientOutboundAttempt[]\n"
        "  hospitalVisitFeedbacks  HospitalVisitFeedback[]\n",
        marker="outboundAttempts",
    )
    if changed:
        notes.append("Patient.outboundAttempts/hospitalVisitFeedbacks back-relations added")

    # 4) Append new models
    if "model PatientOutboundAttempt" not in src:
        if not src.endswith("\n"):
            src += "\n"
        src += NEW_MODELS
        notes.append("PatientOutboundAttempt + HospitalVisitFeedback models appended")

    if src == original:
        print("[skip] schema.prisma already at patient-engagement v3.2.")
        return 0

    SCHEMA.write_text(src, encoding="utf-8")
    print("[ok] schema.prisma patched (patient-engagement v3.2):")
    for n in notes:
        print(f"     - {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
