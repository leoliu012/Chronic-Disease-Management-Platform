#!/usr/bin/env python3
"""Install clinical disposition v5 overlay from repository root. Idempotent."""
from pathlib import Path
import shutil
import sys

repo = Path.cwd()
if not (repo / 'apps' / 'api').is_dir():
    print('[err] Run this script from the repository root (apps/api must exist).', file=sys.stderr)
    raise SystemExit(1)

patch_root = Path(__file__).resolve().parent.parent
files_root = patch_root / 'clinical_disposition_v5_overlay'
if not files_root.is_dir():
    print(f'[err] Missing overlay directory: {files_root}', file=sys.stderr)
    raise SystemExit(1)

written = 0
unchanged = 0
for source in sorted(files_root.rglob('*')):
    if not source.is_file():
        continue
    relative = source.relative_to(files_root)
    target = repo / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.read_bytes() == source.read_bytes():
        unchanged += 1
        print(f'[skip] {relative}')
        continue
    shutil.copy2(source, target)
    written += 1
    print(f'[write] {relative}')

print(f'[done] clinical disposition v5 applied: wrote={written}, unchanged={unchanged}')
