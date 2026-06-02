#!/usr/bin/env python3
"""
apply_care_reminders_v3_3_1_write_protection.py
-----------------------------------------------
Care Reminders v3.3.1 — close the remaining backend write paths that could still
mutate a plan-bound reminder, and require a VitalMonitoringPlan for VITAL
reminders. Also heal legacy schedules whose sourceId was never set (which is why
the BP reminder still showed once-a-day even after v3.3).

Idempotent: installs known-good full-file versions of
  - apps/api/src/care-reminders/care-reminder-schedule.service.ts
      * update() now hard-blocks sourceType MEDICATION/VITAL with 400
        "绑定用药/指标计划的提醒不能在此直接修改，请到对应计划板块修改。"
        — pause()/resume() route through update(), so they are blocked too.
      * syncAllSchedulesForPatient() now backfills missing sourceId
        (payload.vitalPlanId/medicationId, else patientId + vitalType/medicationName)
        before reconciling, so legacy rows self-heal on read.
      * new backfillSourceIds(patientId) helper.
  - apps/api/src/care-reminders/care-reminders.controller.ts
      * POST /vital-schedules now REQUIRES vitalMonitoringPlanId (400 otherwise),
        verifies the plan belongs to the patient, and derives
        vitalType/scheduledTimes/timesPerUnit/frequencyUnit from the PLAN
        (body scheduledTimes is ignored).
  - apps/api/prisma/reconcile-care-reminder-schedules.js
      * backfills missing sourceId before reconcile/dedupe.
  - apps/api/prisma/seed-all.js
      * demo BP schedule now bound to demo-vital-plan-001-bp and twice-a-day
        07:30/19:30 (was a sourceId-less once-a-day 20:00 row — the root cause of
        the mismatch); the demo "glucose" schedule for patient-003 (who has no
        glucose plan) is re-pointed to that patient's real SPO2 plan.
  - apps/api/scripts/smoke-care-reminders.js
      * adds checks 3f/3g/3h (PATCH/pause/resume of a plan-bound schedule -> 400)
        and 3i (creating a VITAL schedule without a plan -> 400).

Run from repo ROOT:
  python3 scripts/apply_care_reminders_v3_3_1_write_protection.py
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path.cwd()
SRC = Path(__file__).resolve().parent.parent / "files"

FILES = [
    "apps/api/src/care-reminders/care-reminder-schedule.service.ts",
    "apps/api/src/care-reminders/care-reminders.controller.ts",
    "apps/api/prisma/reconcile-care-reminder-schedules.js",
    "apps/api/prisma/seed-all.js",
    "apps/api/scripts/smoke-care-reminders.js",
]


def main() -> None:
    if not SRC.exists():
        print(f"[err] payload dir not found: {SRC} (unzip the patch first)", file=sys.stderr)
        sys.exit(1)
    for rel in FILES:
        src = SRC / rel
        dst = ROOT / rel
        if not src.exists():
            print(f"[err] missing payload file: {src}", file=sys.stderr)
            sys.exit(1)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        print(f"[ok] {rel}")
    print("\n[done] v3.3.1 backend write-protection installed.")
    print("Next:")
    print("  cd apps/api")
    print("  npx prisma generate")
    print("  node prisma/reconcile-care-reminder-schedules.js --dry-run")
    print("  node prisma/reconcile-care-reminder-schedules.js   # heals legacy sourceId + reconciles")
    print("  npm run smoke:care-reminders")


if __name__ == "__main__":
    main()
