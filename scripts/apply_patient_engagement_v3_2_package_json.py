#!/usr/bin/env python3
"""
apply_patient_engagement_v3_2_package_json.py
----------------------------------------------
Idempotent. Ensures apps/api/package.json has the patient-engagement smoke script.

v3.2 keeps the same script name (`smoke:patient-engagement`); the runner file is
upgraded by the patch ZIP. Safety net for trees that never had it; no-op otherwise.

Run from repo root:
  python3 scripts/apply_patient_engagement_v3_2_package_json.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

PKG = Path("apps/api/package.json")
SMOKE_CMD = "node scripts/smoke-patient-engagement.js"


def main() -> int:
    if not PKG.exists():
        print(f"[err] {PKG} not found (run from repo root)", file=sys.stderr)
        return 1
    data = json.loads(PKG.read_text(encoding="utf-8"))
    scripts = data.setdefault("scripts", {})
    if scripts.get("smoke:patient-engagement") == SMOKE_CMD:
        print("[skip] package.json already has smoke:patient-engagement.")
        return 0
    scripts["smoke:patient-engagement"] = SMOKE_CMD
    PKG.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("[ok] package.json — ensured smoke:patient-engagement script")
    return 0


if __name__ == "__main__":
    sys.exit(main())
