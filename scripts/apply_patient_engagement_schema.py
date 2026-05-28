#!/usr/bin/env python3
"""
apply_patient_engagement_schema.py
-----------------------------------
Idempotent patcher for apps/api/prisma/schema.prisma adding the patient
engagement models. Safe to run multiple times.

Adds:
  * Patient.hospitalTenantId            (optional, with relation back-ref)
  * Patient.formLinks                   relation
  * Patient.outboundMessages            relation
  * Patient.wechatIdentities            relation
  * User.hospitalTenantId               (optional, with relation back-ref)
  * model HospitalTenant
  * model PatientWechatIdentity
  * model PatientFormLink
  * model PatientOutboundMessage
  * model EngagementEventLog
"""
from __future__ import annotations

import io
import re
import sys
from pathlib import Path

SCHEMA = Path("apps/api/prisma/schema.prisma")

PATIENT_FIELDS = """  // patient-engagement-wechat-h5-v1
  hospitalTenantId String?
  hospitalTenant   HospitalTenant? @relation(fields: [hospitalTenantId], references: [id])
  wechatIdentities PatientWechatIdentity[]
  formLinks        PatientFormLink[]
  outboundMessages PatientOutboundMessage[]
"""

USER_FIELDS = """  // patient-engagement-wechat-h5-v1
  hospitalTenantId String?
  hospitalTenant   HospitalTenant? @relation(fields: [hospitalTenantId], references: [id])
"""

# Index lines we want inside Patient block (added near other @@index lines)
PATIENT_INDEX = "  @@index([hospitalTenantId])"
USER_INDEX = "  @@index([hospitalTenantId])"

MODELS_BLOCK = """

// ============================================================================
// patient-engagement-wechat-h5-v1
//
// 患者触达统一入口：平台服务号 + H5 一次性链接 + 短信兜底 + 手动复制。
// 小程序保留作为深度用户入口，但不再是患者主路径。
// 平台一套服务号统一承载，各医院在平台后台多租户管理自己的患者/任务/发送记录。
// ============================================================================

model HospitalTenant {
  id          String   @id @default(uuid())
  name        String
  code        String   @unique
  displayName String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  users     User[]
  patients  Patient[]
  formLinks PatientFormLink[]
  messages  PatientOutboundMessage[]
}

model PatientWechatIdentity {
  id         String   @id @default(uuid())
  patientId  String
  appId      String
  openId     String
  unionId    String?
  source     String   // OFFICIAL_ACCOUNT_H5 / MINI_PROGRAM / MANUAL_BIND
  isVerified Boolean  @default(false)
  verifiedAt DateTime?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  patient    Patient  @relation(fields: [patientId], references: [id], onDelete: Cascade)

  @@unique([appId, openId])
  @@index([patientId])
  @@index([unionId])
}

model PatientFormLink {
  id                         String    @id @default(uuid())
  hospitalTenantId           String?
  patientId                  String
  taskId                     String?
  riskAlertId                String?
  type                       String
  // QUESTIONNAIRE / VITAL_RECHECK / MEDICATION_CHECKIN / HOSPITAL_VISIT_CONFIRM
  // / CONSENT_ONLY / GENERIC_NOTICE
  tokenHash                  String    @unique
  shortCode                  String?   @unique
  title                      String
  description                String?
  payload                    Json?
  expiresAt                  DateTime
  usedAt                     DateTime?
  revokedAt                  DateTime?
  revokeReason               String?
  maxSubmit                  Int       @default(1)
  submitCount                Int       @default(0)
  status                     String    @default("ACTIVE")
  // ACTIVE / USED / EXPIRED / REVOKED
  requiresIdentityCheck      Boolean   @default(false)
  identityCheckFailureCount  Int       @default(0)
  identityLockedUntil        DateTime?
  createdBy                  String?
  createdAt                  DateTime  @default(now())
  updatedAt                  DateTime  @updatedAt

  patient        Patient                  @relation(fields: [patientId], references: [id], onDelete: Cascade)
  hospitalTenant HospitalTenant?          @relation(fields: [hospitalTenantId], references: [id])
  messages       PatientOutboundMessage[]

  @@index([hospitalTenantId])
  @@index([patientId, type, status])
  @@index([taskId])
  @@index([riskAlertId])
  @@index([expiresAt])
}

model PatientOutboundMessage {
  id                String    @id @default(uuid())
  hospitalTenantId  String?
  patientId         String
  formLinkId        String?
  channel           String
  // WECHAT_OFFICIAL_ACCOUNT / SMS / MANUAL_COPY
  messageType       String
  // QUESTIONNAIRE_REMINDER / VITAL_RECHECK_REMINDER / MEDICATION_REMINDER / HOSPITAL_VISIT_REMINDER
  recipientMasked   String?
  recipientRawHash  String?
  templateId        String?
  title             String
  content           String
  linkUrl           String?
  status            String    @default("PENDING")
  // PENDING / SENT / FAILED / CLICKED / SUBMITTED / CANCELED
  providerMessageId String?
  errorMessage      String?
  sentAt            DateTime?
  clickedAt         DateTime?
  submittedAt       DateTime?
  createdBy         String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  patient        Patient          @relation(fields: [patientId], references: [id], onDelete: Cascade)
  formLink       PatientFormLink? @relation(fields: [formLinkId], references: [id])
  hospitalTenant HospitalTenant?  @relation(fields: [hospitalTenantId], references: [id])

  @@index([hospitalTenantId])
  @@index([patientId, channel, status])
  @@index([formLinkId])
  @@index([messageType, createdAt])
}

model EngagementEventLog {
  id         String   @id @default(uuid())
  patientId  String?
  formLinkId String?
  eventType  String
  // LINK_CREATED / MESSAGE_SENT / MESSAGE_FAILED / LINK_OPENED /
  // IDENTITY_CHECK_PASSED / IDENTITY_CHECK_FAILED / FORM_SUBMITTED /
  // TOKEN_EXPIRED / TOKEN_REUSED / TOKEN_REVOKED
  ipAddress  String?
  userAgent  String?
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([patientId, createdAt])
  @@index([formLinkId, createdAt])
  @@index([eventType, createdAt])
}
"""


