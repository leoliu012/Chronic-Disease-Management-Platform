#!/usr/bin/env python3
"""
apply_patient_engagement_patient_detail_page.py
-----------------------------------------------
Idempotent patcher for apps/web/src/pages/PatientDetailPage.tsx.

Adds the "微信随访" tab:
  1. import PatientEngagementTab
  2. extend PatientDetailWorkspace union type
  3. push entry into patientDetailWorkspaceTabs array
  4. extend isPatientDetailWorkspace validator
  5. add count in getWorkspaceCount
  6. render block before {activeWorkspace === 'timeline' && ...}
"""
from __future__ import annotations

import sys
from pathlib import Path

PAGE = Path("apps/web/src/pages/PatientDetailPage.tsx")

IMPORT_LINE = "import { PatientEngagementTab } from '../components/PatientEngagementTab';"
IMPORT_ANCHOR = "import { PatientTaskSidePanel } from '../components/PatientTaskSidePanel';"

TAB_KEY = "'patient-engagement'"

TAB_ENTRY = "  { key: 'patient-engagement', title: '微信随访', description: '服务号 / H5 链接 · 短信兜底' },\n"
TAB_ENTRY_ANCHOR = "  { key: 'timeline', title: '全流程记录'"  # tab is inserted just before this

UNION_ANCHOR = "type PatientDetailWorkspace = 'overview' | 'hospital-records' | 'actions' | 'disease' | 'monitoring' | 'medication' | 'follow-up' | 'hospital-visit' | 'handling-history' | 'care' | 'timeline';"
UNION_PATCHED = "type PatientDetailWorkspace = 'overview' | 'hospital-records' | 'actions' | 'disease' | 'monitoring' | 'medication' | 'follow-up' | 'hospital-visit' | 'handling-history' | 'care' | 'patient-engagement' | 'timeline';"

VALIDATOR_ANCHOR = "    value === 'care' ||\n    value === 'timeline'"
VALIDATOR_PATCHED = "    value === 'care' ||\n    value === 'patient-engagement' ||\n    value === 'timeline'"

COUNT_ANCHOR = "    if (key === 'care') return activeTaskCount + followUpCount;\n    return visibleTimeline.length;"
COUNT_PATCHED = (
    "    if (key === 'care') return activeTaskCount + followUpCount;\n"
    "    if (key === 'patient-engagement') return 0;\n"
    "    return visibleTimeline.length;"
)

RENDER_ANCHOR = "      {activeWorkspace === 'timeline' && ("
RENDER_BLOCK = """      {activeWorkspace === 'patient-engagement' && (
        <section className=\"panel\">
          <PatientEngagementTab
            patientId={patientId!}
            medications={activeMedicationTimeline
              .map((item: any) => item.data)
              .filter((m: any) => m && m.id)
              .map((m: any) => ({ id: m.id, medicationName: m.medicationName, dosage: m.dosage, frequency: m.frequency }))}
            hospitalVisitReminders={activeHospitalVisitReminders.map((r: any) => ({ id: r.id, title: r.title, reason: r.reason }))}
          />
        </section>
      )}

"""

MARKER = "patient-engagement-wechat-h5-v1 tab"


def main() -> int:
    if not PAGE.exists():
        print(f"[skip] {PAGE} not found.")
        return 0
    src = PAGE.read_text(encoding="utf-8")
    if MARKER in src:
        print("[skip] PatientDetailPage.tsx already patched.")
        return 0
    original = src

    # 1. Import
    if IMPORT_LINE not in src:
        idx = src.find(IMPORT_ANCHOR)
        if idx == -1:
            # Insert at top after first import group.
            first_import = src.find("import ")
            src = src[:first_import] + IMPORT_LINE + "\n" + src[first_import:]
        else:
            end_of_line = src.find("\n", idx)
            src = src[: end_of_line + 1] + IMPORT_LINE + "\n" + src[end_of_line + 1 :]

    # 2. Union type
    if UNION_PATCHED not in src:
        if UNION_ANCHOR in src:
            src = src.replace(UNION_ANCHOR, UNION_PATCHED, 1)
        else:
            print("[warn] PatientDetailWorkspace union type not found verbatim; skipping union patch.")

    # 3. Tab entry
    if "patient-engagement" not in src or "微信随访" not in src:
        if TAB_ENTRY_ANCHOR in src:
            idx = src.find(TAB_ENTRY_ANCHOR)
            src = src[:idx] + TAB_ENTRY + src[idx:]
        else:
            print("[warn] couldn't find tab entry anchor.")

    # 4. Validator
    if VALIDATOR_PATCHED not in src:
        if VALIDATOR_ANCHOR in src:
            src = src.replace(VALIDATOR_ANCHOR, VALIDATOR_PATCHED, 1)
        else:
            print("[warn] couldn't find validator anchor; skipping.")

    # 5. Count
    if COUNT_PATCHED not in src:
        if COUNT_ANCHOR in src:
            src = src.replace(COUNT_ANCHOR, COUNT_PATCHED, 1)
        else:
            print("[warn] couldn't find count anchor; skipping.")

    # 6. Render block (insert just before timeline render)
    if "activeWorkspace === 'patient-engagement'" not in src:
        if RENDER_ANCHOR in src:
            idx = src.find(RENDER_ANCHOR)
            jsx_comment = "      {/* " + MARKER + " */}\n"
            src = src[:idx] + jsx_comment + RENDER_BLOCK + src[idx:]
        else:
            print("[warn] couldn't find timeline render anchor.")

    if src == original:
        print("[skip] PatientDetailPage.tsx unchanged.")
        return 0
    PAGE.write_text(src, encoding="utf-8")
    print("[ok] PatientDetailPage.tsx patched.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
