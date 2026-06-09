#!/usr/bin/env python3
"""Install trial-stabilization-v8.1 overlay from repository root.

Usage:
  python3 scripts/apply_trial_stabilization_v8_1.py

The installer is idempotent and backs up replaced files under:
  .patch-backups/trial-stabilization-v8-1-YYYYMMDD-HHMMSS/
"""
from __future__ import annotations

import shutil
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path.cwd()
OVERLAY = ROOT / "trial_stabilization_v8_1_overlay"
BACKUP = ROOT / ".patch-backups" / f"trial-stabilization-v8-1-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

if not OVERLAY.is_dir():
    print(f"[err] missing overlay directory: {OVERLAY}", file=sys.stderr)
    print("[hint] run from repository root after extracting the zip with rsync -av \"$TMP/\" ./", file=sys.stderr)
    raise SystemExit(1)

changed = 0
skipped = 0

for source in sorted(path for path in OVERLAY.rglob("*") if path.is_file()):
    relative = source.relative_to(OVERLAY)
    target = ROOT / relative
    source_bytes = source.read_bytes()
    if target.exists() and target.read_bytes() == source_bytes:
        print(f"[skip] {relative}")
        skipped += 1
        continue

    if target.exists():
        backup_target = BACKUP / relative
        backup_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target, backup_target)

    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    print(f"[ok] installed {relative}")
    changed += 1

if changed:
    print(f"[ok] backup directory: {BACKUP}")
else:
    print("[ok] no file content changed; patch already installed")

print(f"[summary] changed={changed} skipped={skipped}")
print("[next] node scripts/assert-trial-stabilization-v8-1.js")
print("[next] cd apps/api && npx prisma migrate dev && npx prisma generate")
print("[next] node prisma/repair-trial-stabilization-v8-1.js --dry-run")
print("[next] node prisma/repair-trial-stabilization-v8-1.js")
print("[next] npm run build")
