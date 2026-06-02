#!/usr/bin/env python3
"""
fix_patient_detail_care_reminders_render.py
-------------------------------------------
Repairs a bad v3 frontend routing insertion in apps/web/src/pages/PatientDetailPage.tsx.

Symptom:
  Vite/Rolldown parse error around:
    {/* care-reminders v3 */}
  with "Expected `...` but found `}`".

Cause:
  apply_v3_frontend_routing.py inserted the care-reminders render branch inside
  the <PatientEngagementTab ... /> props area instead of at the top-level JSX
  workspace render area.

Fix:
  1. Remove any existing care-reminders render branch, wherever it was inserted.
  2. Ensure CareRemindersPanel import exists.
  3. Ensure the care-reminders tab/union/validator entries exist.
  4. Reinsert the render branch immediately before the timeline workspace branch.

Idempotent: safe to run more than once.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

PAGE = Path("apps/web/src/pages/PatientDetailPage.tsx")

PANEL_IMPORT = "import CareRemindersPanel from '../components/CareRemindersPanel';"
TAB_ENTRY = "  { key: 'care-reminders', title: '慢病提醒', description: '长期计划 / 今日提醒 / 主动消息' },\n"
RENDER_BLOCK = """      {/* care-reminders v3 */}
      {activeWorkspace === 'care-reminders' && (
        <section className=\"panel\">
          <CareRemindersPanel patientId={patientId!} canEdit={true} />
        </section>
      )}

"""

# Matches the exact v3 render branch, regardless of whether it sits in the right
# place or incorrectly inside another JSX prop expression.
CARE_RENDER_RE = re.compile(
    r"\n\s*\{/\*\s*care-reminders v3\s*\*/\}\s*\n"
    r"\s*\{activeWorkspace\s*===\s*['\"]care-reminders['\"]\s*&&\s*\(\s*\n"
    r"\s*<section\s+className=\"panel\">\s*\n"
    r"\s*<CareRemindersPanel\s+patientId=\{patientId!\}\s+canEdit=\{true\}\s*/>\s*\n"
    r"\s*</section>\s*\n"
    r"\s*\)\}\s*\n*",
    re.MULTILINE,
)


def replace_once(src: str, old: str, new: str) -> tuple[str, bool]:
    if old not in src:
        return src, False
    return src.replace(old, new, 1), True


def main() -> int:
    if not PAGE.exists():
        print(f"[err] {PAGE} not found. Run this from repo root.", file=sys.stderr)
        return 1

    src = PAGE.read_text(encoding="utf-8")
    original = src
    notes: list[str] = []

    # 1) Remove every existing care-reminders render branch first. This is the
    # key repair for the parse error when the branch was injected inside props.
    src, removed_count = CARE_RENDER_RE.subn("\n", src)
    if removed_count:
        notes.append(f"removed {removed_count} existing/misplaced care-reminders render block(s)")

    # 2) Import.
    if PANEL_IMPORT not in src:
        # Prefer placing after PatientEngagementTab import, then any component import, else top.
        m = re.search(r"^import .*PatientEngagementTab.*;\s*$", src, flags=re.MULTILINE)
        if not m:
            m = re.search(r"^import .* from '\.\./components/[^']+';\s*$", src, flags=re.MULTILINE)
        if m:
            src = src[: m.end()] + "\n" + PANEL_IMPORT + src[m.end():]
        else:
            src = PANEL_IMPORT + "\n" + src
        notes.append("ensured CareRemindersPanel import")

    # 3) PatientDetailWorkspace union.
    if "'care-reminders'" not in src:
        src, ok = replace_once(src, "'patient-engagement' | 'timeline'", "'patient-engagement' | 'care-reminders' | 'timeline'")
        if not ok:
            src, ok = replace_once(src, "'timeline';", "'care-reminders' | 'timeline';")
        if ok:
            notes.append("added care-reminders to PatientDetailWorkspace union")
        else:
            print("[warn] could not patch PatientDetailWorkspace union; please inspect manually.")

    # 4) isPatientDetailWorkspace validator.
    if "value === 'care-reminders'" not in src:
        src, ok = replace_once(
            src,
            "value === 'patient-engagement' ||\n    value === 'timeline'",
            "value === 'patient-engagement' ||\n    value === 'care-reminders' ||\n    value === 'timeline'",
        )
        if not ok:
            src, ok = replace_once(
                src,
                "value === 'care' ||\n    value === 'timeline'",
                "value === 'care' ||\n    value === 'care-reminders' ||\n    value === 'timeline'",
            )
        if ok:
            notes.append("added care-reminders to isPatientDetailWorkspace")
        else:
            print("[warn] could not patch isPatientDetailWorkspace; please inspect manually.")

    # 5) Tab entry.
    array_re = re.compile(
        r"(const\s+patientDetailWorkspaceTabs\s*:\s*Array<[^>]+>\s*=\s*\[)([\s\S]*?)(\];)",
        re.MULTILINE,
    )
    m = array_re.search(src)
    if m:
        header, body, closer = m.group(1), m.group(2), m.group(3)
        if "key: 'care-reminders'" not in body and 'key: "care-reminders"' not in body:
            tm = re.search(r"^(\s*\{\s*key:\s*['\"]timeline['\"][^\n]*?\},?\s*\n)", body, flags=re.MULTILINE)
            if tm:
                body = body[: tm.start()] + TAB_ENTRY + body[tm.start():]
            else:
                body = body.rstrip() + "\n" + TAB_ENTRY
            src = src[: m.start()] + header + body + closer + src[m.end():]
            notes.append("added care-reminders tab entry")
    else:
        print("[warn] could not locate patientDetailWorkspaceTabs array; tab entry not checked.")

    # 6) Correct top-level render insertion: immediately before timeline branch.
    if "activeWorkspace === 'care-reminders'" not in src:
        anchor = "      {activeWorkspace === 'timeline' && ("
        idx = src.find(anchor)
        if idx == -1:
            print("[err] could not find timeline workspace render anchor; render block not inserted.", file=sys.stderr)
            PAGE.write_text(src, encoding="utf-8")
            return 1
        src = src[:idx] + RENDER_BLOCK + src[idx:]
        notes.append("inserted care-reminders render block before timeline")

    if src == original:
        print("[skip] PatientDetailPage.tsx already healthy for care-reminders render.")
        return 0

    PAGE.write_text(src, encoding="utf-8")
    print("[ok] PatientDetailPage.tsx repaired:")
    for note in notes:
        print(f"     - {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
