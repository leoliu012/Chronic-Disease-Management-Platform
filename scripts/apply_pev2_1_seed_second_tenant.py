#!/usr/bin/env python3
"""
apply_pev2_1_seed_second_tenant.py
-----------------------------------
Add a second hospital tenant + a nurse user bound to it + a patient under it.
This is what lets smoke actually exercise cross-tenant isolation (Problem 6).

Inserts:
  - HospitalTenant 'demo-tenant-002' (code='demo-clinic-2')
  - User 'nurse-002' (username='nurse2', password='nurse123', role=NURSE, hospitalTenantId=demo-tenant-002)
  - HospitalWechatOfficialAccount for demo-tenant-002 (parallel demo config)
  - Patient 'demo-patient-101' (hospitalTenantId=demo-tenant-002)

Patches apps/api/prisma/seed-all.js. Idempotent.
"""
from __future__ import annotations
import sys
from pathlib import Path

SEED = Path("apps/api/prisma/seed-all.js")

# --------------------------------------------------------------------------
# 1) Add nurse-002 to authDemoUsers array
# --------------------------------------------------------------------------

V1_USERS_END = """  {
    id: 'manager-001',
    username: 'manager',
    password: 'manager123',
    displayName: '慢病中心主任',
    role: UserRole.MANAGER,
  },
];"""

V21_USERS_END = """  {
    id: 'manager-001',
    username: 'manager',
    password: 'manager123',
    displayName: '慢病中心主任',
    role: UserRole.MANAGER,
  },
  // patient_engagement_hospital_wechat_v2_1: second-tenant nurse for cross-tenant smoke
  {
    id: 'nurse-002',
    username: 'nurse2',
    password: 'nurse123',
    displayName: '王护士 (示例三甲)',
    role: UserRole.NURSE,
  },
];"""

# --------------------------------------------------------------------------
# 2) After seedAuth, bind nurse-002 to demo-tenant-002. We do this in
#    seedPatientEngagement so it runs after the tenant is created.
#
#    Inject block: right before the wechatIdentities loop (anchor on the
#    comment "patient_engagement_hospital_wechat_v2: openId 归属到具体医院.")
# --------------------------------------------------------------------------

INJECT_ANCHOR = "  for (const ident of wechatIdentities) {\n    // patient_engagement_hospital_wechat_v2: openId 归属到具体医院."

INJECT_BLOCK = """  // patient_engagement_hospital_wechat_v2_1: second tenant + bindings
  const tenant2 = await prisma.hospitalTenant.upsert({
    where: { code: 'demo-clinic-2' },
    update: { name: '示例三甲医院 · 慢病随访', displayName: '示例三甲医院 · 慢病随访', isActive: true },
    create: {
      id: 'demo-tenant-002',
      code: 'demo-clinic-2',
      name: '示例三甲医院 · 慢病随访',
      displayName: '示例三甲医院 · 慢病随访',
      isActive: true,
    },
  });
  await prisma.user.update({
    where: { username: 'nurse2' },
    data: { hospitalTenantId: tenant2.id },
  });
  await prisma.hospitalWechatOfficialAccount.upsert({
    where: { hospitalTenantId: tenant2.id },
    update: {
      accountName: '示例三甲医院 · 健康随访',
      appId: 'wx_demo_hospital_002',
      isEnabled: true,
      isVerified: true,
      templateQuestionnaireId: 'tmpl_demo_questionnaire_2',
      templateVitalId: 'tmpl_demo_vital_2',
      templateMedicationId: 'tmpl_demo_medication_2',
      templateHospitalVisitId: 'tmpl_demo_hospital_visit_2',
    },
    create: {
      hospitalTenantId: tenant2.id,
      accountName: '示例三甲医院 · 健康随访',
      originalId: 'gh_demo_hospital_002',
      appId: 'wx_demo_hospital_002',
      appSecretEncrypted: 'v1.AAAA.AAAA.AAAA',
      h5BaseUrl: process.env.PATIENT_ENGAGEMENT_BASE_URL || 'http://localhost:5173',
      oauthCallbackDomain: 'localhost:3000',
      templateQuestionnaireId: 'tmpl_demo_questionnaire_2',
      templateVitalId: 'tmpl_demo_vital_2',
      templateMedicationId: 'tmpl_demo_medication_2',
      templateHospitalVisitId: 'tmpl_demo_hospital_visit_2',
      isEnabled: true,
      isVerified: true,
    },
  });
  await prisma.patient.upsert({
    where: { id: 'demo-patient-101' },
    update: { hospitalTenantId: tenant2.id, name: '示例患者 · 三甲', phone: '13700001011' },
    create: {
      id: 'demo-patient-101',
      hospitalPatientId: 'CLINIC2-001',
      hospitalTenantId: tenant2.id,
      name: '示例患者 · 三甲',
      gender: 'MALE',
      birthDate: new Date('1965-03-20'),
      phone: '13700001011',
      chronicDiseases: ['HYPERTENSION'],
    },
  });

"""


def main() -> int:
    if not SEED.exists():
        print(f"[err] {SEED} not found", file=sys.stderr)
        return 1

    src = SEED.read_text(encoding="utf-8")
    original = src
    notes = []

    # 1) nurse-002 in users array
    if "id: 'nurse-002'" in src:
        pass
    elif V1_USERS_END in src:
        src = src.replace(V1_USERS_END, V21_USERS_END, 1)
        notes.append("added nurse-002 to authDemoUsers")
    else:
        print("[warn] could not find users-array anchor; nurse-002 NOT added.")

    # 2) second-tenant injection
    if "patient_engagement_hospital_wechat_v2_1: second tenant" in src:
        pass
    elif INJECT_ANCHOR in src:
        src = src.replace(INJECT_ANCHOR, INJECT_BLOCK + INJECT_ANCHOR, 1)
        notes.append("injected second-tenant + nurse-002 + demo-patient-101 seed block")
    else:
        print("[warn] could not find v2 wechatIdentities anchor; "
              "second tenant block NOT injected.")

    if src == original:
        print("[skip] seed-all.js already has v2.1 second tenant.")
        return 0

    SEED.write_text(src, encoding="utf-8")
    print("[ok] seed-all.js patched:")
    for n in notes:
        print(f"     - {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
