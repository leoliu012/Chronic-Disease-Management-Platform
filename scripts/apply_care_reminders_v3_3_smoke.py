#!/usr/bin/env python3
"""
apply_care_reminders_v3_3_smoke.py
----------------------------------
Care Reminders v3.3 — smoke: add source-bound sync checks and frontend guards.

Idempotent: installs the known-good full-file version of
  - apps/api/scripts/smoke-care-reminders.js

New checks:
  3b. demo BP VitalMonitoringPlan is twice-a-day 07:30/19:30
  3c. the reconciled VITAL schedule mirrors the plan (timesPerUnit=2, 07:30/19:30)
  3d. sourceSummary shows localized 血压（收缩压/舒张压） + the plan times
  3e. cancelling a plan-bound schedule is rejected (400)
  18. CareRemindersPanel.tsx contains no add/cancel UI
      (新增提醒计划 / AddScheduleForm / cancelSchedule( / 取消计划)
  18b. CareRemindersPanel.tsx no longer renders TodaySection

Run from repo ROOT:
  python3 scripts/apply_care_reminders_v3_3_smoke.py
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path.cwd()
SRC = Path(__file__).resolve().parent.parent / "files"

FILES = [
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
    print("\n[done] v3.3 smoke installed. Run: cd apps/api && npm run smoke:care-reminders")


if __name__ == "__main__":
    main()
