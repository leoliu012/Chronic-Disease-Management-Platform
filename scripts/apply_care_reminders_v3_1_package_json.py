#!/usr/bin/env python3
"""
apply_care_reminders_v3_1_package_json.py
-----------------------------------------
Idempotent. Ensures apps/api/package.json exposes the care-reminders smoke
script. The smoke runner file itself (scripts/smoke-care-reminders.js) is
shipped by the patch ZIP via rsync; this just guarantees the npm alias exists
so `npm run smoke:care-reminders` works after a fresh checkout.

Run from repo root:
    python3 scripts/apply_care_reminders_v3_1_package_json.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

PKG = Path("apps/api/package.json")
SMOKE_CMD = "node scripts/smoke-care-reminders.js"


def main() -> int:
    if not PKG.exists():
        print(f"[err] {PKG} not found (run from repo root)", file=sys.stderr)
        return 1

    raw = PKG.read_text(encoding="utf-8")
    data = json.loads(raw)
    scripts = data.setdefault("scripts", {})

    if scripts.get("smoke:care-reminders") == SMOKE_CMD:
        print("[skip] package.json already has smoke:care-reminders")
        return 0

    scripts["smoke:care-reminders"] = SMOKE_CMD
    out = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    PKG.write_text(out, encoding="utf-8")
    print("[ok] package.json — ensured smoke:care-reminders script")
    return 0


if __name__ == "__main__":
    sys.exit(main())
