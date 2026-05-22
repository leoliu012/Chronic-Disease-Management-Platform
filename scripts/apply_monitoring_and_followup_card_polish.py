#!/usr/bin/env python3
"""
Apply three patient-detail UI polishes:

  1. 电话随访 tab patient detail card → match 到院提醒
     (visit-patient-detail-card layout, no more 4-column override).
  2. 健康指标与打卡计划 tab → drop the explanatory `section-hint`
     "先查看已有指标和医院配置的打卡计划；新增操作通过按钮展开，提交后自动收起。"
  3. 健康指标与打卡计划 tab → replace the flat 8-card vital list with
     grouped trend chart panels, mirroring the 全流程记录 implementation:
        - 收缩压 + 舒张压 are merged into a single BloodPressureTrendChart panel.
        - 血糖 / 体重 / 心率 / 血氧 each get a VitalTrendChart panel.

Idempotent: re-running after a successful application is a no-op.

Run from repo root:
    python3 scripts/apply_monitoring_and_followup_card_polish.py "$PWD"
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd().resolve()
PAGE = ROOT / "apps" / "web" / "src" / "pages" / "PatientDetailPage.tsx"
POLISH_CSS = ROOT / "apps" / "web" / "src" / "patient-detail-task-ux-polish.css"

if not PAGE.exists():
    raise SystemExit(f"Cannot find {PAGE.relative_to(ROOT)} under {ROOT}")

changed: list[str] = []


def write_if_changed(path: Path, before: str, after: str) -> None:
    if before != after:
        path.write_text(after, encoding="utf-8")
        changed.append(str(path.relative_to(ROOT)))


# ---------------------------------------------------------------------------
# PatientDetailPage.tsx
# ---------------------------------------------------------------------------
text = PAGE.read_text(encoding="utf-8")
original_text = text

# --- Patch 1: align 电话随访 patient detail card with 到院提醒 -----------------
OLD_CARD_OPEN = (
    '                    <section className="follow-up-patient-contact-card '
    'visit-patient-detail-card" aria-label="电话随访患者联系信息">\n'
)
NEW_CARD_OPEN = (
    '          <section className="visit-patient-detail-card" '
    'aria-label="电话随访患者联系信息">\n'
)

OLD_BADGE = (
    '              <strong className="visit-active-count follow-up-contact-badge">'
    "电话随访</strong>\n"
)
NEW_BADGE = (
    '              <strong className="visit-active-count">电话随访</strong>\n'
)

patch1_already = (
    'className="visit-patient-detail-card" aria-label="电话随访患者联系信息"'
    in text
    and "follow-up-patient-contact-card" not in text
)

if OLD_CARD_OPEN in text:
    text = text.replace(OLD_CARD_OPEN, NEW_CARD_OPEN, 1)
    print("Patch 1: aligned 电话随访 patient detail card with 到院提醒.")
elif patch1_already:
    print("Patch 1: already applied; skipping.")
else:
    raise SystemExit(
        "Patch 1 failed: could not locate the follow-up patient detail card "
        "<section> opening tag."
    )

if OLD_BADGE in text:
    text = text.replace(OLD_BADGE, NEW_BADGE, 1)
elif (
    '              <strong className="visit-active-count">电话随访</strong>\n' in text
):
    # already patched
    pass

# --- Patch 2: drop the section-hint paragraph in 健康指标与打卡计划 ------------
HINT_LINE = (
    '                <p className="section-hint">先查看已有指标和医院配置的打卡计划'
    "；新增操作通过按钮展开，提交后自动收起。</p>\n"
)
if HINT_LINE in text:
    text = text.replace(HINT_LINE, "", 1)
    print("Patch 2: removed monitoring tab section hint.")
else:
    print("Patch 2: section hint already absent; skipping.")

# --- Patch 3: grouped trend charts instead of the flat 8-card vital list -----
OLD_LIST = (
    "              {vitalRecordTimeline.length === 0 ? (\n"
    '                <div className="empty-state task-empty-state">'
    "当前患者暂无健康指标记录。</div>\n"
    "              ) : (\n"
    '                <div className="task-inline-grid">\n'
    "                  {vitalRecordTimeline.slice(0, 8).map((item) => (\n"
    '                    <article className="task-inline-card metric-inline-card"'
    " key={item.data?.id ?? `${item.time}-${item.title}`}>\n"
    '                      <div className="task-inline-card-topline">\n'
    '                        <span className="badge">'
    "{vitalTypeLabelMap[item.data?.type] ?? item.data?.type ?? '指标'}</span>\n"
    "                        <span className={item.data?.isAbnormal ? "
    "'status-badge status-high' : 'status-badge status-low'}>"
    "{item.data?.isAbnormal ? '异常' : '正常'}</span>\n"
    "                      </div>\n"
    "                      <h4>{item.data?.value ?? '-'} {item.data?.unit ?? ''}</h4>\n"
    "                      <p>测量时间：{formatTime(item.data?.measuredAt ?? "
    "item.time)} · 来源：{dataSourceLabelMap[item.data?.dataSource] ?? "
    "item.data?.dataSource ?? '-'}</p>\n"
    "                      {item.data?.note && "
    "<p>{localizeBackendText(item.data.note)}</p>}\n"
    "                    </article>\n"
    "                  ))}\n"
    "                </div>\n"
    "              )}\n"
)

NEW_LIST = (
    "              {vitalRecordTimeline.length === 0 ? (\n"
    '                <div className="empty-state task-empty-state">'
    "当前患者暂无健康指标记录。</div>\n"
    "              ) : (() => {\n"
    "                const systolicVitals = vitalRecordTimeline.filter("
    "(item) => item.data?.type === 'SYSTOLIC_BP');\n"
    "                const diastolicVitals = vitalRecordTimeline.filter("
    "(item) => item.data?.type === 'DIASTOLIC_BP');\n"
    "                const glucoseVitals = vitalRecordTimeline.filter("
    "(item) => item.data?.type === 'BLOOD_GLUCOSE');\n"
    "                const weightVitals = vitalRecordTimeline.filter("
    "(item) => item.data?.type === 'WEIGHT');\n"
    "                const heartRateVitals = vitalRecordTimeline.filter("
    "(item) => item.data?.type === 'HEART_RATE');\n"
    "                const spo2Vitals = vitalRecordTimeline.filter("
    "(item) => item.data?.type === 'SPO2');\n"
    "                return (\n"
    '                  <div className="metric-trend-stack">\n'
    "                    {(systolicVitals.length > 0 || diastolicVitals.length > 0) && (\n"
    "                      <BloodPressureTrendChart\n"
    "                        systolicVitals={systolicVitals}\n"
    "                        diastolicVitals={diastolicVitals}\n"
    '                        unit="mmHg"\n'
    "                        eventMarkers={vitalEventMarkers}\n"
    "                        formatTime={formatTime}\n"
    "                      />\n"
    "                    )}\n"
    "                    {glucoseVitals.length > 0 && (\n"
    "                      <VitalTrendChart\n"
    "                        vitals={glucoseVitals}\n"
    '                        vitalType="BLOOD_GLUCOSE"\n'
    '                        vitalTypeName="血糖"\n'
    '                        unit="mmol/L"\n'
    "                        thresholdHigh={10}\n"
    "                        thresholdLow={3.9}\n"
    "                        eventMarkers={vitalEventMarkers}\n"
    "                        formatTime={formatTime}\n"
    "                      />\n"
    "                    )}\n"
    "                    {weightVitals.length > 0 && (\n"
    "                      <VitalTrendChart\n"
    "                        vitals={weightVitals}\n"
    '                        vitalType="WEIGHT"\n'
    '                        vitalTypeName="体重"\n'
    '                        unit="kg"\n'
    "                        eventMarkers={vitalEventMarkers}\n"
    "                        formatTime={formatTime}\n"
    "                      />\n"
    "                    )}\n"
    "                    {heartRateVitals.length > 0 && (\n"
    "                      <VitalTrendChart\n"
    "                        vitals={heartRateVitals}\n"
    '                        vitalType="HEART_RATE"\n'
    '                        vitalTypeName="心率"\n'
    '                        unit="bpm"\n'
    "                        thresholdHigh={120}\n"
    "                        thresholdLow={50}\n"
    "                        eventMarkers={vitalEventMarkers}\n"
    "                        formatTime={formatTime}\n"
    "                      />\n"
    "                    )}\n"
    "                    {spo2Vitals.length > 0 && (\n"
    "                      <VitalTrendChart\n"
    "                        vitals={spo2Vitals}\n"
    '                        vitalType="SPO2"\n'
    '                        vitalTypeName="血氧"\n'
    '                        unit="%"\n'
    "                        thresholdLow={95}\n"
    "                        eventMarkers={vitalEventMarkers}\n"
    "                        formatTime={formatTime}\n"
    "                      />\n"
    "                    )}\n"
    "                  </div>\n"
    "                );\n"
    "              })()}\n"
)

if OLD_LIST in text:
    text = text.replace(OLD_LIST, NEW_LIST, 1)
    print("Patch 3: replaced flat vital cards with grouped trend charts.")
elif "const systolicVitals = vitalRecordTimeline.filter" in text:
    print("Patch 3: already applied; skipping.")
else:
    raise SystemExit(
        "Patch 3 failed: could not locate the vital records inline card block. "
        "Was it already customized?"
    )

write_if_changed(PAGE, original_text, text)


# ---------------------------------------------------------------------------
# patient-detail-task-ux-polish.css cleanup + new helper rule
# ---------------------------------------------------------------------------
ORPHAN_CSS = (
    ".follow-up-patient-contact-card {\n"
    "  display: grid;\n"
    "  grid-template-columns: 1.05fr 1fr 1.45fr 1fr;\n"
    "  gap: 10px;\n"
    "  padding: 12px;\n"
    "  border: 1px solid #dbeafe;\n"
    "  border-radius: 16px;\n"
    "  background: linear-gradient(135deg, #f8fbff 0%, #eef6ff 100%);\n"
    "}\n"
    "\n"
    ".follow-up-patient-contact-card > div {\n"
    "  min-width: 0;\n"
    "  padding: 10px 12px;\n"
    "  border: 1px solid rgba(148, 163, 184, 0.24);\n"
    "  border-radius: 12px;\n"
    "  background: rgba(255, 255, 255, 0.78);\n"
    "}\n"
    "\n"
    ".follow-up-patient-contact-card span {\n"
    "  display: block;\n"
    "  margin-bottom: 4px;\n"
    "  color: #64748b;\n"
    "  font-size: 12px;\n"
    "  font-weight: 800;\n"
    "}\n"
    "\n"
    ".follow-up-patient-contact-card strong {\n"
    "  display: block;\n"
    "  overflow-wrap: anywhere;\n"
    "  color: #0f172a;\n"
    "  font-size: 14px;\n"
    "  line-height: 1.4;\n"
    "}\n"
    "\n"
    ".follow-up-patient-contact-card small,\n"
    ".follow-up-patient-contact-card a {\n"
    "  display: inline-block;\n"
    "  margin-top: 4px;\n"
    "  color: #2563eb;\n"
    "  font-size: 12px;\n"
    "  font-weight: 700;\n"
    "  text-decoration: none;\n"
    "}\n"
)

STACK_CSS_MARKER = "/* Health indicator trend stack (健康指标与打卡计划) */"
STACK_CSS = (
    "\n"
    + STACK_CSS_MARKER
    + "\n"
    + ".metric-trend-stack {\n"
    "  display: grid;\n"
    "  gap: 14px;\n"
    "  margin-top: 4px;\n"
    "}\n"
)

if POLISH_CSS.exists():
    css_before = POLISH_CSS.read_text(encoding="utf-8")
    css_text = css_before

    if ORPHAN_CSS in css_text:
        css_text = css_text.replace(ORPHAN_CSS, "", 1)
        print(
            "Removed orphan .follow-up-patient-contact-card rules from "
            f"{POLISH_CSS.relative_to(ROOT)}."
        )
    else:
        print(
            f"{POLISH_CSS.relative_to(ROOT)}: orphan rules already absent; skipping."
        )

    if STACK_CSS_MARKER not in css_text:
        css_text = css_text.rstrip() + "\n" + STACK_CSS
        print(
            f"Appended .metric-trend-stack helper rule to "
            f"{POLISH_CSS.relative_to(ROOT)}."
        )
    else:
        print(
            f"{POLISH_CSS.relative_to(ROOT)}: .metric-trend-stack rule already "
            "present; skipping."
        )

    write_if_changed(POLISH_CSS, css_before, css_text)
else:
    print(
        f"Note: {POLISH_CSS.relative_to(ROOT)} does not exist; "
        "skipping CSS cleanup."
    )

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print()
print("Done applying monitoring & follow-up card polishes.")
if changed:
    print("Changed files:")
    for item in changed:
        print(f"  - {item}")
else:
    print("No files changed.")
