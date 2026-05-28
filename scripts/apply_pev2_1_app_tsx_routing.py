#!/usr/bin/env python3
"""
apply_pev2_1_app_tsx_routing.py
--------------------------------
Wires apps/web/src/pages/HospitalWechatAccountPage.tsx into App.tsx:

  1. import HospitalWechatAccountPage  (default export)
  2. add NavItem with label '服务号配置', roles ADMIN
  3. add Route /hospital-wechat/account guarded by RoleRoute roles=['ADMIN']

Idempotent: marker check 'HospitalWechatAccountPage' in src.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

APP = Path("apps/web/src/App.tsx")

IMPORT_LINE = "import HospitalWechatAccountPage from './pages/HospitalWechatAccountPage';\n"

NAV_ITEM = """  {
    to: '/hospital-wechat/account',
    label: '服务号配置',
    hint: '本院公众号 / 模板消息',
    roles: ['ADMIN'],
  },
"""

ROUTE_BLOCK = """            <Route
              path="/hospital-wechat/account"
              element={
                <RoleRoute user={user} roles={['ADMIN']}>
                  <HospitalWechatAccountPage />
                </RoleRoute>
              }
            />
"""


def main() -> int:
    if not APP.exists():
        print(f"[err] {APP} not found", file=sys.stderr)
        return 1
    src = APP.read_text(encoding="utf-8")
    original = src
    notes = []

    # 1) import — anchor: after the PublicFormPage import (or any pages/ import).
    if "HospitalWechatAccountPage" not in src:
        anchor = "import { PublicFormPage } from './pages/PublicFormPage';"
        if anchor in src:
            src = src.replace(anchor, anchor + "\n" + IMPORT_LINE.rstrip("\n"), 1)
            notes.append("added HospitalWechatAccountPage import")
        else:
            # Fallback: prepend after the first pages/ import.
            m = re.search(r"^import .* from '\./pages/[^']+';\s*$", src, flags=re.MULTILINE)
            if m:
                src = src[: m.end()] + "\n" + IMPORT_LINE.rstrip("\n") + src[m.end():]
                notes.append("added HospitalWechatAccountPage import (fallback anchor)")
            else:
                print("[err] no pages/ import found to anchor after.", file=sys.stderr)
                return 1
    else:
        # check it's the right import (default) not a named one
        if "HospitalWechatAccountPage" in src and "{ HospitalWechatAccountPage }" in src:
            # rewrite to default import
            src = re.sub(
                r"import\s*\{\s*HospitalWechatAccountPage\s*\}\s*from\s*'\./pages/HospitalWechatAccountPage';",
                "import HospitalWechatAccountPage from './pages/HospitalWechatAccountPage';",
                src,
                count=1,
            )
            notes.append("fixed import to default")

    # 2) navItem — check if /hospital-wechat/account is in any to: '...' line.
    if "/hospital-wechat/account" not in src or "'服务号配置'" not in src:
        # Locate the closing `];` of the navItems array.
        m = re.search(r"(const\s+navItems\s*:\s*NavItem\[\]\s*=\s*\[)([\s\S]*?)(\];)", src)
        if not m:
            print("[err] navItems array not found", file=sys.stderr)
            return 1
        header, body, closer = m.group(1), m.group(2), m.group(3)
        if "/hospital-wechat/account" not in body:
            new_body = body.rstrip() + "\n" + NAV_ITEM
            src = src[: m.start()] + header + new_body + closer + src[m.end():]
            notes.append("added 服务号配置 nav item")

    # 3) route — anchor before the catch-all <Route path="*"... line.
    if "/hospital-wechat/account" not in src.split("<Routes>", 1)[-1] or "<HospitalWechatAccountPage" not in src:
        # Find: `<Route path="/login" element={<Navigate to={fallbackPath} replace />} />`
        login_anchor = re.search(
            r"^\s*<Route\s+path=\"/login\"\s+element=\{<Navigate\s+to=\{fallbackPath\}\s+replace\s*/>\}\s*/>\s*$",
            src,
            flags=re.MULTILINE,
        )
        if login_anchor and "<HospitalWechatAccountPage" not in src:
            src = src[: login_anchor.start()] + ROUTE_BLOCK + src[login_anchor.start():]
            notes.append("added /hospital-wechat/account Route")
        elif "<HospitalWechatAccountPage" not in src:
            print("[warn] could not find <Route path=\"/login\"... anchor; route NOT added. "
                  "Please add it manually.")

    if src == original:
        print("[skip] App.tsx already wired for HospitalWechatAccountPage.")
        return 0

    APP.write_text(src, encoding="utf-8")
    print("[ok] App.tsx patched:")
    for n in notes:
        print(f"     - {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
