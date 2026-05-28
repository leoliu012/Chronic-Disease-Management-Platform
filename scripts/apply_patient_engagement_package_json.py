#!/usr/bin/env python3
"""
apply_patient_engagement_package_json.py
-----------------------------------------
Idempotent patcher for apps/api/package.json — adds two npm scripts:

  "check:patient-engagement" → node prisma/check-patient-engagement.js
  "smoke:patient-engagement" → node scripts/smoke-patient-engagement.js

Safe to run multiple times.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

PKG = Path("apps/api/package.json")

NEW_SCRIPTS = {
    "check:patient-engagement": "node prisma/check-patient-engagement.js",
    "smoke:patient-engagement": "node scripts/smoke-patient-engagement.js",
}


def main() -> int:
    if not PKG.exists():
        print(f"[skip] {PKG} not found.")
        return 0
    data = json.loads(PKG.read_text(encoding="utf-8"))
    scripts = data.setdefault("scripts", {})
    changed = False
    for name, cmd in NEW_SCRIPTS.items():
        if scripts.get(name) != cmd:
            scripts[name] = cmd
            changed = True
    if not changed:
        print("[skip] package.json already has patient-engagement scripts.")
        return 0
    # Preserve indentation style (2 spaces, trailing newline).
    PKG.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("[ok] package.json patched with patient-engagement scripts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
