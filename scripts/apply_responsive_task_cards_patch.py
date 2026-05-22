#!/usr/bin/env python3
"""Apply responsive action-card layout fixes for patient task side panel and hospital-visit tab.
Run from repository root:
  python3 scripts/apply_responsive_task_cards_patch.py "$PWD"
"""
from pathlib import Path
import sys

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd().resolve()

PATCH_MARKER = "/* responsive-task-cards-patch-v1 */"
CSS = r'''

/* responsive-task-cards-patch-v1 */
/*
 * Responsive card grids for narrow split-pane layouts.
 * The patient detail page can shrink the right task panel substantially when the
 * split handle is dragged. Use auto-fit grids and container queries so action
 * cards wrap into one or more rows instead of overflowing or disappearing.
 */
.patient-task-side-panel,
.patient-hospital-visit-tab-panel,
.visit-flat-panel {
  container-type: inline-size;
}

.patient-task-side-panel *,
.patient-hospital-visit-tab-panel *,
.visit-flat-panel * {
  min-width: 0;
  box-sizing: border-box;
}

/* Task picker: adapt from multi-column cards to a single-column list in narrow panes. */
.patient-task-side-panel .task-panel-task-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 188px), 1fr));
  gap: 8px;
  width: 100%;
}

.patient-task-side-panel .task-panel-task-card {
  width: 100%;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  overflow: hidden;
}

.patient-task-side-panel .task-panel-task-card strong,
.patient-task-side-panel .task-panel-task-card small,
.patient-task-side-panel .task-panel-task-card span {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.patient-task-side-panel .task-panel-task-card em {
  max-width: 100%;
  white-space: nowrap;
}

/* Action tabs inside the task panel should wrap, not squeeze off-screen. */
.patient-task-side-panel .task-panel-mode-tabs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 112px), 1fr));
  gap: 8px;
  width: 100%;
}

.patient-task-side-panel .task-panel-mode-tabs button {
  width: 100%;
  min-height: 36px;
  white-space: normal;
  line-height: 1.25;
  text-align: center;
}

/* Hospital-visit tab action cards: auto-wrap based on actual container width. */
.visit-action-card-row,
.patient-hospital-visit-tab-panel .visit-action-card-row,
.visit-flat-panel .visit-action-card-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 132px), 1fr));
  gap: 8px;
  width: 100%;
}

.visit-action-card,
.patient-hospital-visit-tab-panel .visit-action-card,
.visit-flat-panel .visit-action-card {
  width: 100%;
  min-width: 0;
  min-height: 58px;
  overflow: hidden;
}

.visit-action-card span,
.visit-action-card small,
.patient-hospital-visit-tab-panel .visit-action-card span,
.patient-hospital-visit-tab-panel .visit-action-card small,
.visit-flat-panel .visit-action-card span,
.visit-flat-panel .visit-action-card small {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

/* Expanded action forms should stay inside the tab/panel width. */
.visit-action-expanded-form,
.patient-hospital-visit-tab-panel .visit-action-expanded-form,
.visit-flat-panel .visit-action-expanded-form {
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}

.visit-action-expanded-form textarea,
.visit-action-expanded-form input,
.visit-action-expanded-form select,
.patient-hospital-visit-tab-panel textarea,
.patient-hospital-visit-tab-panel input,
.patient-hospital-visit-tab-panel select,
.patient-task-side-panel textarea,
.patient-task-side-panel input,
.patient-task-side-panel select {
  max-width: 100%;
}

/* Compact rows should wrap cleanly when side panel is narrow. */
.visit-reminder-row,
.visit-reminder-main,
.visit-reminder-title-line,
.patient-hospital-visit-tab-panel .visit-reminder-row,
.patient-hospital-visit-tab-panel .visit-reminder-main,
.patient-hospital-visit-tab-panel .visit-reminder-title-line {
  min-width: 0;
}

.visit-reminder-title-line,
.patient-hospital-visit-tab-panel .visit-reminder-title-line {
  flex-wrap: wrap;
}

@container (max-width: 520px) {
  .patient-task-side-panel .task-panel-task-list,
  .visit-action-card-row,
  .patient-hospital-visit-tab-panel .visit-action-card-row,
  .visit-flat-panel .visit-action-card-row {
    grid-template-columns: 1fr;
  }

  .patient-task-side-panel .task-panel-task-card {
    grid-template-columns: 1fr;
  }

  .patient-task-side-panel .task-panel-task-card em {
    justify-self: start;
  }

  .patient-task-side-panel .task-panel-mode-tabs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container (max-width: 360px) {
  .patient-task-side-panel .task-panel-mode-tabs {
    grid-template-columns: 1fr;
  }
}
'''

# Append to files that may exist in the project. Keeping the block in both files is
# intentional: hospital-visit-tab-flat.css is loaded by the visit tab; patient-task-side-panel.css
# is loaded by the right processing panel. Some local branches may only have one of them.
targets = [
    ROOT / "apps/web/src/patient-task-side-panel.css",
    ROOT / "apps/web/src/hospital-visit-tab-flat.css",
]

updated = []
missing = []
for target in targets:
    if not target.exists():
        missing.append(str(target.relative_to(ROOT)))
        continue
    content = target.read_text(encoding="utf-8")
    if PATCH_MARKER in content:
        continue
    target.write_text(content.rstrip() + CSS + "\n", encoding="utf-8")
    updated.append(str(target.relative_to(ROOT)))

if updated:
    print("Applied responsive card fixes to:")
    for item in updated:
        print(f"- {item}")
else:
    print("No files changed; responsive card fixes were already present or target files were missing.")

if missing:
    print("Skipped missing files:")
    for item in missing:
        print(f"- {item}")