def patch_block(src: str, model_name: str, marker_field: str, new_fields: str, new_index: str | None) -> str:
    """
    Insert `new_fields` into the first `model <model_name> { ... }` block,
    placed right before the closing `}`. Only inserts if marker_field
    (e.g. "hospitalTenantId") is not already present in that block.
    """
    pattern = re.compile(r"model\s+" + re.escape(model_name) + r"\s*\{")
    m = pattern.search(src)
    if not m:
        raise RuntimeError(f"model {model_name} not found in schema.prisma")

    # Walk braces from the opening brace to find the closing brace.
    start = m.end()  # position just after the opening '{'
    depth = 1
    i = start
    while i < len(src) and depth > 0:
        ch = src[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    if depth != 0:
        raise RuntimeError(f"unbalanced braces in model {model_name}")
    end = i  # position of the closing '}'

    block = src[start:end]
    if marker_field in block:
        return src  # already patched

    # Find last @@index line in the block to position our index entry sensibly;
    # otherwise just append before closing brace.
    insertion = "\n" + new_fields
    if new_index:
        # Append the @@index just before the closing brace, after a blank line.
        insertion = "\n" + new_fields + "\n" + new_index + "\n"

    return src[:end] + insertion + src[end:]


def ensure_models_block(src: str) -> str:
    if "model HospitalTenant " in src or "model HospitalTenant\n" in src:
        return src
    # Append to end of file with a leading blank line.
    if not src.endswith("\n"):
        src += "\n"
    return src + MODELS_BLOCK


def main() -> int:
    if not SCHEMA.exists():
        print(f"[err] {SCHEMA} not found. Run from repo root.", file=sys.stderr)
        return 1

    src = SCHEMA.read_text(encoding="utf-8")
    original = src

    src = patch_block(src, "Patient", "hospitalTenantId", PATIENT_FIELDS, PATIENT_INDEX)
    src = patch_block(src, "User",    "hospitalTenantId", USER_FIELDS,    USER_INDEX)
    src = ensure_models_block(src)

    if src == original:
        print("[skip] schema.prisma already patched.")
        return 0

    SCHEMA.write_text(src, encoding="utf-8")
    print("[ok] schema.prisma patched (patient-engagement-wechat-h5-v1).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
