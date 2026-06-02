#!/usr/bin/env python3
"""
apply_care_reminders_v3_3_source_bound_backend.py
-------------------------------------------------
Care Reminders v3.3 — backend: make the schedule a derived layer that syncs
from MedicationRecord / VitalMonitoringPlan, block deletion of plan-bound
schedules, and reconcile on read.

Idempotent: installs known-good full-file versions of
  - apps/api/src/care-reminders/care-reminder-schedule.service.ts
      (+ syncScheduleFromMedicationRecord / syncScheduleFromVitalMonitoringPlan /
         syncAllSchedulesForPatient; listForPatient reconciles before returning;
         cancelSchedule hard-blocks MEDICATION/VITAL; buildSourceSummary now
         carries scheduledTimes/timesPerUnit/frequencyUnit and localizes vitals)
  - apps/api/src/care-reminders/care-reminders.controller.ts
      (medication/vital create endpoints reconcile to the source plan after write)
  - apps/api/prisma/reconcile-care-reminder-schedules.js  (data cleanup script)

Run from repo ROOT:
  python3 scripts/apply_care_reminders_v3_3_source_bound_backend.py
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
    print("\n[done] v3.3 backend installed.")
    print("Next: npx prisma generate (the service/controller use existing models,")
    print("      but regenerate to be safe), then run the reconcile script.")


if __name__ == "__main__":
    main()
