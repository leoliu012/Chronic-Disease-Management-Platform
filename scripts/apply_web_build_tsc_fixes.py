#!/usr/bin/env python3
"""
apply_web_build_tsc_fixes.py
----------------------------
Idempotent. Fixes the 22 `tsc -b` errors that block `npm run build` in apps/web.

Every edit is anchored on a unique string and is skipped if its result is
already present, so the script is safe to re-run.

Covered files / fixes:
  1. components/PatientEngagementTab.tsx
       - drop unused `useMemo` import (TS6133)
       - drop unused `OutboundAttempt` type import (TS6133)
       - widen openCompose's `prefill` to the open-variant of ComposeState so
         questionnaireType/vitalType/medicationId/reason resolve (TS2339 x4)
  2. components/PatientHospitalVisitTab.tsx
       - remove unused `maskPhone` helper (TS6133)
  3. components/TaskClinicalContextPanel.tsx
       - remove unused `diseaseLabelMap` const (TS6133)
  4. components/VitalTrendChart.tsx
       - remove dead `PRESET_OPTIONS` const (TS6133)
       - drop unused `times` param from buildSeriesPoints + its 2 call sites (TS6133)
  5. pages/HospitalVisitRemindersPage.tsx
       - wrap onClick={loadReminders} so the MouseEvent isn't passed as opts (TS2322)
  6. pages/NurseDashboardPage.tsx
       - remove unused `CreatedTask` type (TS6196) and the unused `createdTask`/
         `taskRes` binding while keeping the api.post side effect (TS6133)
       - guard `getWorkbenchCount` against null `data` (TS18047 x5)
  7. pages/PatientDetailPage.tsx
       - wrap the two onClick={loadTimeline} (TS2322 x2)
       - remove unused `openFollowUpTab` function (TS6133)
       - HospitalRecordsView patientId -> patientId! (TS2322)
  8. utils/taskProcessingContext.ts
       - annotate recursive formatJsonValue's return type as string (TS7023)

Run from repo ROOT (the apps/web project root also works for the relative
paths below since they start with apps/web):
  python3 scripts/apply_web_build_tsc_fixes.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path.cwd()
WEB = ROOT / "apps/web/src"

changed: list[str] = []
skipped: list[str] = []


def fail(msg: str) -> None:
    print(f"[err] {msg}", file=sys.stderr)
    sys.exit(1)


def edit(rel: str, edits: list[tuple[str, str, str]]) -> None:
    """edits: list of (description, old, new). If old missing but new already
    present -> treat as already-applied (skip that edit). If neither -> fail."""
    p = WEB / rel
    if not p.exists():
        fail(f"missing {p} (run from repo root)")
    src = p.read_text(encoding="utf-8")
    file_changed = False
    for desc, old, new in edits:
        if old and old in src:
            if src.count(old) != 1:
                fail(f"{rel}: anchor for '{desc}' not unique ({src.count(old)}x)")
            src = src.replace(old, new, 1)
            file_changed = True
        elif new and new in src:
            # already applied (replacement result present)
            continue
        elif new == "":
            # deletion edit: old already gone -> treat as already applied
            continue
        else:
            fail(f"{rel}: anchor for '{desc}' not found (and result not present)")
    if file_changed:
        p.write_text(src, encoding="utf-8")
        changed.append(rel)
    else:
        skipped.append(rel)


def main() -> None:
    # 1. PatientEngagementTab.tsx
    edit(
        "components/PatientEngagementTab.tsx",
        [
            (
                "drop useMemo + OutboundAttempt imports",
                "import { useCallback, useEffect, useMemo, useState } from 'react';\n"
                "import {\n"
                "  type ContactSummary,\n"
                "  type OutboundMessage,\n"
                "  type OutboundAttempt,\n"
                "  type MessageDetail,",
                "import { useCallback, useEffect, useState } from 'react';\n"
                "import {\n"
                "  type ContactSummary,\n"
                "  type OutboundMessage,\n"
                "  type MessageDetail,",
            ),
            (
                "widen openCompose prefill type",
                "  function openCompose(linkType: LinkType, prefill?: Partial<ComposeState>) {",
                "  function openCompose(linkType: LinkType, prefill?: Partial<Extract<ComposeState, { kind: 'open' }>>) {",
            ),
        ],
    )

    # 2. PatientHospitalVisitTab.tsx
    edit(
        "components/PatientHospitalVisitTab.tsx",
        [
            (
                "remove unused maskPhone",
                "\nfunction maskPhone(value?: string) {\n"
                "  if (!value || value.length < 7) return value ?? '-';\n"
                "  return `${value.slice(0, 3)}****${value.slice(-4)}`;\n"
                "}\n",
                "",  # result: the block is gone
            ),
        ],
    )

    # 3. TaskClinicalContextPanel.tsx
    edit(
        "components/TaskClinicalContextPanel.tsx",
        [
            (
                "remove unused diseaseLabelMap",
                "const diseaseLabelMap: Record<string, string> = {\n"
                "  HYPERTENSION: '高血压',\n"
                "  TYPE_2_DIABETES: '2型糖尿病',\n"
                "  COPD: '慢阻肺',\n"
                "  CORONARY_HEART_DISEASE: '冠心病',\n"
                "  HYPERLIPIDEMIA: '高脂血症',\n"
                "};\n\n"
                "const riskLabelMap",
                "const riskLabelMap",
            ),
        ],
    )

    # 4. VitalTrendChart.tsx
    edit(
        "components/VitalTrendChart.tsx",
        [
            (
                "remove dead PRESET_OPTIONS",
                "\nconst PRESET_OPTIONS: Array<{ value: TrendRangeValue['kind'] extends 'preset' ? never : never; label: string }> = [] as never;\n\n"
                "const PRESET_LABELS",
                "\nconst PRESET_LABELS",
            ),
            (
                "drop times param from buildSeriesPoints signature",
                "function buildSeriesPoints(\n"
                "  vitals: TimelineEvent[],\n"
                "  times: number[],\n"
                "  minTime: number,",
                "function buildSeriesPoints(\n"
                "  vitals: TimelineEvent[],\n"
                "  minTime: number,",
            ),
            (
                "fix systolic call site",
                "buildSeriesPoints(systolicVitals, times, minTime, timeRange, minVal, valRange, padding, chartW, chartH)",
                "buildSeriesPoints(systolicVitals, minTime, timeRange, minVal, valRange, padding, chartW, chartH)",
            ),
            (
                "fix diastolic call site",
                "buildSeriesPoints(diastolicVitals, times, minTime, timeRange, minVal, valRange, padding, chartW, chartH)",
                "buildSeriesPoints(diastolicVitals, minTime, timeRange, minVal, valRange, padding, chartW, chartH)",
            ),
        ],
    )

    # 5. HospitalVisitRemindersPage.tsx
    edit(
        "pages/HospitalVisitRemindersPage.tsx",
        [
            (
                "wrap loadReminders onClick",
                '<button className="secondary-btn" type="button" onClick={loadReminders} disabled={loading}>',
                '<button className="secondary-btn" type="button" onClick={() => loadReminders()} disabled={loading}>',
            ),
        ],
    )

    # 6. NurseDashboardPage.tsx
    edit(
        "pages/NurseDashboardPage.tsx",
        [
            (
                "remove unused CreatedTask type",
                "type CreatedTask = {\n  id: string;\n};\n\ntype HospitalVisitReminder = {",
                "type HospitalVisitReminder = {",
            ),
            (
                "drop createdTask/taskRes binding (keep side effect)",
                "      const taskRes = await api.post(`/patients/${item.patient.id}/tasks`, {\n"
                "        title: item.title.replace(/^风险预警：/, '风险随访：'),\n"
                "        type: 'RISK_ALERT_FOLLOW_UP',\n"
                "        dueAt: dueAt.toISOString(),\n"
                "        assigneeId: nurseId,\n"
                "        relatedAlertId: item.alertId,\n"
                "      });\n\n"
                "      await api.patch(`/risk-alerts/${item.alertId}/in-progress`, {",
                "      await api.post(`/patients/${item.patient.id}/tasks`, {\n"
                "        title: item.title.replace(/^风险预警：/, '风险随访：'),\n"
                "        type: 'RISK_ALERT_FOLLOW_UP',\n"
                "        dueAt: dueAt.toISOString(),\n"
                "        assigneeId: nurseId,\n"
                "        relatedAlertId: item.alertId,\n"
                "      });\n\n"
                "      await api.patch(`/risk-alerts/${item.alertId}/in-progress`, {",
            ),
            (
                "remove leftover createdTask assignment line (if present separately)",
                "      const createdTask = taskRes.data as CreatedTask;\n",
                "",
            ),
            (
                "guard getWorkbenchCount against null data",
                "  function getWorkbenchCount(sectionKey: WorkbenchSectionKey) {\n"
                "    if (sectionKey === 'workItems') return summary?.totalOpen ?? data.summary.pendingTaskCount + data.summary.openRiskAlertCount;",
                "  function getWorkbenchCount(sectionKey: WorkbenchSectionKey) {\n"
                "    if (!data) return summary?.totalOpen ?? 0;\n"
                "    if (sectionKey === 'workItems') return summary?.totalOpen ?? data.summary.pendingTaskCount + data.summary.openRiskAlertCount;",
            ),
        ],
    )

    # 7. PatientDetailPage.tsx
    edit(
        "pages/PatientDetailPage.tsx",
        [
            (
                "wrap loadTimeline onClick (no disabled)",
                '<button className="secondary-btn" type="button" onClick={loadTimeline}>',
                '<button className="secondary-btn" type="button" onClick={() => loadTimeline()}>',
            ),
            (
                "wrap loadTimeline onClick (disabled)",
                '<button className="secondary-btn" type="button" onClick={loadTimeline} disabled={loading}>',
                '<button className="secondary-btn" type="button" onClick={() => loadTimeline()} disabled={loading}>',
            ),
            (
                "remove unused openFollowUpTab",
                "  function openFollowUpTab(_taskId?: string) {\n"
                "    const next = new URLSearchParams(searchParams);\n"
                "    next.set('workspace', 'follow-up');\n"
                "    next.delete('taskPanel');\n"
                "    next.delete('taskId');\n"
                "    next.delete('mode');\n"
                "    next.delete('followUpTaskId');\n"
                "    setSearchParams(next, { replace: false });\n"
                "    setTaskPanelOpen(false);\n"
                "    setActiveWorkspace('follow-up');\n"
                "    setFollowUpFormOpen(true);\n"
                "    primeFollowUpDraft();\n"
                "  }\n\n"
                "  function resetFollowUpForm() {",
                "  function resetFollowUpForm() {",
            ),
            (
                "HospitalRecordsView patientId non-null",
                "<HospitalRecordsView patientId={patientId} />",
                "<HospitalRecordsView patientId={patientId!} />",
            ),
        ],
    )

    # 8. taskProcessingContext.ts
    edit(
        "utils/taskProcessingContext.ts",
        [
            (
                "annotate formatJsonValue return type",
                "function formatJsonValue(value: unknown) {",
                "function formatJsonValue(value: unknown): string {",
            ),
        ],
    )

    print("[done] web build tsc fixes")
    if changed:
        print("  patched:")
        for c in dict.fromkeys(changed):
            print(f"    - {c}")
    if skipped:
        print("  already-applied (skipped):")
        for s in dict.fromkeys(skipped):
            print(f"    - {s}")


if __name__ == "__main__":
    main()
