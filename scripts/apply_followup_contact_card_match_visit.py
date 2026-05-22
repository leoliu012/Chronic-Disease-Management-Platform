#!/usr/bin/env python3
"""Make the phone follow-up tab patient contact card match the hospital-visit tab card.

Run from repository root:
  python3 scripts/apply_followup_contact_card_match_visit.py "$PWD"
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
patient_page = ROOT / "apps/web/src/pages/PatientDetailPage.tsx"
css_path = ROOT / "apps/web/src/patient-task-side-panel.css"

if not patient_page.exists():
    raise SystemExit(f"Missing file: {patient_page}")

text = patient_page.read_text()
original = text

HELPERS = r'''
function formatPatientGenderLabel(value?: string) {
  const gender = String(value ?? '').toUpperCase();
  if (gender === 'MALE') return '男';
  if (gender === 'FEMALE') return '女';
  return '未登记';
}

function formatPatientAgeLabel(value?: string) {
  if (!value) return '未登记';
  const birth = new Date(value);
  if (Number.isNaN(birth.getTime())) return '未登记';

  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;

  return age >= 0 && age < 130 ? `${age}岁` : '未登记';
}
'''

if "function formatPatientGenderLabel" not in text:
    anchor = "function formatDate(value?: string) {\n  if (!value) return '-';\n  return new Date(value).toLocaleDateString('zh-CN');\n}\n"
    if anchor in text:
        text = text.replace(anchor, anchor + HELPERS, 1)
    else:
        fallback = "function formatTime(value?: string)"
        idx = text.find(fallback)
        if idx < 0:
            raise SystemExit("Could not find formatDate/formatTime helper location in PatientDetailPage.tsx")
        # Insert immediately before formatTime as a safe fallback.
        text = text[:idx] + HELPERS + "\n" + text[idx:]

NEW_CARD = r'''          <section className="follow-up-patient-contact-card visit-patient-detail-card" aria-label="电话随访患者联系信息">
            <div className="visit-patient-detail-identity">
              <div>
                <span>患者信息</span>
                <h3>{data.patient.name}</h3>
                <p>
                  {formatPatientGenderLabel(data.patient.gender)} · {formatPatientAgeLabel(data.patient.birthDate)} · {data.patient.hospitalPatientId ? `病案号 ${data.patient.hospitalPatientId}` : '病案号未登记'}
                </p>
              </div>
              <strong className="visit-active-count follow-up-contact-badge">电话随访</strong>
            </div>

            <div className="visit-patient-detail-grid">
              <div className="visit-patient-detail-item primary-contact">
                <span>联系电话</span>
                <strong>{data.patient.phone || '未登记'}</strong>
                {data.patient.phone ? <a href={`tel:${data.patient.phone}`}>拨打患者电话</a> : <small>请先补全联系方式</small>}
              </div>
              <div className="visit-patient-detail-item address-item">
                <span>居住地址</span>
                <strong>{data.patient.address || '未登记'}</strong>
                <small>用于核对患者所在社区、电话沟通背景和后续随访安排</small>
              </div>
              <div className="visit-patient-detail-item">
                <span>紧急联系人</span>
                <strong>{data.patient.emergencyContactName || '未登记'}</strong>
                {data.patient.emergencyContactPhone ? <a href={`tel:${data.patient.emergencyContactPhone}`}>{data.patient.emergencyContactPhone}</a> : <small>暂无紧急联系人电话</small>}
              </div>
              <div className="visit-patient-detail-item">
                <span>责任医护</span>
                <strong>医生：{data.patient.responsibleDoctorId || '未分配'}</strong>
                <small>护士：{data.patient.responsibleNurseId || '未分配'}</small>
              </div>
            </div>
          </section>'''


def replace_balanced_contact_card(source: str) -> tuple[str, bool]:
    start_match = re.search(r'<(?P<tag>div|section)\s+className="[^"]*follow-up-patient-contact-card[^"]*"[^>]*>', source)
    if not start_match:
        return source, False

    start = start_match.start()
    start_tag = start_match.group('tag')
    depth = 0
    tag_re = re.compile(r'<(/?)(div|section)\b[^>]*(/?)>')

    for match in tag_re.finditer(source, start):
      closing, tag, self_closing = match.group(1), match.group(2), match.group(3)
      if tag != start_tag:
          continue
      if self_closing:
          continue
      if closing:
          depth -= 1
          if depth == 0:
              return source[:start] + NEW_CARD + source[match.end():], True
      else:
          depth += 1

    return source, False

text, replaced = replace_balanced_contact_card(text)
if not replaced:
    raise SystemExit("Could not find or safely replace follow-up-patient-contact-card in PatientDetailPage.tsx")

if text != original:
    patient_page.write_text(text)
    print(f"Patched {patient_page.relative_to(ROOT)}")
else:
    print("PatientDetailPage.tsx already appears updated.")

CSS_APPEND = r'''

/* Phone follow-up patient contact card: aligned with the hospital-visit tab detail card. */
.patient-follow-up-ledger-panel .follow-up-patient-contact-card.visit-patient-detail-card {
  display: grid;
  gap: 12px;
  margin: 0 0 14px;
  padding: 14px;
  border: 1px solid #bfdbfe;
  border-radius: 18px;
  background: linear-gradient(180deg, #eff6ff, #fff 120px);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
}

.patient-follow-up-ledger-panel .visit-patient-detail-identity {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.patient-follow-up-ledger-panel .visit-patient-detail-identity span {
  display: block;
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.06em;
}

.patient-follow-up-ledger-panel .visit-patient-detail-identity h3 {
  margin: 3px 0 2px;
  color: #0f172a;
  font-size: 22px;
  line-height: 1.2;
}

.patient-follow-up-ledger-panel .visit-patient-detail-identity p {
  margin: 0;
  color: #475569;
  font-size: 13px;
}

.patient-follow-up-ledger-panel .visit-active-count.follow-up-contact-badge {
  flex: 0 0 auto;
  padding: 5px 10px;
  border-radius: 999px;
  background: #ecfdf5;
  color: #047857;
  font-size: 12px;
  white-space: nowrap;
}

.patient-follow-up-ledger-panel .visit-patient-detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px;
}

.patient-follow-up-ledger-panel .visit-patient-detail-item {
  min-width: 0;
  padding: 11px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.86);
}

.patient-follow-up-ledger-panel .visit-patient-detail-item span {
  display: block;
  color: #64748b;
  font-size: 12px;
  font-weight: 800;
}

.patient-follow-up-ledger-panel .visit-patient-detail-item strong {
  display: block;
  margin-top: 4px;
  color: #0f172a;
  font-size: 14px;
  line-height: 1.45;
  word-break: break-word;
}

.patient-follow-up-ledger-panel .visit-patient-detail-item small,
.patient-follow-up-ledger-panel .visit-patient-detail-item a {
  display: inline-block;
  margin-top: 4px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.45;
}

.patient-follow-up-ledger-panel .visit-patient-detail-item a {
  color: #0f766e;
  font-weight: 900;
  text-decoration: none;
}

.patient-follow-up-ledger-panel .visit-patient-detail-item.primary-contact {
  border-color: rgba(15, 118, 110, 0.24);
  background: #f0fdfa;
}

.patient-follow-up-ledger-panel .visit-patient-detail-item.address-item {
  grid-column: span 2;
}

@media (max-width: 760px) {
  .patient-follow-up-ledger-panel .visit-patient-detail-identity {
    display: block;
  }

  .patient-follow-up-ledger-panel .visit-active-count.follow-up-contact-badge {
    display: inline-block;
    margin-top: 8px;
  }

  .patient-follow-up-ledger-panel .visit-patient-detail-item.address-item {
    grid-column: auto;
  }
}
'''

if css_path.exists():
    css = css_path.read_text()
    if "Phone follow-up patient contact card: aligned with the hospital-visit tab detail card" not in css:
        css_path.write_text(css.rstrip() + CSS_APPEND + "\n")
        print(f"Patched {css_path.relative_to(ROOT)}")
    else:
        print("CSS already appears updated.")
else:
    css_path.parent.mkdir(parents=True, exist_ok=True)
    css_path.write_text(CSS_APPEND.lstrip())
    print(f"Created {css_path.relative_to(ROOT)}")
