#!/usr/bin/env python3
"""
apply_care_reminders_v3_3_2_typefix.py
--------------------------------------
Fix the TS2322 build error introduced in v3.3.1:

  src/care-reminders/care-reminders.controller.ts
    frequencyUnit: plan.frequencyUnit ?? 'DAY',
  -> Type 'string' is not assignable to '"DAY" | "WEEK" | "MONTH" | undefined'

`plan.frequencyUnit` is a Prisma scalar `string`, but CreateScheduleInput.frequencyUnit
is the literal union 'DAY' | 'WEEK' | 'MONTH'. Assert the value to that union (the
column only ever holds those values).

Idempotent single-line replacement (safe whether or not v3.3.1 is already applied;
if the line is already asserted, it is skipped).

Run from repo ROOT:
  python3 scripts/apply_care_reminders_v3_3_2_typefix.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path.cwd()
CTRL = ROOT / "apps/api/src/care-reminders/care-reminders.controller.ts"

OLD = "      frequencyUnit: plan.frequencyUnit ?? 'DAY',"
NEW = "      frequencyUnit: (plan.frequencyUnit ?? 'DAY') as 'DAY' | 'WEEK' | 'MONTH',"


def main() -> None:
    if not CTRL.exists():
        print(f"[err] missing {CTRL} (run from repo root)", file=sys.stderr)
        sys.exit(1)
    src = CTRL.read_text(encoding="utf-8")

    if NEW in src:
        print("[skip] care-reminders.controller.ts already type-fixed")
        return

    if OLD not in src:
        print(
            "[err] anchor not found: the line\n"
            f"      {OLD.strip()}\n"
            "is not present. Apply v3.3.1 first, or check the file manually.",
            file=sys.stderr,
        )
        sys.exit(1)

    if src.count(OLD) != 1:
        print(f"[err] anchor not unique ({src.count(OLD)}x)", file=sys.stderr)
        sys.exit(1)

    src = src.replace(OLD, NEW, 1)
    CTRL.write_text(src, encoding="utf-8")
    print("[ok] care-reminders.controller.ts: frequencyUnit cast to 'DAY' | 'WEEK' | 'MONTH'")
    print("\n[done] v3.3.2 type fix applied. Now: cd apps/web && npm run build  (or restart the API)")


if __name__ == "__main__":
    main()
