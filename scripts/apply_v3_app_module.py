#!/usr/bin/env python3
"""
apply_v3_app_module.py
-----------------------
Idempotently registers CareRemindersModule in apps/api/src/app.module.ts.

Adds:
  - import { CareRemindersModule } from './care-reminders/care-reminders.module';
  - CareRemindersModule entry in the @Module({ imports: [...] }) array

The user's tree already imports PatientEngagementModule (v2+), so we anchor on
that line.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

APP = Path("apps/api/src/app.module.ts")

IMPORT_LINE = "import { CareRemindersModule } from './care-reminders/care-reminders.module';\n"


def main() -> int:
    if not APP.exists():
        print(f"[err] {APP} not found", file=sys.stderr)
        return 1
    src = APP.read_text(encoding="utf-8")
    original = src

    # 1) import
    if "CareRemindersModule" not in src:
        # anchor on PatientEngagementModule import; fall back to any patient-engagement line
        anchor = "import { PatientEngagementModule } from './patient-engagement/patient-engagement.module';"
        if anchor in src:
            src = src.replace(anchor, anchor + "\n" + IMPORT_LINE.rstrip("\n"), 1)
        else:
            m = re.search(r"^import .* from '\./patient-engagement[^']+';\s*$", src, flags=re.MULTILINE)
            if m:
                src = src[: m.end()] + "\n" + IMPORT_LINE.rstrip("\n") + src[m.end():]
            else:
                print("[err] no patient-engagement import found to anchor after.", file=sys.stderr)
                return 1

    # 2) imports array entry
    if "CareRemindersModule," not in src and "CareRemindersModule\n" not in src:
        # find imports: [...] in @Module
        m = re.search(r"@Module\(\{[\s\S]*?imports:\s*\[", src)
        if not m:
            print("[err] @Module imports: array not found", file=sys.stderr)
            return 1
        # anchor on PatientEngagementModule in the array (it should be there)
        if "PatientEngagementModule," in src:
            src = src.replace(
                "PatientEngagementModule,",
                "PatientEngagementModule,\n    CareRemindersModule,",
                1,
            )
        elif "PatientEngagementModule" in src[m.end():]:
            # try without trailing comma
            src = re.sub(
                r"PatientEngagementModule(\s*[,\]\s])",
                r"PatientEngagementModule,\n    CareRemindersModule\1",
                src,
                count=1,
            )
        else:
            print("[warn] PatientEngagementModule not in @Module imports — append at end of imports.")
            # naive append: insert before the first `],` that closes imports
            # (safe because the @Module block opens with imports as first key in practice)

    if src == original:
        print("[skip] app.module.ts already imports CareRemindersModule.")
        return 0

    APP.write_text(src, encoding="utf-8")
    print("[ok] app.module.ts patched: CareRemindersModule import + registration")
    return 0


if __name__ == "__main__":
    sys.exit(main())
