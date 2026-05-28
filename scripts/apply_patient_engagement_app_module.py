#!/usr/bin/env python3
"""
apply_patient_engagement_app_module.py
---------------------------------------
Idempotent patcher for:
  * apps/api/src/app.module.ts  — register PatientEngagementModule
  * apps/api/.env               — append env keys (dev defaults)

Safe to run multiple times.
"""
from __future__ import annotations

import sys
from pathlib import Path

APP_MODULE = Path("apps/api/src/app.module.ts")
ENV_FILE = Path("apps/api/.env")

IMPORT_LINE = "import { PatientEngagementModule } from './patient-engagement/patient-engagement.module';"
IMPORT_MARKER = "from './chronic-leads/chronic-leads.module';"

REGISTRATION_LINE = "    PatientEngagementModule,"
REGISTRATION_MARKER = "ChronicLeadsModule,"


def patch_app_module() -> bool:
    if not APP_MODULE.exists():
        print(f"[skip] {APP_MODULE} not found.")
        return False
    src = APP_MODULE.read_text(encoding="utf-8")
    original = src
    if IMPORT_LINE not in src:
        # Insert after ChronicLeadsModule import.
        idx = src.find(IMPORT_MARKER)
        if idx == -1:
            print("[warn] couldn't locate ChronicLeadsModule import; appending at the end of imports block.")
            # Fallback: insert after last `import ... from '...';` line.
            lines = src.splitlines(keepends=True)
            last_import = max(i for i, ln in enumerate(lines) if ln.lstrip().startswith("import "))
            lines.insert(last_import + 1, IMPORT_LINE + "\n")
            src = "".join(lines)
        else:
            end_of_line = src.find("\n", idx)
            src = src[: end_of_line + 1] + IMPORT_LINE + "\n" + src[end_of_line + 1 :]
    if REGISTRATION_LINE.strip() not in src:
        # Insert just after ChronicLeadsModule, in the imports array.
        marker_idx = src.find(REGISTRATION_MARKER)
        if marker_idx == -1:
            print("[warn] couldn't locate ChronicLeadsModule registration; skipping registration insert.")
        else:
            end_of_line = src.find("\n", marker_idx)
            src = src[: end_of_line + 1] + REGISTRATION_LINE + "\n" + src[end_of_line + 1 :]
    if src == original:
        print("[skip] app.module.ts already patched.")
        return False
    APP_MODULE.write_text(src, encoding="utf-8")
    print("[ok] app.module.ts patched.")
    return True


ENV_BLOCK = """
# patient-engagement-wechat-h5-v1
# H5 链接 base URL；patient 点击的链接形如 ${PATIENT_ENGAGEMENT_BASE_URL}/wx/form/<token>
PATIENT_ENGAGEMENT_BASE_URL=http://localhost:5173
# 对 token / recipient hash / form session 做 HMAC 的密钥；上线前请替换
PATIENT_FORM_TOKEN_SECRET=dev_change_me

# 平台微信服务号 (一套服务号统一承载多医院触达, 各医院不需要自己接服务号)
WECHAT_OFFICIAL_ACCOUNT_ENABLED=false
WECHAT_OFFICIAL_ACCOUNT_APP_ID=
WECHAT_OFFICIAL_ACCOUNT_APP_SECRET=
WECHAT_OFFICIAL_ACCOUNT_TEMPLATE_QUESTIONNAIRE=
WECHAT_OFFICIAL_ACCOUNT_TEMPLATE_VITAL=
WECHAT_OFFICIAL_ACCOUNT_TEMPLATE_MEDICATION=
WECHAT_OFFICIAL_ACCOUNT_TEMPLATE_HOSPITAL_VISIT=
# dev 默认 mock 微信调用，仍会写 PatientOutboundMessage 并显示"模拟发送成功"
WECHAT_OFFICIAL_ACCOUNT_MOCK=true

# 短信兜底；dev 默认 mock，不接入真实 SaaS
SMS_ENABLED=false
SMS_PROVIDER=mock
SMS_MOCK=true
"""


def patch_env() -> bool:
    if not ENV_FILE.exists():
        print(f"[skip] {ENV_FILE} not found.")
        return False
    src = ENV_FILE.read_text(encoding="utf-8")
    if "PATIENT_ENGAGEMENT_BASE_URL" in src:
        print("[skip] .env already contains patient-engagement keys.")
        return False
    if not src.endswith("\n"):
        src += "\n"
    src += ENV_BLOCK
    ENV_FILE.write_text(src, encoding="utf-8")
    print("[ok] .env patched.")
    return True


def main() -> int:
    patch_app_module()
    patch_env()
    return 0


if __name__ == "__main__":
    sys.exit(main())
