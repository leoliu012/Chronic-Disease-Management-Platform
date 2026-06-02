#!/usr/bin/env python3
"""
apply_care_reminders_pe_smoke_fix.py
------------------------------------
Fixes the 4 remaining smoke failures after the v3.1 + v3.2 apply. Idempotent.

  A. care-reminder-schedule.service.ts — listForPatient lost its v3.1
     `sourceSummary` enrichment (CR smoke #3 returned "none"). Re-applied.

  C. admin-patient-engagement.controller.ts — message list date-range filter was
     asymmetric: a bare-date `to` got end-of-day (local) but a bare-date `from`
     was parsed as UTC midnight, so on a UTC+N server the window started N hours
     late and "today" rows created before that boundary were dropped
     (PE smoke #11 returned today=0). Now a bare-date `from` is start-of-day local,
     matching `to`.

  D. PatientEngagementTab.tsx — a doc comment literally listed the removed button
     labels (改短信 / 改服务号 / 标记手动发送), which tripped the smoke's
     "buttons removed from source" regex (PE smoke #12 false positive). The buttons
     themselves were already gone; the comment is reworded.

The smoke runners themselves are shipped as full-file replacements in this patch
(care-reminders fix B = paginated /messages; and a tightened PE #12 regex):
  - apps/api/scripts/smoke-care-reminders.js
  - apps/api/scripts/smoke-patient-engagement.js

Run from repo root:
  python3 scripts/apply_care_reminders_pe_smoke_fix.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path.cwd()
SCHED = ROOT / "apps/api/src/care-reminders/care-reminder-schedule.service.ts"
ADMIN = ROOT / "apps/api/src/patient-engagement/admin-patient-engagement.controller.ts"
TAB = ROOT / "apps/web/src/components/PatientEngagementTab.tsx"

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


# ---------------------------------------------------------------------------
# A) schedule service — re-apply sourceSummary
# ---------------------------------------------------------------------------
def fix_schedule_sourcesummary() -> None:
    src = need(SCHED)
    if "sourceSummary" in src:
        print("[skip] schedule service already returns sourceSummary")
        return

    old = (
        "  async listForPatient(patientId: string) {\n"
        "    return this.prisma.careReminderSchedule.findMany({\n"
        "      where: { patientId },\n"
        "      orderBy: { createdAt: 'desc' },\n"
        "      include: { _count: { select: { occurrences: true } } },\n"
        "    });\n"
        "  }"
    )
    new = (
        "  async listForPatient(patientId: string) {\n"
        "    const schedules = await this.prisma.careReminderSchedule.findMany({\n"
        "      where: { patientId },\n"
        "      orderBy: { createdAt: 'desc' },\n"
        "      include: { _count: { select: { occurrences: true } } },\n"
        "    });\n"
        "    // v3.1: attach a small source summary so the bound-plan view can render\n"
        "    // 药品名/剂量 (MEDICATION) or 指标名/单位 (VITAL) without extra round-trips.\n"
        "    return Promise.all(\n"
        "      schedules.map(async (s) => ({\n"
        "        ...s,\n"
        "        sourceSummary: await this.buildSourceSummary(s),\n"
        "      })),\n"
        "    );\n"
        "  }\n\n"
        "  private async buildSourceSummary(s: {\n"
        "    sourceType: string;\n"
        "    sourceId: string | null;\n"
        "    payload: unknown;\n"
        "  }): Promise<{\n"
        "    type: string;\n"
        "    id: string | null;\n"
        "    title: string;\n"
        "    subtitle: string | null;\n"
        "    status: string;\n"
        "  } | null> {\n"
        "    const payload: any = s.payload || {};\n"
        "    if (s.sourceType === 'MEDICATION') {\n"
        "      const id = s.sourceId || payload.medicationId || null;\n"
        "      if (id) {\n"
        "        const med = await this.prisma.medicationRecord.findUnique({ where: { id } });\n"
        "        if (med) {\n"
        "          return {\n"
        "            type: 'MEDICATION',\n"
        "            id: med.id,\n"
        "            title: med.medicationName,\n"
        "            subtitle: [med.dosage, med.frequency].filter(Boolean).join(' · ') || null,\n"
        "            status: med.isActive ? 'ACTIVE' : 'INACTIVE',\n"
        "          };\n"
        "        }\n"
        "      }\n"
        "      return {\n"
        "        type: 'MEDICATION',\n"
        "        id,\n"
        "        title: payload.medicationName || '用药计划',\n"
        "        subtitle: payload.dosage || null,\n"
        "        status: 'UNKNOWN',\n"
        "      };\n"
        "    }\n"
        "    if (s.sourceType === 'VITAL') {\n"
        "      const id = s.sourceId || payload.vitalPlanId || null;\n"
        "      if (id) {\n"
        "        const plan = await this.prisma.vitalMonitoringPlan.findUnique({ where: { id } });\n"
        "        if (plan) {\n"
        "          return {\n"
        "            type: 'VITAL',\n"
        "            id: plan.id,\n"
        "            title: plan.displayName || plan.vitalType,\n"
        "            subtitle: plan.unit || null,\n"
        "            status: plan.isActive ? 'ACTIVE' : 'INACTIVE',\n"
        "          };\n"
        "        }\n"
        "      }\n"
        "      return {\n"
        "        type: 'VITAL',\n"
        "        id,\n"
        "        title: payload.vitalType || '指标监测',\n"
        "        subtitle: null,\n"
        "        status: 'UNKNOWN',\n"
        "      };\n"
        "    }\n"
        "    return null;\n"
        "  }"
    )
    src = replace_once(src, old, new, "schedule sourceSummary")
    SCHED.write_text(src, encoding="utf-8")
    changed.append("care-reminder-schedule.service.ts (re-added sourceSummary)")
    print("[ok] re-added sourceSummary to care-reminder-schedule.service.ts")


# ---------------------------------------------------------------------------
# C) admin controller — symmetric bare-date from handling
# ---------------------------------------------------------------------------
def fix_admin_date_filter() -> None:
    src = need(ADMIN)
    if "// v3.2-fix: bare-date from = start-of-day" in src:
        print("[skip] admin date filter already symmetric")
        return

    old = (
        "    if (query.from || query.to) {\n"
        "      where.createdAt = {};\n"
        "      if (query.from) where.createdAt.gte = new Date(query.from);\n"
        "      if (query.to) {\n"
        "        // inclusive end-of-day if a bare date was supplied\n"
        "        const to = new Date(query.to);\n"
        "        if (/^\\d{4}-\\d{2}-\\d{2}$/.test(query.to)) to.setHours(23, 59, 59, 999);\n"
        "        where.createdAt.lte = to;\n"
        "      }\n"
        "    }"
    )
    new = (
        "    if (query.from || query.to) {\n"
        "      where.createdAt = {};\n"
        "      if (query.from) {\n"
        "        // v3.2-fix: bare-date from = start-of-day (server-local), matching the\n"
        "        // end-of-day handling on `to`. Parsing 'YYYY-MM-DD' via new Date() yields\n"
        "        // UTC midnight, which on a UTC+N server starts the window N hours late and\n"
        "        // silently drops early-in-the-day rows.\n"
        "        const from = new Date(query.from);\n"
        "        if (/^\\d{4}-\\d{2}-\\d{2}$/.test(query.from)) from.setHours(0, 0, 0, 0);\n"
        "        where.createdAt.gte = from;\n"
        "      }\n"
        "      if (query.to) {\n"
        "        // inclusive end-of-day if a bare date was supplied\n"
        "        const to = new Date(query.to);\n"
        "        if (/^\\d{4}-\\d{2}-\\d{2}$/.test(query.to)) to.setHours(23, 59, 59, 999);\n"
        "        where.createdAt.lte = to;\n"
        "      }\n"
        "    }"
    )
    src = replace_once(src, old, new, "admin date filter")
    ADMIN.write_text(src, encoding="utf-8")
    changed.append("admin-patient-engagement.controller.ts (symmetric date filter)")
    print("[ok] fixed admin-patient-engagement.controller.ts (symmetric bare-date from)")


# ---------------------------------------------------------------------------
# D) tab — reword the comment that listed removed button labels
# ---------------------------------------------------------------------------
def fix_tab_comment() -> None:
    src = need(TAB)
    old = ' * v3.2 去掉了"改短信 / 改服务号 / 标记手动发送"等工程化操作; "撤销"改为"使链接失效".'
    if old not in src:
        # Either already reworded, or comment differs. Only act on the exact known line.
        if "等工程化的发送操作" in src or "工程化操作（按渠道改发、人工标记）" in src:
            print("[skip] tab comment already reworded")
            return
        print("[skip] tab comment line not found (already reworded?)")
        return
    new = (
        " * v3.2 去掉了按渠道改发、人工标记发送等工程化操作（仅保留再次发送）;"
        ' 原“撤销”改为“使链接失效”.'
    )
    src = src.replace(old, new, 1)
    TAB.write_text(src, encoding="utf-8")
    changed.append("PatientEngagementTab.tsx (reworded comment)")
    print("[ok] reworded comment in PatientEngagementTab.tsx")


def main() -> None:
    fix_schedule_sourcesummary()
    fix_admin_date_filter()
    fix_tab_comment()
    if changed:
        print("\n[done] code fixes applied:")
        for c in changed:
            print(f"     - {c}")
        print(
            "\nThe two smoke runners are also replaced by this patch "
            "(paginated /messages + tightened #12 regex)."
            "\nRestart the API (npm run start:dev) before re-running the smokes."
        )
    else:
        print("\n[done] no code changes needed; smoke runners still replaced by the patch.")


if __name__ == "__main__":
    main()
