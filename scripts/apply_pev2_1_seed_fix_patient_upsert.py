#!/usr/bin/env python3
"""
apply_pev2_1_seed_fix_patient_upsert.py
----------------------------------------
Hotfix for v2.1 seed: the second-tenant patient.upsert injected by
apply_pev2_1_seed_second_tenant.py used the *scalar* hospitalTenantId, which
Prisma's Patient checked-create-input rejects:

  PrismaClientValidationError: Unknown argument `hospitalTenantId`.
  Did you mean `hospitalTenant`?

Patient has many optional relations, so Prisma generates the strict checked
input variant for create-inside-upsert, which requires the nested relation
form. (HospitalWechatOfficialAccount.upsert escapes this because its relation
list is short.)

This patcher rewrites the broken block in-place. Idempotent.
"""
from __future__ import annotations
import sys
from pathlib import Path

SEED = Path("apps/api/prisma/seed-all.js")

BROKEN = """  await prisma.patient.upsert({
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
  });"""

FIXED = """  await prisma.patient.upsert({
    where: { id: 'demo-patient-101' },
    update: {
      hospitalTenant: { connect: { id: tenant2.id } },
      name: '示例患者 · 三甲',
      phone: '13700001011',
    },
    create: {
      id: 'demo-patient-101',
      hospitalPatientId: 'CLINIC2-001',
      hospitalTenant: { connect: { id: tenant2.id } },
      name: '示例患者 · 三甲',
      gender: 'MALE',
      birthDate: new Date('1965-03-20'),
      phone: '13700001011',
      chronicDiseases: ['HYPERTENSION'],
    },
  });"""


def main() -> int:
    if not SEED.exists():
        print(f"[err] {SEED} not found", file=sys.stderr)
        return 1
    src = SEED.read_text(encoding="utf-8")

    if FIXED in src:
        print("[skip] seed-all.js already uses nested-relation form for patient.upsert.")
        return 0
    if BROKEN not in src:
        print("[warn] couldn't locate the v2.1 broken patient.upsert block verbatim. "
              "Either it's been edited, or v2.1 wasn't applied. Nothing to do.")
        return 0

    src = src.replace(BROKEN, FIXED, 1)
    SEED.write_text(src, encoding="utf-8")
    print("[ok] seed-all.js patched: patient.upsert now uses hospitalTenant: { connect: ... }")
    return 0


if __name__ == "__main__":
    sys.exit(main())
