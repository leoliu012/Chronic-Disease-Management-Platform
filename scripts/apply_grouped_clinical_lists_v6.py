#!/usr/bin/env python3
"""Install grouped-clinical-lists-v6 overlay from the repository root.

This patch is intentionally additive/small:
- one shared React grouping component;
- targeted frontend replacements;
- one existing API response select gains formLink.payload;
- no Prisma schema change and no migration.
"""

from __future__ import annotations

import hashlib
import shutil
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OVERLAY = ROOT / "grouped_clinical_lists_v6_overlay"
BACKUP_ROOT = ROOT / ".patch-backups" / f"grouped-clinical-lists-v6-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

FILES = [
    "apps/api/src/patient-engagement/admin-patient-engagement.controller.ts",
    "apps/web/src/App.tsx",
    "apps/web/src/api/patient-engagement.ts",
    "apps/web/src/components/CareReminderGroupedViews.tsx",
    "apps/web/src/components/CareRemindersPanel.tsx",
    "apps/web/src/components/PatientEngagementTab.tsx",
    "apps/web/src/pages/CareRemindersPage.tsx",
    "apps/web/src/patient-engagement-admin-tab.css",
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    if not OVERLAY.is_dir():
        raise SystemExit(f"[error] overlay not found: {OVERLAY}")

    changed = 0
    skipped = 0

    for rel in FILES:
        source = OVERLAY / rel
        target = ROOT / rel

        if not source.is_file():
            raise SystemExit(f"[error] missing overlay file: {source}")

        if target.is_file() and digest(target) == digest(source):
            print(f"[skip] {rel}")
            skipped += 1
            continue

        if target.is_file():
            backup = BACKUP_ROOT / rel
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, backup)

        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        print(f"[write] {rel}")
        changed += 1

    if changed:
        print(f"\n[ok] installed grouped-clinical-lists-v6: changed={changed}, unchanged={skipped}")
        if BACKUP_ROOT.exists():
            print(f"[backup] {BACKUP_ROOT}")
    else:
        print(f"\n[ok] grouped-clinical-lists-v6 already installed: unchanged={skipped}")


if __name__ == "__main__":
    main()
