#!/usr/bin/env python3
"""
apply_v3_frontend_routing.py
-----------------------------
Wire CareRemindersPanel into PatientDetailPage + CareRemindersPage into App.tsx.

PatientDetailPage.tsx edits:
  1. add `'care-reminders'` to the PatientDetailWorkspace union
  2. add it to isPatientDetailWorkspace()
  3. add a tab entry in patientDetailWorkspaceTabs
  4. add a render block: {activeWorkspace === 'care-reminders' && <CareRemindersPanel .../>}
  5. import CareRemindersPanel

App.tsx edits:
  1. import CareRemindersPage
  2. add navItem `/care-reminders` (ADMIN, DOCTOR, NURSE)
  3. add Route with RoleRoute

All idempotent.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

PAGE = Path("apps/web/src/pages/PatientDetailPage.tsx")
APP = Path("apps/web/src/App.tsx")

PANEL_IMPORT = "import CareRemindersPanel from '../components/CareRemindersPanel';\n"

TAB_ENTRY = "  { key: 'care-reminders', title: '慢病提醒', description: '长期计划 / 今日提醒 / 主动消息' },\n"

RENDER_BLOCK = """
      {/* care-reminders v3 */}
      {activeWorkspace === 'care-reminders' && (
        <section className="panel">
          <CareRemindersPanel patientId={patientId!} canEdit={true} />
        </section>
      )}

"""

APP_IMPORT = "import CareRemindersPage from './pages/CareRemindersPage';\n"

APP_NAV_ITEM = """  {
    to: '/care-reminders',
    label: '慢病提醒中心',
    hint: '今日 / 未完成 / 主动消息',
    roles: ['ADMIN', 'DOCTOR', 'NURSE'],
  },
"""

APP_ROUTE = """            <Route
              path="/care-reminders"
              element={
                <RoleRoute user={user} roles={['ADMIN', 'DOCTOR', 'NURSE']}>
                  <CareRemindersPage />
                </RoleRoute>
              }
            />
