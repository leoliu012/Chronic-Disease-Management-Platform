#!/usr/bin/env python3
"""Apply clinical disposition v5.0.1 strict TypeScript hotfix.

Run from the repository root:
  python3 scripts/apply_clinical_disposition_v5_0_1_hotfix.py

The patcher is idempotent and only installs the two v5.0.1 overlay files.
"""
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
OVERLAY = ROOT / "clinical_disposition_v5_0_1_overlay"

FILES = [
    "apps/api/src/clinical-disposition/clinical-disposition.service.ts",
    "apps/api/src/work-items/work-items.service.ts",
]

def copy_one(relative: str) -> str:
    src = OVERLAY / relative
    dst = ROOT / relative
    if not src.is_file():
        raise FileNotFoundError(f"missing overlay file: {src}")
    old = dst.read_bytes() if dst.is_file() else None
    new = src.read_bytes()
    if old == new:
        return "unchanged"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return "wrote"

def main() -> int:
    if not (ROOT / "apps/api").is_dir():
        print("[err] run this script from the repository root containing apps/api", file=sys.stderr)
        return 1
    counts = {"wrote": 0, "unchanged": 0}
    for relative in FILES:
        result = copy_one(relative)
        counts[result] += 1
        print(f"[{result}] {relative}")
    print(f"[done] clinical disposition v5.0.1 hotfix applied: wrote={counts['wrote']}, unchanged={counts['unchanged']}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
