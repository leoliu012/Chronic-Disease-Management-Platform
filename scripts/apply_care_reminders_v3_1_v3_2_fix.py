#!/usr/bin/env python3
"""
apply_care_reminders_v3_1_v3_2_fix.py
-------------------------------------
Repairs a broken care-reminders v3.1 / patient-engagement v3.2 apply.

Three problems are fixed (all idempotent):

  1. schema.prisma — CareReminderOccurrence lost `resendCount` / `lastResentAt`.
     A stray `prisma migrate dev` round-trip dropped them from the schema, which
     in turn made Prisma generate a bogus DROP migration and broke the
     CareReminderResendService types. We re-add the two columns.

  2. migrations — a bogus auto-generated migration
       20260528192047_care_reminders_v3_1_bound_plan_resend
     was created by `migrate dev --name care_reminders_v3_1_bound_plan_resend`.
     Its timestamp (20260528...) sorts BEFORE the migration that creates the
     CareReminderOccurrence table (20260530120000_care_reminders_v3), and its body
     DROPs resendCount/lastResentAt. On the shadow DB it fails with P3006
     ("underlying table ... does not exist"). It is deleted. The correctly-ordered
     20260531120000_care_reminders_v3_1_resend migration (which ADDs the columns)
     is kept.

  3. TypeScript — two bugs introduced while patching the care-reminder services:
       a) care-reminder-resend.service.ts references a renamed variable
          (`message.id` -> should be `canonical.id`).
       b) care-reminder-worker.service.ts has a redundant nested
          `if (primaryChannel !== 'MANUAL_COPY')` that TS flags as a
          no-overlap comparison (TS2367).

Run from repo root:
  python3 scripts/apply_care_reminders_v3_1_v3_2_fix.py
"""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

ROOT = Path.cwd()
SCHEMA = ROOT / "apps/api/prisma/schema.prisma"
CRR = ROOT / "apps/api/src/care-reminders/care-reminder-resend.service.ts"
CRW = ROOT / "apps/api/src/care-reminders/care-reminder-worker.service.ts"
BOGUS_MIGRATION = ROOT / "apps/api/prisma/migrations/20260528192047_care_reminders_v3_1_bound_plan_resend"
GOOD_MIGRATION = ROOT / "apps/api/prisma/migrations/20260531120000_care_reminders_v3_1_resend"

changed: list[str] = []


def fail(msg: str) -> None:
    print(f"[err] {msg}", file=sys.stderr)
    sys.exit(1)


