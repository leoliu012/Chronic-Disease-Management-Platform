#!/usr/bin/env python3
"""
apply_care_reminders_v3_1_backend.py
------------------------------------
Idempotent backend patcher for care-reminders v3.1.

Touches three TypeScript files (the new resend service ships as a plain file via
the patch zip and is NOT generated here):

  1. care-reminders.module.ts
       - import + provide CareReminderResendService

  2. care-reminders.controller.ts
       - inject CareReminderResendService
       - GET /care-reminders/today: accept ?from / ?to, with a ±24h default guard
       - POST /occurrences/:id/send-now: when SENT/CLICKED, return reused=true ONLY
         if there is an active formLinkId; otherwise 400
       - POST /occurrences/:id/resend  (new)
       - medication/vital schedule create: infer sourceId from payload when missing

  3. care-reminder-schedule.service.ts
       - listForPatient(): attach sourceSummary {type,id,title,subtitle,status}
         for MEDICATION (MedicationRecord) and VITAL (VitalMonitoringPlan)

Run from repo root:
  python3 scripts/apply_care_reminders_v3_1_backend.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path.cwd()
MODULE = ROOT / "apps/api/src/care-reminders/care-reminders.module.ts"
CTRL = ROOT / "apps/api/src/care-reminders/care-reminders.controller.ts"
SCHED = ROOT / "apps/api/src/care-reminders/care-reminder-schedule.service.ts"


def fail(msg: str) -> None:
    print(f"[err] {msg}", file=sys.stderr)
    sys.exit(1)


def replace_once(src: str, old: str, new: str, label: str) -> str:
    if old not in src:
        fail(f"anchor not found while patching {label}")
    if src.count(old) != 1:
        fail(f"anchor not unique ({src.count(old)}×) while patching {label}")
    return src.replace(old, new, 1)


# ---------------------------------------------------------------------------
# 1) module
# ---------------------------------------------------------------------------
def patch_module() -> bool:
    if not MODULE.exists():
        fail(f"missing {MODULE}")
    src = MODULE.read_text(encoding="utf-8")
    if "CareReminderResendService" in src:
        print("[skip] module already wires CareReminderResendService")
        return False

    src = replace_once(
        src,
        "import { PatientDirectMessageService } from './patient-direct-message.service';",
        "import { PatientDirectMessageService } from './patient-direct-message.service';\n"
        "import { CareReminderResendService } from './care-reminder-resend.service';",
        "module imports",
    )

    # Add to providers list (insert after PatientDirectMessageService provider entry).
    src = replace_once(
        src,
        "  providers: [\n"
        "    CareReminderScheduleService,\n"
        "    CareReminderOccurrenceService,\n"
        "    CareReminderWorkerService,\n"
        "    PatientDirectMessageService,\n"
        "  ],",
        "  providers: [\n"
        "    CareReminderScheduleService,\n"
        "    CareReminderOccurrenceService,\n"
        "    CareReminderWorkerService,\n"
        "    PatientDirectMessageService,\n"
        "    CareReminderResendService,\n"
        "  ],",
        "module providers",
    )

    MODULE.write_text(src, encoding="utf-8")
    print("[ok] patched care-reminders.module.ts")
    return True


# ---------------------------------------------------------------------------
# 2) controller
# ---------------------------------------------------------------------------
def patch_controller() -> bool:
    if not CTRL.exists():
        fail(f"missing {CTRL}")
    src = CTRL.read_text(encoding="utf-8")
    changed = False

    # 2a. import the resend service
    if "CareReminderResendService" not in src:
        src = replace_once(
            src,
            "import { PatientDirectMessageService } from './patient-direct-message.service';",
            "import { PatientDirectMessageService } from './patient-direct-message.service';\n"
            "import { CareReminderResendService } from './care-reminder-resend.service';",
            "controller import",
        )
        changed = True

    # 2b. inject into constructor
    if "private readonly resend: CareReminderResendService" not in src:
        src = replace_once(
            src,
            "    private readonly directMessages: PatientDirectMessageService,\n  ) {}",
            "    private readonly directMessages: PatientDirectMessageService,\n"
            "    private readonly resend: CareReminderResendService,\n  ) {}",
            "controller constructor",
        )
        changed = True

    # 2c. today endpoint: accept from/to with ±24h default guard
    if "async todayOverview(@CurrentUser() user: RequestUser)" in src:
        old_today = (
            "  @Get('today')\n"
            "  async todayOverview(@CurrentUser() user: RequestUser) {\n"
            "    const tenantId =\n"
            "      user.role === UserRole.ADMIN\n"
            "        ? null\n"
            "        : await this.tenant.resolveUserHospitalTenantId(user);\n"
            "    if (user.role !== UserRole.ADMIN && !tenantId) {\n"
            "      throw new ForbiddenException('user is not bound to a tenant');\n"
            "    }\n\n"
            "    const now = new Date();\n"
            "    const startOfWindow = new Date(now.getTime() - 24 * 3600 * 1000);\n"
            "    const endOfWindow = new Date(now.getTime() + 24 * 3600 * 1000);\n"
        )
        new_today = (
            "  @Get('today')\n"
            "  async todayOverview(\n"
            "    @CurrentUser() user: RequestUser,\n"
            "    @Query('from') from?: string,\n"
            "    @Query('to') to?: string,\n"
            "  ) {\n"
            "    const tenantId =\n"
            "      user.role === UserRole.ADMIN\n"
            "        ? null\n"
            "        : await this.tenant.resolveUserHospitalTenantId(user);\n"
            "    if (user.role !== UserRole.ADMIN && !tenantId) {\n"
            "      throw new ForbiddenException('user is not bound to a tenant');\n"
            "    }\n\n"
            "    // v3.1: default window is now ±24h. Respect caller-supplied from/to but\n"
            "    // clamp invalid / inverted ranges back to the ±24h guard.\n"
            "    const now = new Date();\n"
            "    const DEFAULT_BACK = new Date(now.getTime() - 24 * 3600 * 1000);\n"
            "    const DEFAULT_FWD = new Date(now.getTime() + 24 * 3600 * 1000);\n"
            "    const parsedFrom = from ? new Date(from) : null;\n"
            "    const parsedTo = to ? new Date(to) : null;\n"
            "    const startOfWindow =\n"
            "      parsedFrom && !Number.isNaN(parsedFrom.getTime()) ? parsedFrom : DEFAULT_BACK;\n"
            "    let endOfWindow =\n"
            "      parsedTo && !Number.isNaN(parsedTo.getTime()) ? parsedTo : DEFAULT_FWD;\n"
            "    if (endOfWindow.getTime() < startOfWindow.getTime()) {\n"
            "      endOfWindow = DEFAULT_FWD;\n"
            "    }\n"
        )
        if new_today not in src:
            src = replace_once(src, old_today, new_today, "today endpoint window")
            changed = True

    # 2d. harden send-now: SENT/CLICKED requires an active formLinkId
    old_send = (
        "    if (occ.status !== 'PENDING') {\n"
        "      // Spec point 9: reuse existing link if already SENT.\n"
        "      if (occ.status === 'SENT' || occ.status === 'CLICKED') {\n"
        "        return { reused: true, occurrence: occ };\n"
        "      }\n"
        "      throw new BadRequestException(`occurrence is in status ${occ.status}; cannot send-now`);\n"
        "    }"
    )
    new_send = (
        "    if (occ.status !== 'PENDING') {\n"
        "      // v3.1: a SENT/CLICKED occurrence is treated as a no-op reuse ONLY when it\n"
        "      // still has an active form link; if the link is missing we can't safely\n"
        "      // claim it was delivered, so the caller must use /resend instead.\n"
        "      if (occ.status === 'SENT' || occ.status === 'CLICKED') {\n"
        "        if (!occ.formLinkId) {\n"
        "          throw new BadRequestException({\n"
        "            code: 'OCCURRENCE_SENT_WITHOUT_LINK',\n"
        "            message:\n"
        "              '该提醒已标记为已发送，但缺少有效链接，无法复用。请改用“再次发送”。',\n"
        "          });\n"
        "        }\n"
        "        return { reused: true, occurrence: occ };\n"
        "      }\n"
        "      throw new BadRequestException(`occurrence is in status ${occ.status}; cannot send-now`);\n"
        "    }"
    )
    if new_send not in src:
        src = replace_once(src, old_send, new_send, "send-now hardening")
        changed = True

    # 2e. new resend endpoint — insert right after the cancelOccurrence handler.
    if "async resendOccurrence(" not in src:
        anchor = (
            "  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)\n"
            "  @Post('occurrences/:id/cancel')\n"
            "  async cancelOccurrence(@Param('id') id: string, @CurrentUser() user: RequestUser) {\n"
            "    this.tenant.assertWriteAllowed(user);\n"
            "    const occ = await this.occurrences.getByIdOrThrow(id);\n"
            "    await this.tenant.assertPatientVisibleToUser(occ.patientId, user);\n"
            "    await this.occurrences.cancel(id);\n"
            "    return this.occurrences.getByIdOrThrow(id);\n"
            "  }"
        )
        resend_handler = (
            anchor
            + "\n\n"
            "  /**\n"
            "   * v3.1: re-send a reminder for a SENT/CLICKED (not yet completed) occurrence.\n"
            "   * MANAGER is read-only (assertWriteAllowed throws). Tenant-scoped.\n"
            "   */\n"
            "  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)\n"
            "  @Post('occurrences/:id/resend')\n"
            "  async resendOccurrence(\n"
            "    @Param('id') id: string,\n"
            "    @CurrentUser() user: RequestUser,\n"
            "    @Req() req: any,\n"
            "  ) {\n"
            "    this.tenant.assertWriteAllowed(user);\n"
            "    const occ = await this.occurrences.getByIdOrThrow(id);\n"
            "    await this.tenant.assertPatientVisibleToUser(occ.patientId, user);\n"
            "    const result = await this.resend.resend(id);\n"
            "    await this.audit.record({\n"
            "      user,\n"
            "      action: 'CARE_REMINDER_RESEND',\n"
            "      targetType: 'CareReminderOccurrence',\n"
            "      targetId: id,\n"
            "      ipAddress: req?.ip,\n"
            "      afterData: {\n"
            "        reusedLink: result.reusedLink,\n"
            "        messageId: result.message?.id,\n"
            "        formLinkId: result.formLink?.id,\n"
            "      },\n"
            "    });\n"
            "    return result;\n"
            "  }"
        )
        src = replace_once(src, anchor, resend_handler, "resend endpoint")
        changed = True

    # 2f. medication schedule: infer sourceId/medicationId from payload when missing.
    #     The DTO still requires medicationId, but a defensive guard keeps the
    #     spec's "infer from payload.medicationId, else BadRequest" contract.
    if "// v3.1: resolve medicationId (explicit field or payload fallback)" not in src:
        old_med = (
            "    this.tenant.assertWriteAllowed(user);\n"
            "    const { hospitalTenantId } = await this.tenant.assertPatientVisibleToUser(patientId, user);\n\n"
            "    const medication = await this.prisma.medicationRecord.findUnique({\n"
            "      where: { id: dto.medicationId },\n"
            "    });\n"
            "    if (!medication || medication.patientId !== patientId) {\n"
            "      throw new NotFoundException('medication not found for this patient');\n"
            "    }"
        )
        new_med = (
            "    this.tenant.assertWriteAllowed(user);\n"
            "    const { hospitalTenantId } = await this.tenant.assertPatientVisibleToUser(patientId, user);\n\n"
            "    // v3.1: resolve medicationId (explicit field or payload fallback)\n"
            "    const medicationId =\n"
            "      dto.medicationId || (dto as any)?.payload?.medicationId || null;\n"
            "    if (!medicationId) {\n"
            "      throw new BadRequestException('medicationId is required (or payload.medicationId)');\n"
            "    }\n"
            "    const medication = await this.prisma.medicationRecord.findUnique({\n"
            "      where: { id: medicationId },\n"
            "    });\n"
            "    if (!medication || medication.patientId !== patientId) {\n"
            "      throw new NotFoundException('medication not found for this patient');\n"
            "    }"
        )
        if new_med not in src:
            src = replace_once(src, old_med, new_med, "medication sourceId inference")
            changed = True

    # 2g. vital schedule: infer vitalMonitoringPlanId from payload.vitalPlanId when missing.
    if "// v3.1: resolve vitalMonitoringPlanId (explicit field or payload fallback)" not in src:
        old_vital = (
            "      sourceType: 'VITAL',\n"
            "      sourceId: dto.vitalMonitoringPlanId ?? null,\n"
        )
        new_vital = (
            "      sourceType: 'VITAL',\n"
            "      // v3.1: resolve vitalMonitoringPlanId (explicit field or payload fallback)\n"
            "      sourceId:\n"
            "        dto.vitalMonitoringPlanId ?? (dto as any)?.payload?.vitalPlanId ?? null,\n"
        )
        if new_vital not in src:
            src = replace_once(src, old_vital, new_vital, "vital sourceId inference")
            changed = True

    if not changed:
        print("[skip] controller already at v3.1")
        return False

    CTRL.write_text(src, encoding="utf-8")
    print("[ok] patched care-reminders.controller.ts")
    return True


# ---------------------------------------------------------------------------
# 3) schedule service — sourceSummary
# ---------------------------------------------------------------------------
def patch_schedule_service() -> bool:
    if not SCHED.exists():
        fail(f"missing {SCHED}")
    src = SCHED.read_text(encoding="utf-8")
    if "sourceSummary" in src:
        print("[skip] schedule service already returns sourceSummary")
        return False

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
    src = replace_once(src, old, new, "schedule service sourceSummary")
    SCHED.write_text(src, encoding="utf-8")
    print("[ok] patched care-reminder-schedule.service.ts")
    return True


def main() -> None:
    changed = False
    changed |= patch_module()
    changed |= patch_controller()
    changed |= patch_schedule_service()
    if changed:
        print("[done] care-reminders v3.1 backend applied. Rebuild / restart apps/api.")
    else:
        print("[done] no backend changes needed.")


if __name__ == "__main__":
    main()
