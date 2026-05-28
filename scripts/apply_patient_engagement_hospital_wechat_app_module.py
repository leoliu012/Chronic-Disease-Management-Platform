#!/usr/bin/env python3
"""
apply_patient_engagement_hospital_wechat_app_module.py
-------------------------------------------------------
Idempotent. Does two things:

  1) Confirm `PatientEngagementModule` is imported / wired in app.module.ts.
     (v1 already does this; this is a sanity check.)

  2) Update apps/api/.env:
       - Add `PATIENT_ENGAGEMENT_SECRET_KEY=dev_patient_engagement_secret_change_me`
         if not present.
       - Replace the v1 "平台微信服务号" comment block with a v2
         "本院微信服务号" comment marking the WECHAT_OFFICIAL_ACCOUNT_* vars
         as deprecated runtime no-ops.
"""
from __future__ import annotations

import sys
from pathlib import Path

APP_MODULE = Path("apps/api/src/app.module.ts")
ENV_FILE   = Path("apps/api/.env")


# ---------------------------------------------------------------------------
# app.module.ts — just verify
# ---------------------------------------------------------------------------

def check_app_module() -> bool:
    if not APP_MODULE.exists():
        print(f"[err] {APP_MODULE} not found", file=sys.stderr)
        return False
    src = APP_MODULE.read_text(encoding="utf-8")
    if "PatientEngagementModule" not in src:
        print(f"[err] {APP_MODULE} does not import PatientEngagementModule. "
              "Apply the v1 patch first.", file=sys.stderr)
        return False
    print("[ok] app.module.ts already imports PatientEngagementModule.")
    return True


# ---------------------------------------------------------------------------
# .env — deprecate global wechat vars, add PATIENT_ENGAGEMENT_SECRET_KEY
# ---------------------------------------------------------------------------

V1_COMMENT = "# 平台微信服务号 (一套服务号统一承载多医院触达, 各医院不需要自己接服务号)"

V2_COMMENT = (
    "# patient_engagement_hospital_wechat_v2\n"
    "# 本院微信服务号 — 每家医院自己一个服务号, 配置存在 DB (HospitalWechatOfficialAccount),\n"
    "# 不再从 .env 读取. 以下变量保留只是为了向后兼容, 运行时已不再使用,\n"
    "# 可在下一个版本中直接删除.\n"
    "# [DEPRECATED — runtime no-op]"
)

SECRET_LINE = "PATIENT_ENGAGEMENT_SECRET_KEY=dev_patient_engagement_secret_change_me"


def patch_env() -> bool:
    if not ENV_FILE.exists():
        print(f"[err] {ENV_FILE} not found", file=sys.stderr)
        return False

    src = ENV_FILE.read_text(encoding="utf-8")
    original = src
    notes = []

    # 1) Insert PATIENT_ENGAGEMENT_SECRET_KEY if absent.
    if "PATIENT_ENGAGEMENT_SECRET_KEY=" not in src:
        # Place near PATIENT_FORM_TOKEN_SECRET if possible.
        anchor = "PATIENT_FORM_TOKEN_SECRET="
        if anchor in src:
            idx = src.find("\n", src.find(anchor))
            if idx > 0:
                src = src[: idx + 1] + SECRET_LINE + "\n" + src[idx + 1 :]
            else:
                src = src.rstrip() + "\n" + SECRET_LINE + "\n"
        else:
            src = src.rstrip() + "\n\n" + SECRET_LINE + "\n"
        notes.append("added PATIENT_ENGAGEMENT_SECRET_KEY")

    # 2) Replace v1 comment block.
    if V1_COMMENT in src:
        src = src.replace(V1_COMMENT, V2_COMMENT, 1)
        notes.append("deprecated 平台微信服务号 comment")
    elif "[DEPRECATED — runtime no-op]" in src or "本院微信服务号" in src:
        # already patched
        pass
    else:
        # Try a softer fallback: just prepend the deprecated comment before
        # WECHAT_OFFICIAL_ACCOUNT_ENABLED if the v1 comment isn't there.
        anchor = "WECHAT_OFFICIAL_ACCOUNT_ENABLED="
        if anchor in src and "本院微信服务号" not in src:
            src = src.replace(anchor, V2_COMMENT + "\n" + anchor, 1)
            notes.append("injected v2 deprecation comment before WECHAT_OFFICIAL_ACCOUNT_*")

    if src == original:
        print("[skip] .env already at v2.")
        return True

    ENV_FILE.write_text(src, encoding="utf-8")
    print("[ok] .env patched:")
    for n in notes:
        print(f"     - {n}")
    return True


def main() -> int:
    ok1 = check_app_module()
    ok2 = patch_env()
    return 0 if (ok1 and ok2) else 1


if __name__ == "__main__":
    sys.exit(main())
