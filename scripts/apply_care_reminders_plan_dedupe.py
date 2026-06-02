#!/usr/bin/env python3
"""
apply_care_reminders_plan_dedupe.py
-----------------------------------
Idempotent. Fixes the "one-a-day plan shows 4 reminders" problem and the
schedule-level UX, plus the BLOOD_PRESSURE-not-localized / pure-text name issues.

Backend (this patcher edits in place):
  1. care-reminder-schedule.service.ts
       + createOrUpdateForSource(): dedupe a plan-bound schedule by
         (patientId, sourceType, sourceId) — UPDATE the existing row instead of
         stacking a new one (re-activates a paused/cancelled binding).
       + cancelSchedule(): delete a schedule (occurrences cascade) for the
         schedule-level "取消计划" action.
  2. care-reminders.controller.ts
       - medication/vital schedule create endpoints now call
         createOrUpdateForSource (dedupe).
       + POST /care-reminders/schedules/:id/cancel route (with audit).

Frontend (shipped as full-file replacements in this patch, not edited here):
  - components/CareRemindersPanel.tsx  (color-tag names via EntityName; schedule
    actions = 查看/修改 + 取消计划, no pause; corrected copy; localized vital
    names; a new "新增提醒计划" form that binds an existing medication/plan + times)
  - api/care-reminders.ts              (+cancelSchedule, +listPatientMedications,
    +listPatientVitalPlans; medication/vital create helpers reused by the form)

CSS additions appended to patient-engagement-admin-tab.css (idempotent).

Also ships prisma/dedupe-care-reminder-schedules.js to merge EXISTING duplicate
schedules (run once, see APPLY doc).

Run from repo ROOT:
  python3 scripts/apply_care_reminders_plan_dedupe.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path.cwd()
SVC = ROOT / "apps/api/src/care-reminders/care-reminder-schedule.service.ts"
CTRL = ROOT / "apps/api/src/care-reminders/care-reminders.controller.ts"
CSS = ROOT / "apps/web/src/patient-engagement-admin-tab.css"

changed: list[str] = []
skipped: list[str] = []


def fail(msg: str) -> None:
    print(f"[err] {msg}", file=sys.stderr)
    sys.exit(1)


def need(p: Path) -> str:
    if not p.exists():
        fail(f"missing {p} (run from repo root)")
    return p.read_text(encoding="utf-8")


def edit(p: Path, edits: list[tuple[str, str, str]]) -> None:
    src = need(p)
    file_changed = False
    for desc, old, new in edits:
        if new and new in src:
            continue  # already applied
        if old and old in src:
            if src.count(old) != 1:
                fail(f"{p.name}: anchor for '{desc}' not unique ({src.count(old)}x)")
            src = src.replace(old, new, 1)
            file_changed = True
        else:
            fail(f"{p.name}: anchor for '{desc}' not found (and result not present)")
    if file_changed:
        p.write_text(src, encoding="utf-8")
        changed.append(str(p.relative_to(ROOT)))
    else:
        skipped.append(str(p.relative_to(ROOT)))


SVC_METHODS = '''  async resume(id: string): Promise<CareReminderSchedule> {
    return this.update(id, { isActive: true });
  }

  /**
   * Dedupe-by-source create. A plan-bound reminder (MEDICATION / VITAL) should
   * have AT MOST ONE active schedule per (patientId, sourceType, sourceId).
   * If one already exists we UPDATE it (and re-activate if it had been paused)
   * instead of stacking a second row. Falls back to a plain create when there
   * is no sourceId to dedupe on.
   */
  async createOrUpdateForSource(input: CreateScheduleInput): Promise<CareReminderSchedule> {
    if (input.sourceId) {
      const existing = await this.prisma.careReminderSchedule.findFirst({
        where: {
          patientId: input.patientId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (existing) {
        this.validateTimes(input.scheduledTimes);
        return this.prisma.careReminderSchedule.update({
          where: { id: existing.id },
          data: {
            title: input.title,
            description: input.description ?? null,
            reminderType: input.reminderType,
            frequencyUnit: input.frequencyUnit ?? 'DAY',
            timesPerUnit: input.timesPerUnit ?? (input.scheduledTimes.length || 1),
            scheduledTimes: input.scheduledTimes as any,
            scheduledDays: (input.scheduledDays ?? null) as any,
            payload: (input.payload ?? null) as any,
            reminderLeadMinutes: input.reminderLeadMinutes ?? 0,
            checkInWindowBeforeMinutes: input.checkInWindowBeforeMinutes ?? 180,
            checkInWindowAfterMinutes: input.checkInWindowAfterMinutes ?? 180,
            escalationAfterMinutes: input.escalationAfterMinutes ?? null,
            // re-activate a previously cancelled/paused binding
            isActive: true,
            pausedAt: null,
          },
        });
      }
    }
    return this.create(input);
  }

  /**
   * Cancel (permanently stop) a plan-bound long-term reminder. The schedule is
   * deleted; its occurrences cascade-delete via the FK. Use this for the
   * schedule-level "取消计划" action (as opposed to pausing a single occurrence).
   */
  async cancelSchedule(id: string): Promise<{ id: string; canceled: true }> {
    const existing = await this.prisma.careReminderSchedule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`schedule ${id} not found`);
    await this.prisma.careReminderSchedule.delete({ where: { id } });
    return { id, canceled: true };
  }'''


CTRL_CANCEL_ROUTE = '''  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('schedules/:id/resume')
  async resumeSchedule(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    this.tenant.assertWriteAllowed(user);
    const sched = await this.schedules.getByIdOrThrow(id);
    await this.tenant.assertPatientVisibleToUser(sched.patientId, user);
    return this.schedules.resume(id);
  }

  // care-reminders-plan-dedupe-v1: schedule-level "取消计划" — permanently stop a
  // plan-bound long-term reminder (deletes the schedule; occurrences cascade).
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('schedules/:id/cancel')
  async cancelSchedule(@Param('id') id: string, @CurrentUser() user: RequestUser, @Req() req: any) {
    this.tenant.assertWriteAllowed(user);
    const sched = await this.schedules.getByIdOrThrow(id);
    await this.tenant.assertPatientVisibleToUser(sched.patientId, user);
    const result = await this.schedules.cancelSchedule(id);
    await this.audit.record({
      user,
      action: 'CARE_REMINDER_SCHEDULE_CANCELED',
      targetType: 'CareReminderSchedule',
      targetId: id,
      ipAddress: req?.ip,
      afterData: { sourceType: sched.sourceType, sourceId: sched.sourceId },
    });
    return result;
  }'''


CSS_BLOCK = """

