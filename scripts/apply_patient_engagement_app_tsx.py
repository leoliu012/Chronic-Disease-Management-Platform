#!/usr/bin/env python3
"""
apply_patient_engagement_app_tsx.py
------------------------------------
Idempotent patcher for apps/web/src/App.tsx.

Adds:
  - import { PublicFormPage } from './pages/PublicFormPage';
  - Wrap AppContent body so requests to /wx/form/:token render PublicFormPage
    BEFORE the auth wall (no login required).
"""
from __future__ import annotations

import sys
from pathlib import Path

APP_TSX = Path("apps/web/src/App.tsx")

IMPORT_LINE = "import { PublicFormPage } from './pages/PublicFormPage';"
IMPORT_AFTER = "import { OperationToastHost } from './components/OperationToastHost';"

MARKER = "// patient-engagement-wechat-h5-v1 public route"

# Inserted at the very top of AppContent(); intercepts /wx/form/:token before
# the existing currentUser check. We use Routes/Route so React Router still
# does the param parsing.
NEW_TOP_OF_APPCONTENT = """  // patient-engagement-wechat-h5-v1 public route
  // Patient-facing H5 form lives outside the auth wall and outside the
  // AuthenticatedShell layout. We match BEFORE the `!currentUser` branch so
  // we never redirect to /login.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/wx/form/')) {
    return (
      <Routes>
        <Route path="/wx/form/:token" element={<PublicFormPage />} />
      </Routes>
    );
  }

"""


def main() -> int:
    if not APP_TSX.exists():
        print(f"[skip] {APP_TSX} not found.")
        return 0
    src = APP_TSX.read_text(encoding="utf-8")
    original = src

    if IMPORT_LINE not in src:
        idx = src.find(IMPORT_AFTER)
        if idx == -1:
            print("[warn] couldn't find anchor import; inserting at top.")
            src = IMPORT_LINE + "\n" + src
        else:
            end = src.find("\n", idx)
            src = src[: end + 1] + IMPORT_LINE + "\n" + src[end + 1 :]

    if MARKER not in src:
        anchor = "function AppContent() {\n"
        idx = src.find(anchor)
        if idx == -1:
            print("[warn] couldn't find AppContent() opening brace; route not added.")
        else:
            insertion_at = idx + len(anchor)
            src = src[:insertion_at] + NEW_TOP_OF_APPCONTENT + src[insertion_at:]

    if src == original:
        print("[skip] App.tsx already patched.")
        return 0
    APP_TSX.write_text(src, encoding="utf-8")
    print("[ok] App.tsx patched.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
