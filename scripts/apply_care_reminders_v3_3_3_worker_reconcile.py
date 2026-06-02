#!/usr/bin/env python3
"""
apply_care_reminders_v3_3_3_worker_reconcile.py
-----------------------------------------------
Care Reminders v3.3.3:
  1. The worker reconciles source-bound schedules to their MedicationRecord /
     VitalMonitoringPlan BEFORE generating occurrences, and prunes future,
     not-yet-sent occurrences when a reminder's times changed (so reminders
     fire at the plan's current times even if nobody opened the page).
  2. The global cross-patient "慢病提醒中心" page (CareRemindersPage) drops the
     "今日提醒" board.
  3. Dead frontend API helpers are removed (create/pause/resume/cancel schedule,
     the add-form option lists, and the now-unused listTodayOccurrences).

Idempotent: installs known-good full-file versions of
  - apps/api/src/care-reminders/care-reminder-worker.service.ts
      passGenerate() reconciles every source-bound patient (try/catch per patient,
      never aborts the pass), then re-queries fresh isActive schedules to generate.
  - apps/api/src/care-reminders/care-reminder-schedule.service.ts
      sync*FromMedicationRecord / sync*FromVitalMonitoringPlan now call
      pruneFuturePendingIfTimesChanged() before updating a schedule whose times
      changed (deletes only PENDING occurrences with dueAt > now).
  - apps/web/src/pages/CareRemindersPage.tsx
      removes 今日提醒 section + listTodayOccurrences; outstanding/escalated list
      keeps send/resend actions; buttons are pe-admin.
  - apps/web/src/api/care-reminders.ts
      removes createMedicationSchedule / createVitalSchedule / pauseSchedule /
      resumeSchedule / cancelSchedule / listPatientMedications /
      listPatientVitalPlans / MedicationOption / VitalPlanOption /
      listTodayOccurrences (all unused).
  - apps/api/scripts/smoke-care-reminders.js
      adds 5b (worker keeps BP schedule aligned to plan) and 18c (global page
      has no 今日提醒).

Run from repo ROOT:
  python3 scripts/apply_care_reminders_v3_3_3_worker_reconcile.py
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path.cwd()
SRC = Path(__file__).resolve().parent.parent / "files"

FILES = [
    "apps/api/src/care-reminders/care-reminder-worker.service.ts",
    "apps/api/src/care-reminders/care-reminder-schedule.service.ts",
    "apps/web/src/pages/CareRemindersPage.tsx",
    "apps/web/src/api/care-reminders.ts",
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
    print("\n[done] v3.3.3 installed.")
    print("Restart the API so the worker change takes effect:")
    print("  cd apps/api && npm run start:dev")
    print("Then (optional) verify:")
    print("  npm run smoke:care-reminders   # needs the API running")
    print("  cd ../web && npm run build")


if __name__ == "__main__":
    main()
