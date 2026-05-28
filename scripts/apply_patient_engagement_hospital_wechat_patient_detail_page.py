#!/usr/bin/env python3
"""
apply_patient_engagement_hospital_wechat_patient_detail_page.py
----------------------------------------------------------------
Bug 1 fix: the v1 patcher added 'patient-engagement' to the union type and
the render branch, but the v1 logic guarded the patientDetailWorkspaceTabs
array insertion with `if "patient-engagement" not in src` — which was already
true thanks to the union type — so the array entry never got added. Result:
the tab is rendered conditionally on `currentWorkspace`, but the tab BUTTON
itself never appears.

This patcher:
  - Locates the patientDetailWorkspaceTabs array.
  - Scans the array body for `key: 'patient-engagement'`.
  - If absent, inserts the line `  { key: 'patient-engagement', title: '微信随访', description: '本院服务号 / H5 链接 · 短信兜底' },`
    immediately before the `{ key: 'timeline', ...}` line.
  - If present but with the old "服务号 / H5 链接 · 短信兜底" description, rewrites
    the description to "本院服务号 / H5 链接 · 短信兜底".

Idempotent.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

PAGE = Path("apps/web/src/pages/PatientDetailPage.tsx")


def main() -> int:
    if not PAGE.exists():
        print(f"[err] {PAGE} not found", file=sys.stderr)
        return 1

    src = PAGE.read_text(encoding="utf-8")
    original = src

    # Find the patientDetailWorkspaceTabs array
    array_re = re.compile(
        r"(const\s+patientDetailWorkspaceTabs\s*:\s*Array<[^>]+>\s*=\s*\[)([\s\S]*?)(\];)",
        re.MULTILINE,
    )
    m = array_re.search(src)
    if not m:
        print("[err] could not locate patientDetailWorkspaceTabs array. Was the v1 patch applied?", file=sys.stderr)
        return 1

    header, body, closer = m.group(1), m.group(2), m.group(3)
    new_body = body

    desired_line = "  { key: 'patient-engagement', title: '微信随访', description: '本院服务号 / H5 链接 · 短信兜底' },\n"

    if "key: 'patient-engagement'" in body or 'key: "patient-engagement"' in body:
        # Already has an entry — make sure description has the v2 wording.
        v2_desc = "本院服务号 / H5 链接 · 短信兜底"
        if v2_desc not in body:
            # Best effort: rewrite the patient-engagement line
            new_body = re.sub(
                r"\{\s*key:\s*['\"]patient-engagement['\"][^}]*\},?",
                desired_line.rstrip("\n").rstrip(","),
                new_body,
                count=1,
            )
            change = "rewrote patient-engagement tab description"
        else:
            change = None
    else:
        # Insert before the timeline tab if present, otherwise before the closing ].
        timeline_re = re.compile(
            r"^(\s*\{\s*key:\s*['\"]timeline['\"][^\n]*?\},?\s*\n)",
            re.MULTILINE,
        )
        tm = timeline_re.search(new_body)
        if tm:
            new_body = new_body[: tm.start()] + desired_line + new_body[tm.start():]
            change = "inserted patient-engagement tab before timeline"
        else:
            # Fall back: append before closing
            new_body = new_body.rstrip() + "\n" + desired_line
            change = "appended patient-engagement tab (no timeline anchor found)"

    if new_body == body:
        print("[skip] PatientDetailPage.tsx already has v2 patient-engagement tab entry.")
        return 0

    src = src[: m.start()] + header + new_body + closer + src[m.end():]
    PAGE.write_text(src, encoding="utf-8")
    print(f"[ok] PatientDetailPage.tsx patched: {change}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
