#!/usr/bin/env python3
"""
apply_patient_engagement_hospital_wechat_schema.py
---------------------------------------------------
Idempotent patcher for apps/api/prisma/schema.prisma. Upgrades the
patient-engagement model surface from v1 (one platform service account) to v2
(per-hospital service account).

Changes:
  1. Add `hospitalTenantId String` (required) to PatientWechatIdentity
     + relation to HospitalTenant
     + change unique from (appId,openId) to (hospitalTenantId,appId,openId)
     + add @@index([hospitalTenantId])
  2. Add `wechatIdentities  PatientWechatIdentity[]` back-relation on HospitalTenant
  3. Add `wechatOfficialAccount HospitalWechatOfficialAccount?` relation on HospitalTenant
  4. Add new model HospitalWechatOfficialAccount

Re-runs print [skip] for any block already at v2.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

SCHEMA = Path("apps/api/prisma/schema.prisma")

# -----------------------------------------------------------------------------
# 1) PatientWechatIdentity — change unique, add hospitalTenantId + relation
# -----------------------------------------------------------------------------

V1_IDENTITY = """model PatientWechatIdentity {
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
}"""

V2_IDENTITY = """model PatientWechatIdentity {
  id               String   @id @default(uuid())
  // patient_engagement_hospital_wechat_v2: 必填 — openId 必须归属到一家医院.
  hospitalTenantId String
  patientId        String
  appId            String
  openId           String
  unionId          String?
  source           String   // OFFICIAL_ACCOUNT_H5 / MINI_PROGRAM / MANUAL_BIND
  isVerified       Boolean  @default(false)
  verifiedAt       DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  patient        Patient        @relation(fields: [patientId], references: [id], onDelete: Cascade)
  hospitalTenant HospitalTenant @relation(fields: [hospitalTenantId], references: [id], onDelete: Cascade)

  @@unique([hospitalTenantId, appId, openId])
  @@index([patientId])
  @@index([hospitalTenantId])
  @@index([unionId])
}"""

# -----------------------------------------------------------------------------
# 2 + 3) HospitalTenant — add the two new relations
# -----------------------------------------------------------------------------

V1_TENANT = """model HospitalTenant {
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
}"""

V2_TENANT = """model HospitalTenant {
  id          String   @id @default(uuid())
  name        String
  code        String   @unique
  displayName String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  users           User[]
  patients        Patient[]
  formLinks       PatientFormLink[]
  messages        PatientOutboundMessage[]
  // patient_engagement_hospital_wechat_v2
  wechatIdentities      PatientWechatIdentity[]
  wechatOfficialAccount HospitalWechatOfficialAccount?
}"""

# -----------------------------------------------------------------------------
# 4) HospitalWechatOfficialAccount — appended to end of file
# -----------------------------------------------------------------------------

NEW_MODEL = """

// ============================================================================
// patient_engagement_hospital_wechat_v2
//
// 每家医院独立微信服务号 (一家医院 = 一行).
// appSecret / accessToken 都加密存储 (AES-256-GCM, key 来自 PATIENT_ENGAGEMENT_SECRET_KEY).
// 模板消息 ID 在医院维度配置, 不再从 .env 读取.
// ============================================================================

model HospitalWechatOfficialAccount {
  id                       String   @id @default(uuid())
  hospitalTenantId         String   @unique
  accountName              String?
  originalId               String?
  appId                    String
  appSecretEncrypted       String
  qrCodeUrl                String?
  h5BaseUrl                String?
  oauthCallbackDomain      String?
  templateQuestionnaireId  String?
  templateVitalId          String?
  templateMedicationId     String?
  templateHospitalVisitId  String?
  isEnabled                Boolean   @default(false)
  isVerified               Boolean   @default(false)
  accessTokenEncrypted     String?
  accessTokenExpiresAt     DateTime?
  lastTokenRefreshAt       DateTime?
  createdAt                DateTime  @default(now())
  updatedAt                DateTime  @updatedAt

  hospitalTenant HospitalTenant @relation(fields: [hospitalTenantId], references: [id], onDelete: Cascade)

  @@index([appId])
}
"""


def main() -> int:
    if not SCHEMA.exists():
        print(f"[err] {SCHEMA} not found. Run from repo root.", file=sys.stderr)
        return 1

    src = SCHEMA.read_text(encoding="utf-8")
    original = src
    changes = []

    # 1) PatientWechatIdentity
    if "model PatientWechatIdentity" in src:
        if V2_IDENTITY in src:
            pass  # already at v2
        elif V1_IDENTITY in src:
            src = src.replace(V1_IDENTITY, V2_IDENTITY, 1)
            changes.append("PatientWechatIdentity → v2")
        elif "hospitalTenantId" in _model_body(src, "PatientWechatIdentity"):
            # Some out-of-band edit; leave alone but warn.
            print("[warn] PatientWechatIdentity has a custom hospitalTenantId; not rewriting.")
        else:
            print("[warn] PatientWechatIdentity body not recognized verbatim; skipping (please review).")
    else:
        print("[err] PatientWechatIdentity model missing — apply v1 patch first.", file=sys.stderr)
        return 1

    # 2+3) HospitalTenant
    if "model HospitalTenant" in src:
        if "wechatOfficialAccount HospitalWechatOfficialAccount" in src:
            pass  # already patched
        elif V1_TENANT in src:
            src = src.replace(V1_TENANT, V2_TENANT, 1)
            changes.append("HospitalTenant → v2")
        else:
            # Try a softer in-place edit: add the two lines just before the closing brace.
            new = _inject_into_model(
                src,
                "HospitalTenant",
                "  // patient_engagement_hospital_wechat_v2\n"
                "  wechatIdentities      PatientWechatIdentity[]\n"
                "  wechatOfficialAccount HospitalWechatOfficialAccount?\n",
                guard_substring="wechatOfficialAccount",
            )
            if new != src:
                src = new
                changes.append("HospitalTenant (in-place inject)")
            else:
                print("[skip] HospitalTenant already has wechatOfficialAccount relation.")
    else:
        print("[err] HospitalTenant model missing — apply v1 patch first.", file=sys.stderr)
        return 1

    # 4) HospitalWechatOfficialAccount
    if "model HospitalWechatOfficialAccount" not in src:
        if not src.endswith("\n"):
            src += "\n"
        src += NEW_MODEL
        changes.append("HospitalWechatOfficialAccount (appended)")

    if src == original:
        print("[skip] schema.prisma already at v2.")
        return 0

    SCHEMA.write_text(src, encoding="utf-8")
    print("[ok] schema.prisma patched (patient_engagement_hospital_wechat_v2):")
    for c in changes:
        print(f"     - {c}")
    return 0


# -----------------------------------------------------------------------------
# helpers
# -----------------------------------------------------------------------------

def _model_body(src: str, name: str) -> str:
    """Return the body (between {}) of `model <name> { ... }` or '' if missing."""
    m = re.search(r"model\s+" + re.escape(name) + r"\s*\{", src)
    if not m:
        return ""
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
                return src[start:i]
        i += 1
    return ""


def _inject_into_model(src: str, name: str, lines: str, guard_substring: str) -> str:
    """Insert `lines` just before the closing brace of `model <name> { ... }`,
    only if `guard_substring` isn't already in the model body."""
    m = re.search(r"model\s+" + re.escape(name) + r"\s*\{", src)
    if not m:
        return src
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
                break
        i += 1
    if depth != 0:
        return src
    body = src[start:i]
    if guard_substring in body:
        return src
    return src[:i] + lines + src[i:]


if __name__ == "__main__":
    sys.exit(main())
