#!/usr/bin/env python3
"""
apply_patient_engagement_hospital_wechat_seed.py
-------------------------------------------------
Idempotent patcher for apps/api/prisma/seed-all.js.

Changes to seedPatientEngagement():
  1. After the demo HospitalTenant upsert, also upsert a HospitalWechatOfficialAccount
     for it (appId='wx_demo_hospital_001', encrypted dev secret, isEnabled/isVerified=true,
     4 dev template IDs).
  2. Switch the wechat identity upsert from
        where: { appId_openId: { appId: 'demo-platform-mp', ... } }
     to
        where: { hospitalTenantId_appId_openId: { hospitalTenantId: 'demo-tenant-001', appId: 'wx_demo_hospital_001', ... } }
     and update both create + update payloads to include hospitalTenantId + new appId.
  3. Replace "平台服务号" wording with "本院服务号".

The patcher only edits if it can find the exact v1 anchors; otherwise it prints
[skip].
"""
from __future__ import annotations

import sys
from pathlib import Path

SEED = Path("apps/api/prisma/seed-all.js")


# ---------------------------------------------------------------------------
# 1) demo HospitalWechatOfficialAccount upsert
# ---------------------------------------------------------------------------
# We anchor right after the existing tenant upsert + backfill block. We look
# for the line `  });` that closes the `prisma.patient.updateMany({...})` call,
# then insert.

INJECT_AFTER_ANCHOR = "  await prisma.patient.updateMany({\n    where: { hospitalTenantId: null },\n    data: { hospitalTenantId: tenant.id },\n  });"

INJECT_BLOCK = """

  // patient_engagement_hospital_wechat_v2:
  //   per-hospital WeChat 服务号. dev 用 mock 配置 + dev-encrypted secret.
  //   secret-crypto.util 使用相同的 PATIENT_ENGAGEMENT_SECRET_KEY 派生密钥.
  //   这里手写一份 envelope (v1.<iv>.<ct>.<tag>) 太脆弱 — 改在 patient-engagement
  //   service 启动时再加密一次也行; 但 seed 想 idempotent 不依赖运行时, 所以
  //   存一段 base64 marker "dev-encrypted-secret" 占位, 让 decryptSecret 安全失败
  //   回退到"请重新设置". 真实开发只要在 UI 上重新填写 appSecret 即可.
  await prisma.hospitalWechatOfficialAccount.upsert({
    where: { hospitalTenantId: tenant.id },
    update: {
      accountName: '某某市人民医院 · 健康随访',
      appId: 'wx_demo_hospital_001',
      isEnabled: true,
      isVerified: true,
      templateQuestionnaireId: 'tmpl_demo_questionnaire',
      templateVitalId: 'tmpl_demo_vital',
      templateMedicationId: 'tmpl_demo_medication',
      templateHospitalVisitId: 'tmpl_demo_hospital_visit',
    },
    create: {
      hospitalTenantId: tenant.id,
      accountName: '某某市人民医院 · 健康随访',
      originalId: 'gh_demo_hospital_001',
      appId: 'wx_demo_hospital_001',
      // Placeholder ciphertext — decryptSecret will gracefully return null;
      // hospital admin should re-enter the appSecret in the UI on first use.
      appSecretEncrypted: 'v1.AAAA.AAAA.AAAA',
      qrCodeUrl: null,
      h5BaseUrl: process.env.PATIENT_ENGAGEMENT_BASE_URL || 'http://localhost:5173',
      oauthCallbackDomain: 'localhost:3000',
      templateQuestionnaireId: 'tmpl_demo_questionnaire',
      templateVitalId: 'tmpl_demo_vital',
      templateMedicationId: 'tmpl_demo_medication',
      templateHospitalVisitId: 'tmpl_demo_hospital_visit',
      isEnabled: true,
      isVerified: true,
    },
  });
"""


# ---------------------------------------------------------------------------
# 2) wechat identity upsert — switch to per-tenant
# ---------------------------------------------------------------------------

