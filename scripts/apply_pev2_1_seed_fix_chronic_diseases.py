#!/usr/bin/env python3
"""
apply_pev2_1_seed_fix_chronic_diseases.py
------------------------------------------
Second hotfix for the v2.1 seed block.

  PrismaClientValidationError: Unknown argument `chronicDiseases`.

`chronicDiseases` was a leftover from the patcher author's head; the real
schema keeps disease info in DiseaseProfile, not on Patient. The smoke test
only needs demo-patient-101 to exist under demo-tenant-002 to exercise
cross-tenant isolation — no disease metadata required.

Removes the offending line. Idempotent.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

SEED = Path("apps/api/prisma/seed-all.js")

# Possible representations of the bad line, accounting for whitespace variations
PATTERNS = [
    "      chronicDiseases: ['HYPERTENSION'],\n",
    "      chronicDiseases: ['HYPERTENSION']\n",
    "      chronicDiseases: ['HYPERTENSION'],\r\n",
]


def main() -> int:
    if not SEED.exists():
        print(f"[err] {SEED} not found", file=sys.stderr)
        return 1
    src = SEED.read_text(encoding="utf-8")

    # Quick check: is the bad field anywhere near demo-patient-101?
    block_match = re.search(
        r"prisma\.patient\.upsert\(\{[\s\S]*?'demo-patient-101'[\s\S]*?\}\);",
        src,
    )
    if not block_match:
        print("[warn] couldn't find the demo-patient-101 upsert block. Nothing to do.")
        return 0
    block_text = block_match.group(0)
    if "chronicDiseases" not in block_text:
        print("[skip] demo-patient-101 upsert already cleaned (no chronicDiseases).")
        return 0

    # Remove the offending line from the block only (defensive — don't touch
    # other patient creates that might legitimately reference 'HYPERTENSION'
    # elsewhere, e.g., in DiseaseProfile rows).
    new_block = block_text
    for p in PATTERNS:
        if p in new_block:
            new_block = new_block.replace(p, "", 1)
            break
    else:
        # Last resort: regex with flexible whitespace
        new_block, n = re.subn(
            r"^\s*chronicDiseases:\s*\[[^\]]*\],?\s*\n",
            "",
            new_block,
            count=1,
            flags=re.MULTILINE,
        )
        if n == 0:
            print("[warn] found chronicDiseases inside block but couldn't match line shape. "
                  "Edit manually.")
            return 1

    src = src.replace(block_text, new_block, 1)
    SEED.write_text(src, encoding="utf-8")
    print("[ok] seed-all.js patched: removed `chronicDiseases` from demo-patient-101 upsert")
    return 0


if __name__ == "__main__":
    sys.exit(main())
