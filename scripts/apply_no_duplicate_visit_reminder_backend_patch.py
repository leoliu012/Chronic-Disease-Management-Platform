#!/usr/bin/env python3
"""Patch backend duplicate active hospital-visit-reminder behavior.

Run from repository root:
  python3 scripts/apply_no_duplicate_visit_reminder_backend_patch.py "$PWD"
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
service_path = ROOT / "apps/api/src/hospital-visit-reminders/hospital-visit-reminders.service.ts"

if not service_path.exists():
    raise SystemExit(f"Missing file: {service_path}")

text = service_path.read_text()
original = text

replacement = """if (existingActive) {
      throw new BadRequestException('该患者当前已有有效到院提醒，请先登记到院、未到院、拒绝到院或撤销现有提醒后再新建。');
    }"""

# Current/previous behavior returned the existing reminder and silently did not send a duplicate.
pattern = re.compile(
    r"if \(existingActive\) \{\n"
    r"\s+const task = await this\.ensureHospitalVisitTask\(existingActive, user\);\n"
    r"\s+const reminderWithTask = await this\.attachRelatedTask\(existingActive\);\n"
    r"\s+return \{\n"
    r"\s+reminder: reminderWithTask,\n"
    r"\s+task,\n"
    r"\s+message: '该患者当前已有有效到院提醒[^']*',\n"
    r"\s+\};\n"
    r"\s+\}",
    re.MULTILINE,
)
text, count = pattern.subn(replacement, text, count=1)

# If the block was already manually edited to a different duplicate-return shape, use a broader fallback.
if count == 0 and "if (existingActive)" in text and "未重复发送" in text:
    broad = re.compile(
        r"if \(existingActive\) \{\n(?P<body>.*?)\n\s+\}\n\n\s+const reminder = await this\.prisma\.hospitalVisitReminder\.create",
        re.DOTALL,
    )
    text, count = broad.subn(
        replacement + "\n\n    const reminder = await this.prisma.hospitalVisitReminder.create",
        text,
        count=1,
    )

# Keep compatibility with earlier patches where ensureHospitalVisitTask can return null.
text = text.replace("generatedTaskId: task.id,", "generatedTaskId: task?.id ?? null,")
text = text.replace("taskId: task.id,", "taskId: task?.id ?? null,")

if text != original:
    service_path.write_text(text)
    print(f"Patched {service_path.relative_to(ROOT)}")
else:
    print("No backend changes needed; duplicate-active reminder behavior already appears patched.")
