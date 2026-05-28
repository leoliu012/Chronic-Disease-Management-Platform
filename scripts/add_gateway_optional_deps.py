#!/usr/bin/env python3
"""
add_gateway_optional_deps.py
============================

Adds (mssql, oracledb) to `apps/api/package.json` under `optionalDependencies`.

Why optionalDependencies?
- dev / CI machines don't need them; `npm install` won't fail if they don't compile
- production hospital servers do `npm install --include=optional` (or just
  `npm install mssql` / `npm install oracledb`) on top to actually pull them in
- this matches how `bcrypt` / `node-rdkafka` are typically handled

Idempotent — safe to re-run.

Run from project root:
    python3 scripts/add_gateway_optional_deps.py
"""

from __future__ import annotations
import json
import sys
from pathlib import Path

PKG = Path("apps/api/package.json")

# Pinned to recent stable majors. Adjust as needed for your Node version.
WANTED = {
    "mssql": "^11.0.1",
    "oracledb": "^6.5.1",
}


def main() -> int:
    if not PKG.exists():
        print(f"✗ {PKG} not found. Run from project root.", file=sys.stderr)
        return 1

    raw = PKG.read_text(encoding="utf-8")
    data = json.loads(raw)

    deps = data.setdefault("optionalDependencies", {})
    changed = False
    for name, ver in WANTED.items():
        if deps.get(name) != ver:
            print(f"  optionalDependencies.{name} -> {ver}  (was: {deps.get(name) or '(none)'})")
            deps[name] = ver
            changed = True

    if not changed:
        print("nothing to change — apps/api/package.json already has the right optionalDependencies.")
        return 0

    PKG.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"✓ wrote {PKG}")
    print()
    print("Next steps (only if you intend to use the real adapters):")
    print("  cd apps/api")
    print("  npm install mssql       # for GATEWAY_INTERMEDIATE_ADAPTER=sqlserver")
    print("  npm install oracledb    # for GATEWAY_INTERMEDIATE_ADAPTER=oracle")
    return 0


if __name__ == "__main__":
    sys.exit(main())