def _model_body_span(src: str, name: str):
    m = re.search(r"model\s+" + re.escape(name) + r"\s*\{", src)
    if not m:
        return None
    start = m.end()
    depth = 1
    i = start
    while i < len(src) and depth > 0:
        ch = src[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return start, i
        i += 1
    return None


# ---------------------------------------------------------------------------
# 1) schema — re-add resendCount / lastResentAt
# ---------------------------------------------------------------------------
def fix_schema() -> None:
    if not SCHEMA.exists():
        fail(f"missing {SCHEMA} (run from repo root)")
    src = SCHEMA.read_text(encoding="utf-8")
    span = _model_body_span(src, "CareReminderOccurrence")
    if not span:
        fail("model CareReminderOccurrence not found — is care-reminders v3 applied?")
    start, end = span
    body = src[start:end]

    if "resendCount" in body and "lastResentAt" in body:
        print("[skip] schema already has resendCount / lastResentAt")
        return

    anchor = "lastError         String?"
    if anchor in body:
        new_body = body.replace(
            anchor,
            anchor
            + "\n  // care-reminders v3.1 — resend bookkeeping\n"
            "  resendCount       Int      @default(0)\n"
            "  lastResentAt      DateTime?",
            1,
        )
    else:
        anchor2 = "createdAt         DateTime @default(now())"
        if anchor2 not in body:
            fail("could not find an anchor inside CareReminderOccurrence to re-add resend fields")
        new_body = body.replace(
            anchor2,
            "// care-reminders v3.1 — resend bookkeeping\n"
            "  resendCount       Int      @default(0)\n"
            "  lastResentAt      DateTime?\n"
            "  " + anchor2,
            1,
        )
    src = src[:start] + new_body + src[end:]
    SCHEMA.write_text(src, encoding="utf-8")
    changed.append("schema.prisma (+resendCount/+lastResentAt)")
    print("[ok] re-added resendCount / lastResentAt to schema.prisma")


# ---------------------------------------------------------------------------
# 2) delete the bogus, mis-ordered DROP migration
# ---------------------------------------------------------------------------
def fix_migration() -> None:
    if not BOGUS_MIGRATION.exists():
        print("[skip] bogus migration 20260528192047 already removed")
        return
    sql = (BOGUS_MIGRATION / "migration.sql").read_text(encoding="utf-8") if (BOGUS_MIGRATION / "migration.sql").exists() else ""
    # Safety: only auto-delete if it's the known bogus DROP migration.
    if 'DROP COLUMN "resendCount"' in sql or 'DROP COLUMN "lastResentAt"' in sql:
        shutil.rmtree(BOGUS_MIGRATION)
        changed.append("deleted migration 20260528192047_care_reminders_v3_1_bound_plan_resend")
        print("[ok] deleted bogus migration 20260528192047_care_reminders_v3_1_bound_plan_resend")
        if not GOOD_MIGRATION.exists():
            print(
                "[warn] expected 20260531120000_care_reminders_v3_1_resend to exist; "
                "ensure the v3.1 patch's migration is present."
            )
    else:
        print(
            "[skip] 20260528192047 exists but does not look like the bogus DROP "
            "migration; leaving it untouched (inspect manually)."
        )


# ---------------------------------------------------------------------------
# 3a) resend service — message.id -> canonical.id
# ---------------------------------------------------------------------------
def fix_resend_ts() -> None:
    if not CRR.exists():
        print("[skip] care-reminder-resend.service.ts not present")
        return
    src = CRR.read_text(encoding="utf-8")
    old = "outboundMessageId: dispatchedMessage?.id ?? message.id,"
    new = "outboundMessageId: dispatchedMessage?.id ?? canonical.id,"
    if new in src:
        print("[skip] resend service already references canonical.id")
        return
    if old not in src:
        # Maybe it references some other variable; only fix the exact known bug.
        print("[skip] resend service: 'message.id' bug not found (already fixed?)")
        return
    src = src.replace(old, new, 1)
    CRR.write_text(src, encoding="utf-8")
    changed.append("care-reminder-resend.service.ts (message.id -> canonical.id)")
    print("[ok] fixed care-reminder-resend.service.ts (message.id -> canonical.id)")


# ---------------------------------------------------------------------------
# 3b) worker — remove redundant nested if (primaryChannel !== 'MANUAL_COPY')
# ---------------------------------------------------------------------------
def fix_worker_ts() -> None:
    if not CRW.exists():
        print("[skip] care-reminder-worker.service.ts not present")
        return
    src = CRW.read_text(encoding="utf-8")

    old = (
        "      // v3.2: record this as the INITIAL delivery attempt on the canonical message.\n"
        "      if (primaryChannel !== 'MANUAL_COPY') {\n"
        "        try {\n"
        "          await this.outbound.recordAttempt({\n"
        "            messageId: message.id,\n"
        "            hospitalTenantId: tenantId,\n"
        "            patientId: occ.patientId,\n"
        "            formLinkId: formLink.id,\n"
        "            channel: primaryChannel as 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS',\n"
        "            status: dispatched?.status === 'SENT' ? 'SENT' : 'FAILED',\n"
        "            providerMessageId: dispatched?.providerMessageId ?? null,\n"
        "            errorMessage: dispatched?.status === 'SENT' ? null : dispatched?.errorMessage ?? '发送失败',\n"
        "            triggerReason: 'INITIAL',\n"
        "          });\n"
        "          await this.outbound.recomputeDelivery(message.id);\n"
        "        } catch { /* attempts table may be pre-v3.2 */ }\n"
        "      }\n"
    )
    new = (
        "      // v3.2: record this as the INITIAL delivery attempt on the canonical message.\n"
        "      // (We're already inside `if (primaryChannel !== 'MANUAL_COPY')`, so the\n"
        "      // channel here is WECHAT_OFFICIAL_ACCOUNT or SMS.)\n"
        "      try {\n"
        "        await this.outbound.recordAttempt({\n"
        "          messageId: message.id,\n"
        "          hospitalTenantId: tenantId,\n"
        "          patientId: occ.patientId,\n"
        "          formLinkId: formLink.id,\n"
        "          channel: primaryChannel,\n"
        "          status: dispatched?.status === 'SENT' ? 'SENT' : 'FAILED',\n"
        "          providerMessageId: dispatched?.providerMessageId ?? null,\n"
        "          errorMessage: dispatched?.status === 'SENT' ? null : dispatched?.errorMessage ?? '发送失败',\n"
        "          triggerReason: 'INITIAL',\n"
        "        });\n"
        "        await this.outbound.recomputeDelivery(message.id);\n"
        "      } catch { /* attempts table may be pre-v3.2 */ }\n"
    )
    if new in src:
        print("[skip] worker INITIAL-attempt block already de-nested")
        return
    if old not in src:
        print("[skip] worker: redundant nested if not found (already fixed?)")
        return
    src = src.replace(old, new, 1)
    CRW.write_text(src, encoding="utf-8")
    changed.append("care-reminder-worker.service.ts (removed redundant nested if)")
    print("[ok] fixed care-reminder-worker.service.ts (removed redundant nested if)")


def main() -> None:
    fix_schema()
    fix_migration()
    fix_resend_ts()
    fix_worker_ts()
    if changed:
        print("\n[done] fixes applied:")
        for c in changed:
            print(f"     - {c}")
        print(
            "\nNext: cd apps/api && npx prisma generate && "
            "npx prisma migrate dev && node prisma/seed-all.js"
        )
    else:
        print("\n[done] nothing to fix — already healthy.")


if __name__ == "__main__":
    main()
