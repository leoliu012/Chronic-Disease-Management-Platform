#!/usr/bin/env python3
"""
apply_v3_package_json.py — add `smoke:care-reminders` script to apps/api/package.json.
Idempotent.
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

PKG = Path("apps/api/package.json")


def main() -> int:
    if not PKG.exists():
        print(f"[err] {PKG} not found", file=sys.stderr)
        return 1
    raw = PKG.read_text(encoding="utf-8")
    data = json.loads(raw)
    scripts = data.setdefault("scripts", {})
    if scripts.get("smoke:care-reminders") == "node scripts/smoke-care-reminders.js":
        print("[skip] package.json already has smoke:care-reminders.")
        return 0
    scripts["smoke:care-reminders"] = "node scripts/smoke-care-reminders.js"
    # Preserve trailing newline, indent with 2 spaces (npm convention).
    out = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    PKG.write_text(out, encoding="utf-8")
    print("[ok] package.json — added smoke:care-reminders script")
    return 0


if __name__ == "__main__":
    sys.exit(main())
