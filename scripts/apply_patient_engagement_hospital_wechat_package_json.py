#!/usr/bin/env python3
"""
apply_patient_engagement_hospital_wechat_package_json.py
---------------------------------------------------------
Idempotent: ensure apps/api/package.json has

    "check:patient-engagement": "node prisma/check-patient-engagement.js"
    "smoke:patient-engagement": "node scripts/smoke-patient-engagement.js"

under "scripts". Preserves the rest of the JSON ordering as much as Python's
json module can.
"""
from __future__ import annotations

import json
import sys
from collections import OrderedDict
from pathlib import Path

PKG = Path("apps/api/package.json")

DESIRED = {
    "check:patient-engagement": "node prisma/check-patient-engagement.js",
    "smoke:patient-engagement": "node scripts/smoke-patient-engagement.js",
}


def main() -> int:
    if not PKG.exists():
        print(f"[err] {PKG} not found", file=sys.stderr)
        return 1
    raw = PKG.read_text(encoding="utf-8")
    try:
        data = json.loads(raw, object_pairs_hook=OrderedDict)
    except json.JSONDecodeError as e:
        print(f"[err] failed to parse {PKG}: {e}", file=sys.stderr)
        return 1

    if "scripts" not in data or not isinstance(data["scripts"], (dict, OrderedDict)):
        data["scripts"] = OrderedDict()

    changed = []
    for k, v in DESIRED.items():
        if data["scripts"].get(k) != v:
            data["scripts"][k] = v
            changed.append(k)

    if not changed:
        print("[skip] package.json scripts already at v2.")
        return 0

    PKG.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("[ok] package.json patched:")
    for c in changed:
        print(f"     - {c}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