V1_IDENTITY_UPSERT = """  for (const ident of wechatIdentities) {
    await prisma.patientWechatIdentity.upsert({
      where: { appId_openId: { appId: 'demo-platform-mp', openId: ident.openId } },
      update: { patientId: ident.patientId, isVerified: true, verifiedAt: new Date(), source: 'OFFICIAL_ACCOUNT_H5' },
      create: {
        patientId: ident.patientId,
        appId: 'demo-platform-mp',
        openId: ident.openId,
        source: 'OFFICIAL_ACCOUNT_H5',
        isVerified: true,
        verifiedAt: new Date(),
      },
    });
  }"""

V2_IDENTITY_UPSERT = """  for (const ident of wechatIdentities) {
    // patient_engagement_hospital_wechat_v2: openId 归属到具体医院.
    await prisma.patientWechatIdentity.upsert({
      where: {
        hospitalTenantId_appId_openId: {
          hospitalTenantId: 'demo-tenant-001',
          appId: 'wx_demo_hospital_001',
          openId: ident.openId,
        },
      },
      update: {
        patientId: ident.patientId,
        hospitalTenantId: 'demo-tenant-001',
        isVerified: true,
        verifiedAt: new Date(),
        source: 'OFFICIAL_ACCOUNT_H5',
      },
      create: {
        patientId: ident.patientId,
        hospitalTenantId: 'demo-tenant-001',
        appId: 'wx_demo_hospital_001',
        openId: ident.openId,
        source: 'OFFICIAL_ACCOUNT_H5',
        isVerified: true,
        verifiedAt: new Date(),
      },
    });
  }"""


# ---------------------------------------------------------------------------
# 3) "平台服务号" → "本院服务号"
# ---------------------------------------------------------------------------


def main() -> int:
    if not SEED.exists():
        print(f"[err] {SEED} not found", file=sys.stderr)
        return 1

    src = SEED.read_text(encoding="utf-8")
    original = src
    changes = []

    # 1) hospitalWechatOfficialAccount upsert
    if "prisma.hospitalWechatOfficialAccount.upsert" in src:
        pass  # already injected
    elif INJECT_AFTER_ANCHOR in src:
        src = src.replace(INJECT_AFTER_ANCHOR, INJECT_AFTER_ANCHOR + INJECT_BLOCK, 1)
        changes.append("injected demo HospitalWechatOfficialAccount upsert")
    else:
        print("[warn] could not find the v1 anchor (patient.updateMany block) — "
              "service-account demo NOT injected. Add it manually.")

    # 2) per-tenant identity upsert
    if "hospitalTenantId_appId_openId" in src and "wx_demo_hospital_001" in src:
        pass  # already at v2
    elif V1_IDENTITY_UPSERT in src:
        src = src.replace(V1_IDENTITY_UPSERT, V2_IDENTITY_UPSERT, 1)
        changes.append("identity upsert → per-tenant (wx_demo_hospital_001)")
    else:
        print("[warn] v1 identity upsert block not found verbatim — leaving as-is.")

    # 3) 平台服务号 → 本院服务号
    if "平台服务号" in src:
        src = src.replace("平台服务号", "本院服务号")
        changes.append("'平台服务号' → '本院服务号' replaced")
    if "平台服务号" in src:
        # shouldn't happen, but log if any remained
        print("[warn] still found '平台服务号' references after replacement; please review.")

    # Also fix the v1 comment block at top of seedPatientEngagement.
    if "服务号已关注" in src and "本院服务号已关注" not in src:
        src = src.replace("服务号已关注", "本院服务号已关注", 1)
        changes.append("comment: '服务号已关注' → '本院服务号已关注'")

    if src == original:
        print("[skip] seed-all.js already at v2.")
        return 0

    SEED.write_text(src, encoding="utf-8")
    print("[ok] seed-all.js patched:")
    for c in changes:
        print(f"     - {c}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
