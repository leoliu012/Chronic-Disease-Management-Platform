#!/usr/bin/env python3
"""
apply_care_reminders_v3_1_frontend.py
-------------------------------------
Idempotent React/TS frontend patcher for care-reminders v3.1.

Touches two files in place:

  1. apps/web/src/api/care-reminders.ts
        ~ listTodayOccurrences() now sends a ±24h from/to window.
        + sourceSummary on the CareReminderSchedule type.
        + ResendResult type + resendOccurrence() client.

  2. apps/web/src/pages/PatientDetailPage.tsx
        ~ <CareRemindersPanel> now receives onNavigateToSource, jumping to the
          'medication' / 'monitoring' workspaces (the real keys in this repo).

The CareRemindersPanel.tsx + CareRemindersPage.tsx full files are shipped by
the patch ZIP (rsync), so this script does not touch them.

Run from repo root:
    python3 scripts/apply_care_reminders_v3_1_frontend.py
"""
from __future__ import annotations

import sys
from pathlib import Path

API = Path("apps/web/src/api/care-reminders.ts")
PDP = Path("apps/web/src/pages/PatientDetailPage.tsx")

changed = False


def fail(msg: str) -> None:
    print(f"[err] {msg}", file=sys.stderr)
    sys.exit(1)


def need(path: Path) -> str:
    if not path.exists():
        fail(f"missing {path} (run from repo root; is care-reminders v3 applied?)")
    return path.read_text(encoding="utf-8")


def apply(path: Path, src: str, old: str, new: str, marker: str, label: str) -> str:
    global changed
    if marker in src:
        print(f"[skip] {label} — already applied")
        return src
    if old not in src:
        fail(f"[{label}] anchor not found in {path}")
    src = src.replace(old, new, 1)
    path.write_text(src, encoding="utf-8")
    changed = True
    print(f"[ok] {label}")
    return src


# ---------------------------------------------------------------------------
# 1. api/care-reminders.ts
# ---------------------------------------------------------------------------
API_TYPE_OLD = """  _count?: { occurrences?: number };
};"""

API_TYPE_NEW = """  _count?: { occurrences?: number };
  // care-reminders v3.1: lightweight summary of the bound medication / vital
  // plan so the panel can render a binding view + deep-link to the right tab.
  sourceSummary?: {
    type: string;
    id: string | null;
    title: string;
    subtitle: string;
    status: string;
  } | null;
};"""

API_TODAY_OLD = """export function listTodayOccurrences() {
  return apiFetch<CareReminderOccurrence[]>(`/care-reminders/today`);
}"""

API_TODAY_NEW = """export function listTodayOccurrences() {
  // care-reminders v3.1: default the "today" view to a ±24h window.
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return apiFetch<CareReminderOccurrence[]>(`/care-reminders/today${q}`);
}"""

API_RESEND_OLD = """export function sendOccurrenceNow(id: string) {
  return apiFetch<{ reused: boolean; occurrence: CareReminderOccurrence }>(
    `/care-reminders/occurrences/${id}/send-now`,
    { method: 'POST' },
  );
}"""

API_RESEND_NEW = """export function sendOccurrenceNow(id: string) {
  return apiFetch<{ reused: boolean; occurrence: CareReminderOccurrence }>(
    `/care-reminders/occurrences/${id}/send-now`,
    { method: 'POST' },
  );
}

// care-reminders v3.1: re-send an already-delivered reminder.
export type ResendResult = {
  occurrence: CareReminderOccurrence;
  message: { id: string; status: string; channel: string } | null;
  formLink: { id: string };
  reusedLink: boolean;
};

export function resendOccurrence(id: string) {
  return apiFetch<ResendResult>(`/care-reminders/occurrences/${id}/resend`, {
    method: 'POST',
  });
}"""


# ---------------------------------------------------------------------------
# 2. pages/PatientDetailPage.tsx — wire onNavigateToSource
# ---------------------------------------------------------------------------
PDP_OLD = """      {/* care-reminders v3 */}
      {activeWorkspace === 'care-reminders' && (
        <section className="panel">
          <CareRemindersPanel patientId={patientId!} canEdit={true} />
        </section>
      )}"""

PDP_NEW = """      {/* care-reminders v3.1 — schedules are a binding view; "查看/修改用药计划"
          and "查看/修改指标监测" jump to the medication / monitoring workspaces. */}
      {activeWorkspace === 'care-reminders' && (
        <section className="panel">
          <CareRemindersPanel
            patientId={patientId!}
            canEdit={true}
            onNavigateToSource={(sourceType) => {
              if (sourceType === 'MEDICATION') setActiveWorkspace('medication');
              else if (sourceType === 'VITAL') setActiveWorkspace('monitoring');
            }}
          />
        </section>
      )}"""


def main() -> int:
    # 1. api client
    api_src = need(API)
    api_src = apply(API, api_src, API_TYPE_OLD, API_TYPE_NEW, "sourceSummary?:",
                    "api: CareReminderSchedule.sourceSummary")
    api_src = apply(API, api_src, API_TODAY_OLD, API_TODAY_NEW, "±24h window",
                    "api: listTodayOccurrences ±24h")
    api_src = apply(API, api_src, API_RESEND_OLD, API_RESEND_NEW, "export function resendOccurrence",
                    "api: resendOccurrence client")

    # 2. PatientDetailPage wiring
    pdp_src = need(PDP)
    apply(PDP, pdp_src, PDP_OLD, PDP_NEW, "onNavigateToSource",
          "PatientDetailPage: onNavigateToSource wiring")

    print("[done] frontend patch " + ("applied changes." if changed else "was already fully applied."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
