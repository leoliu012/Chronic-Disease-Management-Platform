#!/usr/bin/env python3
"""Idempotently apply clinical-access-scope v4.1 local-deployment hotfix."""
from pathlib import Path
import shutil
script = Path(__file__).resolve()
repo_root = script.parent.parent
files_root = repo_root / 'files'
if not files_root.is_dir():
    raise SystemExit(f'[err] overlay directory missing: {files_root}')
count = 0
for source in sorted(files_root.rglob('*')):
    if not source.is_file():
        continue
    relative = source.relative_to(files_root)
    target = repo_root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    count += 1
    print(f'[copy] {relative.as_posix()}')
print(f'[done] clinical-access-scope v4.1 hotfix applied: {count} file(s) copied.')
