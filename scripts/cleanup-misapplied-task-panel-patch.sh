#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-$PWD}"

# This patch was accidentally applied from apps/api once, which created a nested
# apps/api/apps/web tree. Remove that duplicate tree and stray patch docs/folders.
if [ -d "$ROOT/apps/api/apps" ]; then
  rm -rf "$ROOT/apps/api/apps"
  echo "Removed misapplied nested directory: apps/api/apps"
else
  echo "No nested apps/api/apps directory found."
fi

rm -f "$ROOT/apps/api/README_task_panel_remove_summary.md"
rm -f "$ROOT/apps/api/README_task_panel_remove_task_header.md"
rm -rf "$ROOT/task_panel_remove_task_title_patch"
rm -rf "$ROOT/task_panel_remove_summary_patch"
rm -rf "$ROOT/task_panel_remove_task_header_patch"

echo "Cleanup complete."
