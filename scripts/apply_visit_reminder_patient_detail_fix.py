#!/usr/bin/env python3
"""
Patch patient-detail hospital visit reminder UI after moving visit reminders into their own tab.

This script is intentionally text/regex based so it can be applied safely on top of
slightly different local patch states.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd().resolve()
WEB_SRC = ROOT / "apps" / "web" / "src"

if not WEB_SRC.exists():
    raise SystemExit(f"Cannot find apps/web/src under {ROOT}")

changed: list[str] = []


def write_if_changed(path: Path, before: str, after: str) -> None:
    if before != after:
        path.write_text(after, encoding="utf-8")
        changed.append(str(path.relative_to(ROOT)))


def patch_tsx_file(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    original = text

    # 1) Remove the over-explaining visit-tab helper sentence wherever it appears.
    hint = "创建提醒、再次提醒、已到院、未到院、拒绝到院都在本 tab 处理；右侧任务面板只自动记录流程与结案。"
    # Remove a whole <p> / <small> / <span> line that only contains the hint.
    text = re.sub(
        rf"\n\s*<(p|small|span)([^>]*)>\s*{re.escape(hint)}\s*</\1>",
        "",
        text,
    )
    # Remove plain text occurrence if it is embedded inside another block.
    text = text.replace(hint, "")

    # 2) Simplify verbose visit-tab title. Keep independent center page title untouched
    # unless it is the verbose tab title.
    text = text.replace("到院提醒生成与后续闭环", "到院提醒")

    # 3) Patient-detail and visit-reminder UI should show full phone numbers.
    # Replace common maskPhone display patterns. Keep the helper function itself so
    # other identity-verification pages are not affected.
    replacements = {
        "maskPhone(patient.phone)": "patient.phone ?? '-'",
        "maskPhone(item.patient?.phone)": "item.patient?.phone ?? '-'",
        "maskPhone(reminder.patient?.phone)": "reminder.patient?.phone ?? '-'",
        "maskPhone(selectedPatient?.phone)": "selectedPatient?.phone ?? '-'",
        "maskPhone(contact.phone)": "contact.phone ?? '-'",
        "maskPhone(row.patient?.phone)": "row.patient?.phone ?? '-'",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)

    # Specific value object pattern used by detailed contact cards.
    text = text.replace("phone: maskPhone(patient.phone),", "phone: patient.phone ?? '-',")
    text = text.replace("phone: maskPhone(item.patient?.phone),", "phone: item.patient?.phone ?? '-',")

    # If an anchor was written as <a ...>{patient.phone ?? '-'}</a>, keep it valid.
    text = text.replace(
        "<a href={patient.phone ? `tel:${patient.phone}` : undefined}>{patient.phone ?? '-'}</a>",
        "<a href={patient.phone ? `tel:${patient.phone}` : undefined}>{patient.phone ?? '-'}</a>",
    )

    # 4) If previous patch left an empty subtitle paragraph after removing hint,
    # remove empty paragraph tags.
    text = re.sub(r"\n\s*<p className=\"[^\"]*\">\s*</p>", "", text)
    text = re.sub(r"\n\s*<p>\s*</p>", "", text)

    write_if_changed(path, original, text)


for path in WEB_SRC.rglob("*.tsx"):
    # Limit to patient/visit/task screens to avoid changing masking in login/binding/security flows.
    name = path.name.lower()
    path_text = str(path).lower()
    if not any(key in name or key in path_text for key in ["patient", "hospital", "visit", "task", "follow"]):
        continue
    try:
        patch_tsx_file(path)
    except UnicodeDecodeError:
        continue

# Patch CSS only if needed for empty space left by removed subtitle.
for css_path in WEB_SRC.rglob("*.css"):
    before = css_path.read_text(encoding="utf-8")
    text = before
    # Make detailed visit reminder patient card friendlier if classes exist.
    if "hospital-visit-patient-detail-card" not in text:
        text += """

/* Patient-detail hospital visit tab: detailed contact card, no masked phone numbers. */
.hospital-visit-patient-detail-card,
.visit-reminder-patient-detail-card {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid #dbeafe;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff, #f8fbff);
}

.hospital-visit-patient-detail-card .contact-grid,
.visit-reminder-patient-detail-card .contact-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.hospital-visit-patient-detail-card a[href^='tel:'],
.visit-reminder-patient-detail-card a[href^='tel:'] {
  color: #0f766e;
  font-weight: 800;
  text-decoration: none;
}
"""
    write_if_changed(css_path, before, text)

print("Applied patient-detail visit reminder tab cleanup.")
if changed:
    print("Changed files:")
    for item in changed:
        print(f"- {item}")
else:
    print("No matching files needed changes.")