"""


def patch_patient_detail() -> bool:
    if not PAGE.exists():
        print(f"[err] {PAGE} not found", file=sys.stderr)
        return False
    src = PAGE.read_text(encoding="utf-8")
    original = src
    notes: list[str] = []

    # 1) import
    if "CareRemindersPanel" not in src:
        # anchor: after `import { PatientEngagementTab } from ...` or any from '../components/'
        m = re.search(r"^import .* from '\.\./components/PatientEngagementTab';\s*$", src, flags=re.MULTILINE)
        if m:
            src = src[: m.end()] + "\n" + PANEL_IMPORT.rstrip("\n") + src[m.end():]
        else:
            m2 = re.search(r"^import .* from '\.\./components/[^']+';\s*$", src, flags=re.MULTILINE)
            if m2:
                src = src[: m2.end()] + "\n" + PANEL_IMPORT.rstrip("\n") + src[m2.end():]
            else:
                # last resort: prepend to top
                src = PANEL_IMPORT + src
        notes.append("PatientDetailPage import added")

    # 2) PatientDetailWorkspace union
    if "'care-reminders'" not in src:
        union_pattern = re.compile(
            r"(type PatientDetailWorkspace = (?:'[^']+'\s*\|\s*)+'timeline';)"
        )
        m = union_pattern.search(src)
        if m:
            new = m.group(1).replace("'timeline'", "'care-reminders' | 'timeline'", 1)
            src = src.replace(m.group(1), new, 1)
            notes.append("PatientDetailWorkspace union widened")

    # 3) isPatientDetailWorkspace
    if "value === 'care-reminders'" not in src:
        src = re.sub(
            r"(value === 'patient-engagement' \|\|\s*\n\s*)(value === 'timeline')",
            r"\1value === 'care-reminders' ||\n    \2",
            src,
            count=1,
        )
        if "value === 'care-reminders'" in src:
            notes.append("isPatientDetailWorkspace updated")

    # 4) tab entry in patientDetailWorkspaceTabs
    if "key: 'care-reminders'" not in src:
        anchor = "  { key: 'patient-engagement', title: '微信随访'"
        if anchor in src:
            # insert AFTER this line
            i = src.index(anchor)
            line_end = src.index("\n", i) + 1
            src = src[:line_end] + TAB_ENTRY + src[line_end:]
            notes.append("patientDetailWorkspaceTabs entry added")

    # 5) render block — insert AFTER the patient-engagement render block
    if "activeWorkspace === 'care-reminders'" not in src:
        m = re.search(
            r"\{activeWorkspace === 'patient-engagement' &&[\s\S]*?\)\}\s*\n",
            src,
        )
        if m:
            src = src[: m.end()] + RENDER_BLOCK + src[m.end():]
            notes.append("render block inserted")
        else:
            print("[warn] could not find patient-engagement render block; render NOT inserted.")

    if src == original:
        print(f"[skip] {PAGE.name} already wired for care-reminders.")
    else:
        PAGE.write_text(src, encoding="utf-8")
        print(f"[ok] {PAGE.name} patched:")
        for n in notes:
            print(f"     - {n}")
    return True


def patch_app_tsx() -> bool:
    if not APP.exists():
        print(f"[err] {APP} not found", file=sys.stderr)
        return False
    src = APP.read_text(encoding="utf-8")
    original = src
    notes: list[str] = []

    # 1) import
    if "CareRemindersPage" not in src:
        # anchor: after HospitalWechatAccountPage import (which v2.1 added) or other pages
        m = re.search(r"^import .* from '\./pages/HospitalWechatAccountPage';\s*$", src, flags=re.MULTILINE)
        if m:
            src = src[: m.end()] + "\n" + APP_IMPORT.rstrip("\n") + src[m.end():]
        else:
            m2 = re.search(r"^import .* from '\./pages/[^']+';\s*$", src, flags=re.MULTILINE)
            if m2:
                src = src[: m2.end()] + "\n" + APP_IMPORT.rstrip("\n") + src[m2.end():]
        notes.append("CareRemindersPage import added")

    # 2) nav item
    if "/care-reminders" not in src or "'慢病提醒中心'" not in src:
        m = re.search(r"(const\s+navItems\s*:\s*NavItem\[\]\s*=\s*\[)([\s\S]*?)(\];)", src)
        if not m:
            print("[err] navItems array not found", file=sys.stderr)
            return False
        header, body, closer = m.group(1), m.group(2), m.group(3)
        if "/care-reminders" not in body:
            new_body = body.rstrip() + "\n" + APP_NAV_ITEM
            src = src[: m.start()] + header + new_body + closer + src[m.end():]
            notes.append("nav item added")

    # 3) route
    has_route = False
    if "<CareRemindersPage" in src:
        has_route = True
    if not has_route:
        login_anchor = re.search(
            r"^\s*<Route\s+path=\"/login\"\s+element=\{<Navigate\s+to=\{fallbackPath\}\s+replace\s*/>\}\s*/>\s*$",
            src,
            flags=re.MULTILINE,
        )
        if login_anchor:
            src = src[: login_anchor.start()] + APP_ROUTE + src[login_anchor.start():]
            notes.append("/care-reminders route added")
        else:
            print("[warn] could not find Route /login anchor; route NOT added.")

    if src == original:
        print(f"[skip] {APP.name} already wired for care-reminders.")
    else:
        APP.write_text(src, encoding="utf-8")
        print(f"[ok] {APP.name} patched:")
        for n in notes:
            print(f"     - {n}")
    return True


def main() -> int:
    ok1 = patch_patient_detail()
    ok2 = patch_app_tsx()
    return 0 if (ok1 and ok2) else 1


if __name__ == "__main__":
    sys.exit(main())
