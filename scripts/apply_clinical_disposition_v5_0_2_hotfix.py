#!/usr/bin/env python3
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
OVERLAY = ROOT / 'clinical_disposition_v5_0_2_overlay'

if not OVERLAY.is_dir():
    raise SystemExit(f'[err] overlay directory not found: {OVERLAY}')

wrote = 0
unchanged = 0
for src in sorted(path for path in OVERLAY.rglob('*') if path.is_file()):
    rel = src.relative_to(OVERLAY)
    dst = ROOT / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and dst.read_bytes() == src.read_bytes():
        print(f'[unchanged] {rel}')
        unchanged += 1
        continue
    shutil.copy2(src, dst)
    print(f'[wrote] {rel}')
    wrote += 1

print(f'[done] clinical disposition v5.0.2 hotfix applied: wrote={wrote}, unchanged={unchanged}')
