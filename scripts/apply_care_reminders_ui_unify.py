#!/usr/bin/env python3
"""
apply_care_reminders_ui_unify.py
--------------------------------
Idempotent. Two parts:

  1. PatientDetailPage.tsx — fix the broken "查看 / 修改用药计划 / 指标监测" jump
     from the care-reminders panel, and make it auto-expand the bound plan's
     inline edit form:
       a) add the module-level `scrollPlanCardIntoView` helper;
       b) add the `focusPlanFromReminder` callback inside the component;
       c) give the medication + monitoring plan cards stable ids
          (`med-card-<id>` / `mon-card-<id>`) so we can scroll to them;
       d) pass `onNavigateToSource={focusPlanFromReminder}` to <CareRemindersPanel/>.
     (Root cause of "点击没反应": the panel's button called
      `onNavigateToSource?.(...)` but the host never passed that prop, so the
      optional-chaining no-op'd.)

  2. patient-engagement-admin-tab.css — append the shared classes the rewritten
     CareRemindersPanel / CareRemindersPage use (banner-ok, compose grid, page
     header, and the jump-flash highlight).

The two rewritten files (CareRemindersPanel.tsx, CareRemindersPage.tsx) ship as
full-file replacements in this patch.

Run from repo ROOT:
  python3 scripts/apply_care_reminders_ui_unify.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path.cwd()
PDP = ROOT / "apps/web/src/pages/PatientDetailPage.tsx"
CSS = ROOT / "apps/web/src/patient-engagement-admin-tab.css"

changed: list[str] = []


def fail(msg: str) -> None:
    print(f"[err] {msg}", file=sys.stderr)
    sys.exit(1)


def need(p: Path) -> str:
    if not p.exists():
        fail(f"missing {p} (run from repo root)")
    return p.read_text(encoding="utf-8")


def replace_once(src: str, old: str, new: str, label: str) -> str:
    if old not in src:
        fail(f"anchor not found while patching {label}")
    if src.count(old) != 1:
        fail(f"anchor not unique ({src.count(old)}x) while patching {label}")
    return src.replace(old, new, 1)


def patch_patient_detail() -> None:
    src = need(PDP)
    local = False

    # ---- (a) module-level scrollPlanCardIntoView helper --------------------
    if "function scrollPlanCardIntoView(" not in src:
        anchor = (
            "function formatDate(value?: string) {\n"
            "  if (!value) return '-';\n"
            "  return new Date(value).toLocaleDateString('zh-CN');\n"
            "}\n"
        )
        helper = (
            anchor
            + "\n"
            "// care-reminders-jump-v1: scroll a plan card into view and briefly highlight\n"
            "// it after a cross-workspace jump. Retries on the next frame because the\n"
            "// target workspace may still be mounting when first called.\n"
            "function scrollPlanCardIntoView(elementId: string, attempt = 0) {\n"
            "  const el = document.getElementById(elementId);\n"
            "  if (!el) {\n"
            "    if (attempt < 8) {\n"
            "      window.requestAnimationFrame(() => scrollPlanCardIntoView(elementId, attempt + 1));\n"
            "    }\n"
            "    return;\n"
            "  }\n"
            "  el.scrollIntoView({ behavior: 'smooth', block: 'center' });\n"
            "  el.classList.add('care-reminders-jump-flash');\n"
            "  window.setTimeout(() => el.classList.remove('care-reminders-jump-flash'), 1800);\n"
            "}\n"
        )
        src = replace_once(src, anchor, helper, "scrollPlanCardIntoView helper")
        local = True

    # ---- (b) focusPlanFromReminder callback --------------------------------
    if "focusPlanFromReminder" not in src:
        anchor = (
            "    // Do NOT toggle the bottom \"create-new\" form here, and do NOT scroll\n"
            "    // to page-top — the inline form expands beneath the card the user\n"
            "    // just clicked, so the click anchor stays in view.\n"
            "  }\n\n"
            "  async function submitMedication(event: FormEvent) {"
        )
        if anchor not in src:
            fail("focusPlanFromReminder: startEditMedication/submitMedication anchor not found")
        insert = (
            "    // Do NOT toggle the bottom \"create-new\" form here, and do NOT scroll\n"
            "    // to page-top — the inline form expands beneath the card the user\n"
            "    // just clicked, so the click anchor stays in view.\n"
            "  }\n\n"
            "  // care-reminders-jump-v1: invoked from CareRemindersPanel's \"查看/修改用药计划 /\n"
            "  // 查看/修改指标监测\" buttons. Switch to the owning workspace, force-open the\n"
            "  // matching plan's inline edit form (NOT a toggle — always expand), and scroll\n"
            "  // the card into view. If the bound plan is stopped/inactive, reveal history so\n"
            "  // it is actually rendered before we try to focus it.\n"
            "  const focusPlanFromReminder = useCallback(\n"
            "    (sourceType: string, sourceId: string | null) => {\n"
            "      if (!sourceId) {\n"
            "        if (sourceType === 'MEDICATION') setActiveWorkspace('medication');\n"
            "        else if (sourceType === 'VITAL') setActiveWorkspace('monitoring');\n"
            "        return;\n"
            "      }\n"
            "      if (sourceType === 'MEDICATION') {\n"
            "        const item = medicationTimeline.find((it) => it.data?.id === sourceId);\n"
            "        if (item && item.data?.isActive === false) setShowInactiveMedications(true);\n"
            "        setActiveWorkspace('medication');\n"
            "        setEditingMedicationId(null);\n"
            "        if (item?.data) {\n"
            "          window.requestAnimationFrame(() => {\n"
            "            startEditMedication(item.data);\n"
            "            scrollPlanCardIntoView(`med-card-${sourceId}`);\n"
            "          });\n"
            "        } else {\n"
            "          window.requestAnimationFrame(() => scrollPlanCardIntoView(`med-card-${sourceId}`));\n"
            "        }\n"
            "      } else if (sourceType === 'VITAL') {\n"
            "        const item = monitoringPlanTimeline.find((it) => it.data?.id === sourceId);\n"
            "        if (item && item.data?.isActive === false) setShowInactiveMonitoringPlans(true);\n"
            "        setActiveWorkspace('monitoring');\n"
            "        setEditingMonitoringPlanId(null);\n"
            "        if (item?.data) {\n"
            "          window.requestAnimationFrame(() => {\n"
            "            startEditMonitoringPlan(item.data);\n"
            "            scrollPlanCardIntoView(`mon-card-${sourceId}`);\n"
            "          });\n"
            "        } else {\n"
            "          window.requestAnimationFrame(() => scrollPlanCardIntoView(`mon-card-${sourceId}`));\n"
            "        }\n"
            "      }\n"
            "    },\n"
            "    [medicationTimeline, monitoringPlanTimeline],\n"
            "  );\n\n"
            "  async function submitMedication(event: FormEvent) {"
        )
        src = src.replace(anchor, insert, 1)
        local = True

    # ---- (c) stable ids on the two plan cards ------------------------------
    # Both <article> blocks are textually identical; disambiguate via the
    # field rendered just below (medicationName vs displayName). We instead key
    # off the surrounding isInlineEditing variable which is shared, so add the
    # id by matching each card's following <h4> content.
    if "med-card-${item.data.id}" not in src:
        # medication card: the <article> immediately precedes a medicationName <h4>.
        med_anchor = (
            "                    <article\n"
            "                      className={`task-inline-card medication-inline-card${isInlineEditing ? ' is-inline-editing' : ''}`}\n"
            "                      key={item.data?.id ?? `${item.time}-${item.title}`}\n"
            "                    >\n"
            "                      <div className=\"task-inline-card-topline\">\n"
            "                        <span className=\"badge\">{dataSourceLabelMap"
        )
        med_new = (
            "                    <article\n"
            "                      className={`task-inline-card medication-inline-card${isInlineEditing ? ' is-inline-editing' : ''}`}\n"
            "                      key={item.data?.id ?? `${item.time}-${item.title}`}\n"
            "                      id={item.data?.id ? `med-card-${item.data.id}` : undefined}\n"
            "                    >\n"
            "                      <div className=\"task-inline-card-topline\">\n"
            "                        <span className=\"badge\">{dataSourceLabelMap"
        )
        if med_anchor in src:
            src = src.replace(med_anchor, med_new, 1)
            local = True
        else:
            fail("medication card anchor not found (dataSourceLabelMap topline)")

    if "mon-card-${item.data.id}" not in src:
        # monitoring card: topline badge uses sourcePreset/diseaseLabelMap.
        mon_anchor = (
            "                    <article\n"
            "                      className={`task-inline-card medication-inline-card${isInlineEditing ? ' is-inline-editing' : ''}`}\n"
            "                      key={item.data?.id ?? `${item.time}-${item.title}`}\n"
            "                    >\n"
            "                      <div className=\"task-inline-card-topline\">\n"
            "                        <span className=\"badge\">{item.data?.sourcePreset"
        )
        mon_new = (
            "                    <article\n"
            "                      className={`task-inline-card medication-inline-card${isInlineEditing ? ' is-inline-editing' : ''}`}\n"
            "                      key={item.data?.id ?? `${item.time}-${item.title}`}\n"
            "                      id={item.data?.id ? `mon-card-${item.data.id}` : undefined}\n"
            "                    >\n"
            "                      <div className=\"task-inline-card-topline\">\n"
            "                        <span className=\"badge\">{item.data?.sourcePreset"
        )
        if mon_anchor in src:
            src = src.replace(mon_anchor, mon_new, 1)
            local = True
        else:
            fail("monitoring card anchor not found (sourcePreset topline)")

    # ---- (d) pass onNavigateToSource to the panel --------------------------
    if "onNavigateToSource={focusPlanFromReminder}" not in src:
        old = '<CareRemindersPanel patientId={patientId!} canEdit={true} />'
        new = '<CareRemindersPanel patientId={patientId!} canEdit={true} onNavigateToSource={focusPlanFromReminder} />'
        src = replace_once(src, old, new, "CareRemindersPanel onNavigateToSource")
        local = True

    if local:
        PDP.write_text(src, encoding="utf-8")
        changed.append("PatientDetailPage.tsx (care-reminders jump → auto-expand plan)")
        print("[ok] patched PatientDetailPage.tsx (jump fix + auto-expand)")
    else:
        print("[skip] PatientDetailPage.tsx already patched")


CSS_BLOCK = """

