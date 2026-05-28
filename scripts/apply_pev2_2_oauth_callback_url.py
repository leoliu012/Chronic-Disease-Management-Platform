#!/usr/bin/env python3
"""
apply_pev2_2_oauth_callback_url.py
-----------------------------------
v2.2 hotfix — separate frontend H5 base URL from the backend API base URL.

PROBLEM
-------
WechatOAuthController.start() built the callback as:

    const baseUrl = process.env.PATIENT_ENGAGEMENT_BASE_URL || 'http://localhost:5173';
    const callback = `${baseUrl}/api/patient-engagement/wechat/oauth/callback`;

That hits the Vite dev server (5173), not Nest (3000), and Nest has no global
`/api` prefix, so the URL is wrong twice over.

FIX
---
- New env: PATIENT_ENGAGEMENT_API_BASE_URL  (defaults to http://localhost:3000)
- public-form.controller.ts uses it for callback construction; the `/api/` prefix
  is removed (Nest mounts the controller at /patient-engagement/wechat/oauth/...)
- PATIENT_ENGAGEMENT_BASE_URL keeps its existing meaning (patient H5 frontend)

Two files touched:
  apps/api/src/patient-engagement/public-form.controller.ts
  apps/api/.env

Idempotent.
"""
from __future__ import annotations
import sys
from pathlib import Path

CONTROLLER = Path("apps/api/src/patient-engagement/public-form.controller.ts")
ENV_FILE = Path("apps/api/.env")

# ----------------------------------------------------------------------------
# 1) Fix the callback construction inside start()
# ----------------------------------------------------------------------------

BROKEN_START_BLOCK = """    const baseUrl = (process.env.PATIENT_ENGAGEMENT_BASE_URL || 'http://localhost:5173').replace(/\\/+$/, '');
    const callback = `${baseUrl}/api/patient-engagement/wechat/oauth/callback`;"""

FIXED_START_BLOCK = """    // v2.2: callback must hit the Nest API host, NOT the patient H5 host.
    // Nest has no global /api prefix, so the path is /patient-engagement/wechat/oauth/callback.
    // Production usually puts a reverse proxy (Nginx) in front; the env var lets
    // the deployer point this at whatever public hostname the API is served on.
    const apiBaseUrl = (
      process.env.PATIENT_ENGAGEMENT_API_BASE_URL ||
      process.env.API_PUBLIC_BASE_URL ||
      'http://localhost:3000'
    ).replace(/\\/+$/, '');
    const callback = `${apiBaseUrl}/patient-engagement/wechat/oauth/callback`;"""

# ----------------------------------------------------------------------------
# 2) .env additions
# ----------------------------------------------------------------------------

ENV_ADDITION = """
# patient_engagement_hospital_wechat_v2_2
# 拆分两个 base URL — 一个给患者 H5 页 (Vite/前端), 一个给后端 OAuth callback.
# 生产环境通常在 Nginx 上反代; 把这两个换成对外公网域名即可.
PATIENT_ENGAGEMENT_API_BASE_URL=http://localhost:3000

# 短信兜底当前仍是 mock adapter — 真实接入 (阿里云 / 腾讯云 / 院内短信平台) 待办.
# SMS_MOCK=true 时不真实发送, 只在日志里打印.
"""


def patch_controller() -> bool:
    if not CONTROLLER.exists():
        print(f"[err] {CONTROLLER} not found", file=sys.stderr)
        return False
    src = CONTROLLER.read_text(encoding="utf-8")
    if "PATIENT_ENGAGEMENT_API_BASE_URL" in src:
        print(f"[skip] {CONTROLLER.name} already uses PATIENT_ENGAGEMENT_API_BASE_URL.")
        return True
    if BROKEN_START_BLOCK not in src:
        print(f"[warn] {CONTROLLER.name} — couldn't locate the v2.1 callback construction "
              "block verbatim. Either it's already been edited or v2.1 wasn't applied.")
        return True
    src = src.replace(BROKEN_START_BLOCK, FIXED_START_BLOCK, 1)
    CONTROLLER.write_text(src, encoding="utf-8")
    print(f"[ok] {CONTROLLER.name} — OAuth callback URL now uses PATIENT_ENGAGEMENT_API_BASE_URL")
    return True


def patch_env() -> bool:
    if not ENV_FILE.exists():
        print(f"[err] {ENV_FILE} not found", file=sys.stderr)
        return False
    src = ENV_FILE.read_text(encoding="utf-8")
    if "PATIENT_ENGAGEMENT_API_BASE_URL" in src:
        print(f"[skip] {ENV_FILE.name} already declares PATIENT_ENGAGEMENT_API_BASE_URL.")
        return True
    if not src.endswith("\n"):
        src += "\n"
    src += ENV_ADDITION
    ENV_FILE.write_text(src, encoding="utf-8")
    print(f"[ok] {ENV_FILE.name} — added PATIENT_ENGAGEMENT_API_BASE_URL + SMS note")
    return True


def main() -> int:
    ok1 = patch_controller()
    ok2 = patch_env()
    return 0 if (ok1 and ok2) else 1


if __name__ == "__main__":
    sys.exit(main())
