#!/usr/bin/env python3
from pathlib import Path
import re
import sys

if len(sys.argv) < 2:
    print('Usage: python3 scripts/apply_visit_tab_copy_phone_patch.py <project-root>')
    sys.exit(1)

root = Path(sys.argv[1]).resolve()
if not (root / 'apps').exists():
    print(f'Error: {root} does not look like the project root; missing apps/.')
    sys.exit(1)

files = [
    root / 'apps/web/src/pages/PatientDetailPage.tsx',
    root / 'apps/web/src/components/PatientTaskSidePanel.tsx',
    root / 'apps/web/src/pages/TaskFollowUpPage.tsx',
]

removed_copy = '创建提醒、再次提醒、已到院、未到院、拒绝到院都在本 tab 处理；右侧任务面板只自动记录流程与结案。'

block_patterns = [
    # JSX paragraph / hint / note wrappers containing only this sentence.
    rf"\n\s*<p[^>]*>\s*{re.escape(removed_copy)}\s*</p>",
    rf"\n\s*<small[^>]*>\s*{re.escape(removed_copy)}\s*</small>",
    rf"\n\s*<div[^>]*className=\"[^\"]*(?:hint|note|description|subtitle)[^\"]*\"[^>]*>\s*{re.escape(removed_copy)}\s*</div>",
    rf"\n\s*<span[^>]*>\s*{re.escape(removed_copy)}\s*</span>",
]

phone_replacements = {
    'maskPhone(patient.phone)': "patient.phone ?? '-'",
    'maskPhone(patient?.phone)': "patient?.phone ?? '-'",
    'maskPhone(patient.emergencyContactPhone)': "patient.emergencyContactPhone ?? '-'",
    'maskPhone(patient?.emergencyContactPhone)': "patient?.emergencyContactPhone ?? '-'",
    'maskPhone(item.phone)': "item.phone ?? '-'",
    'maskPhone(item?.phone)': "item?.phone ?? '-'",
    'maskPhone(item.emergencyContactPhone)': "item.emergencyContactPhone ?? '-'",
    'maskPhone(item?.emergencyContactPhone)': "item?.emergencyContactPhone ?? '-'",
    'maskPhone(currentPatient.phone)': "currentPatient.phone ?? '-'",
    'maskPhone(currentPatient?.phone)': "currentPatient?.phone ?? '-'",
}

def remove_unused_mask_phone(source: str) -> str:
    # If no call sites remain except the function declaration itself, remove the local helper.
    call_count = source.count('maskPhone(')
    if call_count != 1 or 'function maskPhone(' not in source:
        return source

    # Simple local helper shape used in this project. Match until the first standalone closing brace.
    source = re.sub(
        r"\nfunction maskPhone\([^)]*\) \{\n(?:[^{}]*\n)*?\}\n",
        "\n",
        source,
        count=1,
    )
    return source

changed_files = []
for path in files:
    if not path.exists():
        continue
    text = path.read_text()
    original = text

    for pattern in block_patterns:
        text = re.sub(pattern, '', text, flags=re.MULTILINE)

    # Fallback: remove the sentence even if it is embedded in a larger JSX text node.
    text = text.replace(removed_copy, '')

    for old, new in phone_replacements.items():
        text = text.replace(old, new)

    text = remove_unused_mask_phone(text)

    if text != original:
        path.write_text(text)
        changed_files.append(str(path.relative_to(root)))

if changed_files:
    print('Updated files:')
    for item in changed_files:
        print(f'- {item}')
else:
    print('No matching content found. The files may have already been updated.')