/* ============================================================================
   care-reminders-ui-unify-v1 — shared additions for the care-reminders panel
   and standalone page, plus the cross-workspace "查看/修改" jump highlight.
============================================================================ */

.pe-admin-banner-ok {
  background: #ecfdf5;
  color: #065f46;
  border: 1px solid #a7f3d0;
}

/* page header for the standalone 慢病提醒中心 route */
.pe-admin-page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.pe-admin-page-header h2 {
  margin: 0;
  font-size: 20px;
  color: #0f172a;
}
.pe-admin-page-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* direct-message composer */
.pe-admin-compose-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 640px;
}

/* care-reminders-jump-v1: brief highlight when a plan card is focused after a
   jump from the care-reminders panel. */
.care-reminders-jump-flash {
  animation: care-reminders-jump-flash-kf 1.8s ease-out;
}
@keyframes care-reminders-jump-flash-kf {
  0% { box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.55); background: #eff6ff; }
  100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); background: transparent; }
}
"""


def patch_css() -> None:
    src = need(CSS)
    if "care-reminders-ui-unify-v1" in src:
        print("[skip] CSS already has care-reminders-ui-unify additions")
        return
    if not src.endswith("\n"):
        src += "\n"
    src += CSS_BLOCK
    CSS.write_text(src, encoding="utf-8")
    changed.append("patient-engagement-admin-tab.css (+care-reminders classes)")
    print("[ok] appended care-reminders classes to patient-engagement-admin-tab.css")


def main() -> None:
    patch_patient_detail()
    patch_css()
    if changed:
        print("\n[done] applied:")
        for c in changed:
            print(f"     - {c}")
        print(
            "\nThe rewritten CareRemindersPanel.tsx + CareRemindersPage.tsx ship as "
            "full-file replacements in this patch. Rebuild the web app:"
            "\n  cd apps/web && npm run build   (or restart the dev server)"
        )
    else:
        print("\n[done] nothing to change; already applied.")


if __name__ == "__main__":
    main()
