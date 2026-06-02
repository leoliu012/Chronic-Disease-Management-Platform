#!/usr/bin/env python3
"""
apply_care_reminders_v3_3_source_bound_frontend.py
--------------------------------------------------
Care Reminders v3.3 — frontend: turn the care-reminders panel into a read-only
bound view, remove the today section, and unify buttons to the pe-admin system.

Idempotent: installs known-good full-file versions of
  - apps/web/src/components/CareRemindersPanel.tsx
      (read-only long-term plan view: 类型/绑定来源/来源名称(EntityName 彩色标签)/
       频率/提醒时间/状态/查看修改; NO 新增提醒计划, NO 取消计划, NO TodaySection;
       localized vital names; kept MissedSection / 主动消息 / 历史触达)
  - apps/web/src/pages/CareRemindersPage.tsx        (unified pe-admin buttons)
  - apps/web/src/components/PatientEngagementTab.tsx (unified pe-admin buttons)
  - apps/web/src/api/care-reminders.ts              (sourceSummary timing fields)
  - apps/web/src/patient-engagement-admin-tab.css   (unified button system + v3.3 classes)

Run from repo ROOT:
  python3 scripts/apply_care_reminders_v3_3_source_bound_frontend.py
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path.cwd()
SRC = Path(__file__).resolve().parent.parent / "files"

FILES = [
    "apps/web/src/components/CareRemindersPanel.tsx",
    "apps/web/src/pages/CareRemindersPage.tsx",
    "apps/web/src/components/PatientEngagementTab.tsx",
    "apps/web/src/api/care-reminders.ts",
    "apps/web/src/patient-engagement-admin-tab.css",
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
    print("\n[done] v3.3 frontend installed. Rebuild with: cd apps/web && npm run build")


if __name__ == "__main__":
    main()
