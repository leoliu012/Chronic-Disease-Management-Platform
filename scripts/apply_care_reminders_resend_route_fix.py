#!/usr/bin/env python3
"""
apply_care_reminders_resend_route_fix.py
----------------------------------------
Fixes the two remaining smoke gaps after the v3.1 + v3.2 apply. Idempotent.

  1. care-reminders RESEND endpoint was never wired up.
     - CareReminderResendService exists (and its logic is correct), but:
         a) it is NOT in CareRemindersModule.providers, so Nest never constructs it;
         b) there is NO `POST /care-reminders/occurrences/:id/resend` route.
     Result: the smoke's resend calls 404 (CR #8, #8-occurrence, #10).
     Fix: register the provider + inject the service + add the route. The route
     returns { occurrence, message, formLink, reusedLink } and surfaces the
     service's BadRequest (400) for completed / non-resendable occurrences, which
     is exactly what CR #10 expects.

  2. PE smoke #11 date-range filter is timezone-fragile (it built a *single* local
     day and compared against a server that may run in a different TZ → today=0).
     Fixed in the smoke (shipped as a full-file replacement in this patch) by
     querying a yesterday→tomorrow window, which brackets "now" in ANY timezone
     while a far-past window still returns 0. No server code needed for #11; the
     controller's bare-date handling is already correct.

Run from repo root:
  python3 scripts/apply_care_reminders_resend_route_fix.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path.cwd()
MODULE = ROOT / "apps/api/src/care-reminders/care-reminders.module.ts"
CTRL = ROOT / "apps/api/src/care-reminders/care-reminders.controller.ts"

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
# 1) module — register CareReminderResendService as a provider + import
# ---------------------------------------------------------------------------
def patch_module() -> None:
    src = need(MODULE)
    local = False

    if "CareReminderResendService" not in src:
        # add import next to the worker-service import
        imp_anchor = "import { CareReminderWorkerService } from './care-reminder-worker.service';\n"
        if imp_anchor not in src:
            fail("module: worker-service import anchor not found")
        src = src.replace(
            imp_anchor,
            imp_anchor
            + "import { CareReminderResendService } from './care-reminder-resend.service';\n",
            1,
        )
        local = True

    # add to providers (after CareReminderWorkerService, in the providers list)
    if "CareReminderResendService," not in src:
        prov_anchor = (
            "  providers: [\n"
            "    CareReminderScheduleService,\n"
            "    CareReminderOccurrenceService,\n"
            "    CareReminderWorkerService,\n"
        )
        if prov_anchor not in src:
            fail("module: providers anchor not found")
        src = src.replace(
            prov_anchor,
            prov_anchor + "    CareReminderResendService,\n",
            1,
        )
        local = True

    if local:
        MODULE.write_text(src, encoding="utf-8")
        changed.append("care-reminders.module.ts (registered CareReminderResendService)")
        print("[ok] registered CareReminderResendService in care-reminders.module.ts")
    else:
        print("[skip] module already registers CareReminderResendService")


# ---------------------------------------------------------------------------
# 2) controller — import, inject, and add the resend route
# ---------------------------------------------------------------------------
def patch_controller() -> None:
    src = need(CTRL)
    local = False

    if "CareReminderResendService" not in src:
        imp_anchor = "import { CareReminderWorkerService } from './care-reminder-worker.service';\n"
        if imp_anchor not in src:
            fail("controller: worker-service import anchor not found")
        src = src.replace(
            imp_anchor,
            imp_anchor
            + "import { CareReminderResendService } from './care-reminder-resend.service';\n",
            1,
        )
        local = True

    # inject into constructor (after the worker dependency)
    if "private readonly resend: CareReminderResendService" not in src:
        ctor_anchor = "    private readonly worker: CareReminderWorkerService,\n"
        if ctor_anchor not in src:
            fail("controller: constructor worker-dependency anchor not found")
        src = src.replace(
            ctor_anchor,
            ctor_anchor + "    private readonly resend: CareReminderResendService,\n",
            1,
        )
        local = True

    # add the route right after send-now's closing block
    if "occurrences/:id/resend" not in src:
        # Anchor: the cancel route declaration. Insert the resend route BEFORE it.
        cancel_anchor = (
            "  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)\n"
            "  @Post('occurrences/:id/cancel')\n"
        )
        if cancel_anchor not in src:
            fail("controller: cancel-route anchor not found (cannot place resend route)")
        resend_route = (
            "  // v3.1: nurse 再次发送 — reuse the occurrence's canonical message and\n"
            "  // append a NURSE_RESEND delivery attempt (no new message row). The\n"
            "  // service throws BadRequest (400) for completed / non-resendable states.\n"
            "  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)\n"
            "  @Post('occurrences/:id/resend')\n"
            "  async resendOccurrence(@Param('id') id: string, @CurrentUser() user: RequestUser, @Req() req: any) {\n"
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
            "        messageId: result.message?.id ?? null,\n"
            "        status: result.occurrence?.status ?? null,\n"
            "      },\n"
            "    });\n"
            "    return result;\n"
            "  }\n\n"
        )
        src = src.replace(cancel_anchor, resend_route + cancel_anchor, 1)
        local = True

    if local:
        CTRL.write_text(src, encoding="utf-8")
        changed.append("care-reminders.controller.ts (added resend route)")
        print("[ok] added POST /care-reminders/occurrences/:id/resend route")
    else:
        print("[skip] controller already has the resend route")


def main() -> None:
    patch_module()
    patch_controller()
    if changed:
        print("\n[done] code fixes applied:")
        for c in changed:
            print(f"     - {c}")
        print(
            "\nThe patient-engagement smoke is also replaced by this patch "
            "(timezone-robust #11 date window)."
            "\nRestart the API (npm run start:dev) before re-running the smokes."
        )
    else:
        print("\n[done] no code changes needed; PE smoke still replaced by the patch.")


if __name__ == "__main__":
    main()