/* ============================================================================
   care-reminders-plan-dedupe-v1 — schedule section header, add-schedule form,
   and source-name chip wrapper.
============================================================================ */

.pe-admin-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.pe-admin-section-head h3 {
  margin: 0;
}

.pe-admin-add-schedule {
  margin: 12px 0 16px;
  padding: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #f8fafc;
}

/* keep the chip + dosage on one baseline */
.pe-admin-source-name {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  flex-wrap: wrap;
}
"""


def main() -> None:
    # backend: schedule service methods
    edit(
        SVC,
        [
            (
                "add createOrUpdateForSource + cancelSchedule",
                "  async resume(id: string): Promise<CareReminderSchedule> {\n"
                "    return this.update(id, { isActive: true });\n"
                "  }",
                SVC_METHODS,
            ),
        ],
    )

    # backend: controller create endpoints -> dedupe, + cancel route
    edit(
        CTRL,
        [
            (
                "medication create -> createOrUpdateForSource",
                # there are two identical create calls; we replace the first
                # (medication). To keep anchors unique we include the sourceType
                # line that follows in each block.
                "const schedule = await this.schedules.create({\n"
                "      hospitalTenantId,\n"
                "      patientId,\n"
                "      sourceType: 'MEDICATION',",
                "const schedule = await this.schedules.createOrUpdateForSource({\n"
                "      hospitalTenantId,\n"
                "      patientId,\n"
                "      sourceType: 'MEDICATION',",
            ),
            (
                "vital create -> createOrUpdateForSource",
                "const schedule = await this.schedules.create({\n"
                "      hospitalTenantId,\n"
                "      patientId,\n"
                "      sourceType: 'VITAL',",
                "const schedule = await this.schedules.createOrUpdateForSource({\n"
                "      hospitalTenantId,\n"
                "      patientId,\n"
                "      sourceType: 'VITAL',",
            ),
            (
                "add schedule cancel route",
                "  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)\n"
                "  @Post('schedules/:id/resume')\n"
                "  async resumeSchedule(@Param('id') id: string, @CurrentUser() user: RequestUser) {\n"
                "    this.tenant.assertWriteAllowed(user);\n"
                "    const sched = await this.schedules.getByIdOrThrow(id);\n"
                "    await this.tenant.assertPatientVisibleToUser(sched.patientId, user);\n"
                "    return this.schedules.resume(id);\n"
                "  }",
                CTRL_CANCEL_ROUTE,
            ),
        ],
    )

    # css
    src = need(CSS)
    if "care-reminders-plan-dedupe-v1" in src:
        skipped.append(str(CSS.relative_to(ROOT)))
    else:
        if not src.endswith("\n"):
            src += "\n"
        CSS.write_text(src + CSS_BLOCK, encoding="utf-8")
        changed.append(str(CSS.relative_to(ROOT)))

    print("[done] care-reminders plan dedupe + UX (backend + css)")
    if changed:
        print("  patched:")
        for c in dict.fromkeys(changed):
            print(f"    - {c}")
    if skipped:
        print("  already-applied (skipped):")
        for s in dict.fromkeys(skipped):
            print(f"    - {s}")
    print(
        "\nFull-file frontend replacements in this patch:"
        "\n    - apps/web/src/components/CareRemindersPanel.tsx"
        "\n    - apps/web/src/api/care-reminders.ts"
        "\nOne-time data cleanup script:"
        "\n    - apps/api/prisma/dedupe-care-reminder-schedules.js"
    )


if __name__ == "__main__":
    main()
