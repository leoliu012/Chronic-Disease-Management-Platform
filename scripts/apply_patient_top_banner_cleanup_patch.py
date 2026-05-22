#!/usr/bin/env python3
"""
Patch patient detail layout:
- Remove the duplicated patient status strip in PatientDetailPage.
- Move the active hospital-visit reminder UI to the very top of the page as a prominent banner.
- Add banner styling without touching task-side-panel logic.

Run from repo root:
  python3 scripts/apply_patient_top_banner_cleanup_patch.py "$PWD"
"""
from __future__ import annotations

from pathlib import Path
import re
import sys

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd().resolve()
page_path = ROOT / "apps/web/src/pages/PatientDetailPage.tsx"
css_path = ROOT / "apps/web/src/patient-detail-task-ux-polish.css"

if not page_path.exists():
    raise SystemExit(f"PatientDetailPage.tsx not found: {page_path}")
if not css_path.exists():
    raise SystemExit(f"patient-detail-task-ux-polish.css not found: {css_path}")

page = page_path.read_text(encoding="utf-8")
original_page = page

# 1) Remove any existing hospital-visit banner block from its old position, keeping the block content.
banner_pattern = re.compile(
    r"\n\s*\{activeHospitalVisitReminders\.length > 0 && \(\s*\n"
    r"\s*<section className=\"patient-hospital-visit-banner(?: patient-hospital-visit-banner-top)?\" role=\"status\">"
    r".*?"
    r"\n\s*</section>\s*\n\s*\)\}\s*\n",
    re.DOTALL,
)
banner_match = banner_pattern.search(page)
if banner_match:
    banner_block = banner_match.group(0).strip("\n")
    page = banner_pattern.sub("\n", page, count=1)
else:
    # Fallback for already modified files where the block is absent.
    banner_block = r'''      {activeHospitalVisitReminders.length > 0 && (
        <section className="patient-hospital-visit-banner patient-hospital-visit-banner-top" role="status">
          <div>
            <strong>已提示该患者立即前往医院</strong>
            <p>{activeHospitalVisitReminders[0]?.reason}</p>
          </div>
          <div className="patient-hospital-visit-banner-actions">
            <Link className="primary-btn compact-link-btn" to={`/hospital-visit-reminders?patientId=${patient.id}`}>
              查看详情
            </Link>
          </div>
        </section>
      )}'''

# Make sure the banner block has the top-banner class.
banner_block = banner_block.replace(
    'className="patient-hospital-visit-banner"',
    'className="patient-hospital-visit-banner patient-hospital-visit-banner-top"',
)

# 2) Remove duplicated patient identity/status strip from the chart body.
status_pattern = re.compile(
    r"\n\s*\{\/\* 患者驾驶舱 - 第一屏关键状态 \*\/\}\s*\n"
    r"\s*<div className=\"patient-status-bar\">.*?"
    r"\n\s*<div className=\"patient-snapshot-grid\">",
    re.DOTALL,
)
page, status_removed = status_pattern.subn("\n\n      <div className=\"patient-snapshot-grid\">", page, count=1)

# 3) Put the hospital-visit banner at the top of the patient page, before the page header.
# Remove duplicate top banner if script is run more than once, then insert once.
page = banner_pattern.sub("\n", page)
insert_anchor = '    <div className="business-page patient-detail-page hospital-record-page">\n'
if insert_anchor not in page:
    raise SystemExit("Could not find patient detail page root anchor.")
page = page.replace(insert_anchor, f'{insert_anchor}{banner_block}\n\n', 1)

# Prevent accidental multiple consecutive blank lines from getting too noisy.
page = re.sub(r"\n{4,}", "\n\n\n", page)

if page != original_page:
    page_path.write_text(page, encoding="utf-8")

css = css_path.read_text(encoding="utf-8")
original_css = css
banner_css_marker = "/* Top-of-page hospital visit reminder banner */"
if banner_css_marker not in css:
    css += r'''

/* Top-of-page hospital visit reminder banner */
.patient-hospital-visit-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid #fecaca;
  border-left: 5px solid #dc2626;
  border-radius: 14px;
  background: linear-gradient(90deg, #fff1f2, #fff7ed);
  box-shadow: 0 12px 26px rgba(220, 38, 38, 0.12);
}

.patient-hospital-visit-banner-top {
  margin: 0 0 16px;
}

.patient-hospital-visit-banner strong {
  display: block;
  color: #991b1b;
  font-size: 15px;
  font-weight: 900;
}

.patient-hospital-visit-banner p {
  margin: 4px 0 0;
  color: #7f1d1d;
  font-size: 13px;
  line-height: 1.55;
}

.patient-hospital-visit-banner-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

@media (max-width: 760px) {
  .patient-hospital-visit-banner {
    display: grid;
    align-items: start;
  }

  .patient-hospital-visit-banner-actions {
    justify-content: flex-start;
  }
}
'''

if css != original_css:
    css_path.write_text(css, encoding="utf-8")

print("Patch applied:")
print(f"- Updated {page_path}")
print(f"- Updated {css_path}")
print(f"- Patient status strip removed: {'yes' if status_removed else 'already absent / not matched'}")
print("- Hospital visit reminder banner moved to the top of the patient detail page.")
