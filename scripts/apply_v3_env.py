#!/usr/bin/env python3
"""
apply_v3_env.py — add v3 worker env vars to apps/api/.env. Idempotent.
"""
from __future__ import annotations
import sys
from pathlib import Path

ENV = Path("apps/api/.env")
BLOCK = """
# care-reminders v3
CARE_REMINDER_WORKER_ENABLED=true
CARE_REMINDER_WORKER_INTERVAL_MS=300000
CARE_REMINDER_WORKER_HORIZON_DAYS=3
"""


def main() -> int:
    if not ENV.exists():
        print(f"[err] {ENV} not found", file=sys.stderr)
        return 1
    src = ENV.read_text(encoding="utf-8")
    if "CARE_REMINDER_WORKER_ENABLED" in src:
        print(f"[skip] {ENV.name} already has v3 worker vars.")
        return 0
    if not src.endswith("\n"):
        src += "\n"
    ENV.write_text(src + BLOCK, encoding="utf-8")
    print(f"[ok] {ENV.name} — added v3 worker env vars (worker enabled by default)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
