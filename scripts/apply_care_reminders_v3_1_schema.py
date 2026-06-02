#!/usr/bin/env python3
"""
apply_care_reminders_v3_1_schema.py
-----------------------------------
Idempotent Prisma schema patcher for care-reminders v3.1.

Adds two optional fields to CareReminderOccurrence so "再次发送 / resend" can be
tracked without inventing a whole new table:

    resendCount  Int       @default(0)
    lastResentAt DateTime?

Everything else in v3.1 (the bound-plan view + resend endpoint) leans on the
existing PatientOutboundMessage history, so the schema change is intentionally
minimal. If these two fields already exist, this is a no-op.

Run from repo root:
  python3 scripts/apply_care_reminders_v3_1_schema.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

SCHEMA = Path("apps/api/prisma/schema.prisma")


def _model_body_span(src: str, name: str):
    """Return (start, end) char offsets of the body of `model <name> { ... }`.

    start = just after the opening brace, end = index of the matching closing brace.
    Brace-counting so nested blocks (block attributes etc.) don't confuse us.
    """
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


def main() -> int:
    if not SCHEMA.exists():
        print(f"[err] {SCHEMA} not found (run from repo root)", file=sys.stderr)
        return 1

    src = SCHEMA.read_text(encoding="utf-8")
    span = _model_body_span(src, "CareReminderOccurrence")
    if not span:
        print(
            "[err] model CareReminderOccurrence not found — apply care-reminders v3 first.",
            file=sys.stderr,
        )
        return 1

    start, end = span
    body = src[start:end]

    if "resendCount" in body and "lastResentAt" in body:
        print("[skip] CareReminderOccurrence already has resendCount / lastResentAt.")
        return 0

    # Insert right after the `lastError` line to keep the resend/send metadata grouped.
    # `lastError` is guaranteed present in v3.
    anchor = "lastError         String?"
    if anchor not in body:
        # Fall back: insert just before the first `createdAt` line in the model body.
        anchor2 = "createdAt         DateTime @default(now())"
        if anchor2 not in body:
            print(
                "[err] could not find an anchor (lastError / createdAt) inside "
                "CareReminderOccurrence to insert resend fields.",
                file=sys.stderr,
            )
            return 1
        new_body = body.replace(
            anchor2,
            "// care-reminders v3.1 — resend bookkeeping\n"
            "  resendCount       Int      @default(0)\n"
            "  lastResentAt      DateTime?\n"
            "  " + anchor2,
            1,
        )
    else:
        new_body = body.replace(
            anchor,
            anchor
            + "\n  // care-reminders v3.1 — resend bookkeeping\n"
            "  resendCount       Int      @default(0)\n"
            "  lastResentAt      DateTime?",
            1,
        )

    src = src[:start] + new_body + src[end:]
    SCHEMA.write_text(src, encoding="utf-8")
    print("[ok] schema.prisma patched (care-reminders v3.1):")
    print("     - CareReminderOccurrence.resendCount Int @default(0)")
    print("     - CareReminderOccurrence.lastResentAt DateTime?")
    return 0


if __name__ == "__main__":
    sys.exit(main())
