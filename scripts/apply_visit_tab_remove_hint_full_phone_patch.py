#!/usr/bin/env python3
"""
Patch: remove redundant hospital-visit tab explanatory copy and show full phone numbers.
Run from project root:
  python3 scripts/apply_visit_tab_remove_hint_full_phone_patch.py "$PWD"
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

EXACT_HINTS = [
    "创建提醒、再次提醒、已到院、未到院、拒绝到院都在本 tab 处理；右侧任务面板只自动记录流程与结案。",
    "创建提醒、再次提醒、已到院、未到院、拒绝到院都在本 tab 处理；右侧任务面板只自动记录流程与结案",
]

# More defensive: if line wrapping or punctuation changed, remove the sentence fragments too.
FRAGMENT_HINT_PATTERNS = [
    r"创建提醒、再次提醒、已到院、未到院、拒绝到院都在本\s*tab\s*处理[；;，,。\s]*右侧任务面板只自动记录流程与结案[。\s]*",
    r"创建提醒、再次提醒、已到院、未到院、拒绝到院都在本\s*tab\s*处理[。\s]*",
    r"右侧任务面板只自动记录流程与结案[。\s]*",
]

TARGETS = [
    "apps/web/src/pages/PatientDetailPage.tsx",
    "apps/web/src/pages/HospitalVisitRemindersPage.tsx",
    "apps/web/src/components/PatientTaskSidePanel.tsx",
    "apps/web/src/pages/TaskFollowUpPage.tsx",
]


def remove_hint_nodes(text: str) -> str:
    # Remove complete JSX nodes that only contain the unwanted copy.
    for hint in EXACT_HINTS:
        escaped = re.escape(hint)
        text = re.sub(rf"\n?\s*<p\b[^>]*>\s*{escaped}\s*</p>", "", text)
        text = re.sub(rf"\n?\s*<small\b[^>]*>\s*{escaped}\s*</small>", "", text)
        text = re.sub(rf"\n?\s*<span\b[^>]*>\s*{escaped}\s*</span>", "", text)
        text = re.sub(rf"\n?\s*<div\b[^>]*>\s*{escaped}\s*</div>", "", text)
        text = text.replace(hint, "")

    for pattern in FRAGMENT_HINT_PATTERNS:
        text = re.sub(pattern, "", text)

    # Clean up empty common JSX text nodes left by the removal.
    text = re.sub(r"\n\s*<p\b([^>]*)>\s*</p>", "", text)
    text = re.sub(r"\n\s*<small\b([^>]*)>\s*</small>", "", text)
    text = re.sub(r"\n\s*<span\b([^>]*)>\s*</span>", "", text)
    return text


def unmask_phone_usages(text: str) -> str:
    replacements = {
        "{maskPhone(patient.phone)}": "{patient.phone ?? '-'}",
        "{maskPhone(patient?.phone)}": "{patient?.phone ?? '-'}",
        "{maskPhone(item.patient?.phone ?? undefined)}": "{item.patient?.phone ?? '-'}",
        "{maskPhone(item.patient?.phone)}": "{item.patient?.phone ?? '-'}",
        "{maskPhone(currentPatient.phone)}": "{currentPatient.phone ?? '-'}",
        "{maskPhone(reminder.patient?.phone)}": "{reminder.patient?.phone ?? '-'}",
        "{maskPhone(selectedReminder.patient?.phone)}": "{selectedReminder.patient?.phone ?? '-'}",
        "{maskPhone(patient.emergencyContactPhone)}": "{patient.emergencyContactPhone ?? '-'}",
        "{maskPhone(patient?.emergencyContactPhone)}": "{patient?.emergencyContactPhone ?? '-'}",
        "{maskPhone(item.patient?.emergencyContactPhone)}": "{item.patient?.emergencyContactPhone ?? '-'}",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)

    # Template-literal cases such as: patient.emergencyContactPhone ? ` / ${maskPhone(patient.emergencyContactPhone)}` : ''
    text = text.replace(
        "patient.emergencyContactPhone ? ` / ${maskPhone(patient.emergencyContactPhone)}` : ''",
        "patient.emergencyContactPhone ? ` / ${patient.emergencyContactPhone}` : ''",
    )
    text = text.replace(
        "patient?.emergencyContactPhone ? ` / ${maskPhone(patient?.emergencyContactPhone)}` : ''",
        "patient?.emergencyContactPhone ? ` / ${patient.emergencyContactPhone}` : ''",
    )
    text = text.replace(
        "item.patient?.emergencyContactPhone ? ` / ${maskPhone(item.patient.emergencyContactPhone)}` : ''",
        "item.patient?.emergencyContactPhone ? ` / ${item.patient.emergencyContactPhone}` : ''",
    )

    # Common direct function-call text in JSX expressions.
    text = re.sub(r"maskPhone\((patient(?:\?|)\.phone)\)", r"\1 ?? '-'", text)
    text = re.sub(r"maskPhone\((patient(?:\?|)\.emergencyContactPhone)\)", r"\1 ?? '-'", text)
    text = re.sub(r"maskPhone\((item\.patient\?\.phone)\)", r"\1 ?? '-'", text)
    text = re.sub(r"maskPhone\((item\.patient\?\.emergencyContactPhone)\)", r"\1 ?? '-'", text)
    text = re.sub(r"maskPhone\((reminder\.patient\?\.phone)\)", r"\1 ?? '-'", text)

    return text


def remove_unused_mask_phone_function(text: str) -> str:
    # If only the function declaration remains, remove it to satisfy noUnusedLocals.
    if text.count("maskPhone(") <= 1:
        text = re.sub(
            r"\nfunction maskPhone\(value\?: string(?: \| null)?\) \{\n\s*if \(!value[^\n]*\n\s*return `\$\{value\.slice\(0, 3\)\}\*\*\*\*\$\{value\.slice\(-4\)\}`;\n\}\n",
            "\n",
            text,
            count=1,
        )
    return text


def patch_file(path: Path) -> bool:
    if not path.exists():
        return False
    before = path.read_text(encoding="utf-8")
    after = before
    after = remove_hint_nodes(after)
    after = unmask_phone_usages(after)
    after = remove_unused_mask_phone_function(after)
    if after != before:
        path.write_text(after, encoding="utf-8")
        return True
    return False


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd().resolve()
    changed = []
    missing = []
    for rel in TARGETS:
        path = root / rel
        if not path.exists():
            missing.append(rel)
            continue
        if patch_file(path):
            changed.append(rel)

    print("visit_tab_remove_hint_full_phone_patch")
    print(f"Project root: {root}")
    print("Changed files:")
    for item in changed:
        print(f"- {item}")
    if not changed:
        print("- none; files may already be patched")
    if missing:
        print("Missing optional files:")
        for item in missing:
            print(f"- {item}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
