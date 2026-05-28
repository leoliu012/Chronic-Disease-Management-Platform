#!/usr/bin/env python3
"""
apply_patient_engagement_hospital_wechat_app_tsx.py
----------------------------------------------------
Bug 2 fix: AppContent() returns early for the /wx/form/... public route
BEFORE calling useState/useEffect. When the user navigates from the public
form back into the authenticated app (or hot-reloads while on the public
route), React sees a different hook count than the previous render and
throws "Rendered fewer hooks than expected".

Fix:
  - Move all hook calls (useState, useEffect) to the top of AppContent,
    BEFORE the public-route check.
  - Hooks must run unconditionally on every render — that's the rule.

This patcher locates `function AppContent()` and brace-matches to its closing
`}`, replacing the entire body with the v2 hooks-first version.

Idempotent: detects v2 by the marker comment `// hooks-first (Bug 2 fix)`.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

APP = Path("apps/web/src/App.tsx")

V2_BODY = '''function AppContent() {
  // hooks-first (Bug 2 fix) — every hook below MUST run on every render,
  // including renders where we end up returning the public-route subtree.
  // Doing the early `return <Routes>...</Routes>` before useState used to
  // produce React's "Rendered fewer hooks than expected" error when a user
  // navigated between /wx/form/... and the rest of the app.
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => readStoredUser());

  useEffect(() => {
    function handle() {
      setCurrentUser(null);
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, handle);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handle);
    };
  }, []);

  function logout() {
    manualLogout();
    setCurrentUser(null);
  }

  // patient_engagement_hospital_wechat_v2:
  // Patient-facing H5 form lives outside the auth wall and outside the
  // AuthenticatedShell layout. We match AFTER the hooks have been declared.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/wx/form/')) {
    return (
      <Routes>
        <Route path="/wx/form/:token" element={<PublicFormPage />} />
      </Routes>
    );
  }

  if (!currentUser) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onLogin={setCurrentUser} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return <AuthenticatedShell user={currentUser} onLogout={logout} />;
}'''


def main() -> int:
    if not APP.exists():
        print(f"[err] {APP} not found", file=sys.stderr)
        return 1
    src = APP.read_text(encoding="utf-8")

    if "hooks-first (Bug 2 fix)" in src:
        print("[skip] App.tsx already has v2 AppContent.")
        return 0

    # Locate `function AppContent() {` and find the matching closing brace.
    start_re = re.compile(r"function\s+AppContent\s*\(\s*\)\s*\{", re.MULTILINE)
    m = start_re.search(src)
    if not m:
        print("[err] could not find `function AppContent() {` in App.tsx", file=sys.stderr)
        return 1

    func_start = m.start()
    brace_start = m.end() - 1  # position of the opening `{`
    depth = 0
    i = brace_start
    # Brace-match. Naive — but this function has no template literals or
    # regexes inside that would confuse simple counting.
    while i < len(src):
        ch = src[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    if depth != 0:
        print("[err] failed to brace-match AppContent body", file=sys.stderr)
        return 1
    func_end = i + 1  # inclusive of the closing brace

    new_src = src[:func_start] + V2_BODY + src[func_end:]

    if new_src == src:
        print("[skip] App.tsx unchanged.")
        return 0

    APP.write_text(new_src, encoding="utf-8")
    print("[ok] App.tsx patched: AppContent rewritten with hooks-first ordering (Bug 2 fix).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
