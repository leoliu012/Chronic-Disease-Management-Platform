#!/usr/bin/env python3
"""
apply_patient_engagement_miniprogram_copy.py
---------------------------------------------
Idempotent patcher for the WeChat mini-program 'home' page copy.

We are NOT removing the binding flow — it's still useful for patients who
want long-term self-management. But we are softening the copy so:
  1. Patients arriving via H5 link don't feel they MUST bind
  2. Binding is positioned as the deeper / long-term experience
  3. Failure to bind is not a blocker

Only touches apps/wechat-miniprogram/pages/home/index.wxml.
"""
from __future__ import annotations

import sys
from pathlib import Path

HOME_WXML = Path("apps/wechat-miniprogram/pages/home/index.wxml")

OLD_BLOCK = (
    "  <view wx:if=\"{{!patientId}}\" class=\"card unbound-card\">\n"
    "    <view class=\"card-title\">请先绑定患者档案</view>\n"
    "    <view class=\"card-subtitle\">绑定后可进行院外血压、血糖、血氧等数据上报，并查看用药打卡、健康问卷、护士提醒和风险预警。</view>\n"
    "    <view class=\"primary-btn bind-btn tap-btn\" hover-class=\"tap-btn-hover\" catchtap=\"goBind\">立即绑定</view>\n"
    "  </view>"
)

NEW_BLOCK = (
    "  <!-- patient-engagement-wechat-h5-v1: 入口降为可选深度功能, 非主路径. -->\n"
    "  <view wx:if=\"{{!patientId}}\" class=\"card unbound-card\">\n"
    "    <view class=\"card-title\">我的长期管理</view>\n"
    "    <view class=\"card-subtitle\">您可以在医院发给您的服务号通知或短信链接中直接填写问卷与上报数据，无需绑定即可完成本次随访。如果希望长期查看自己的指标趋势、用药计划与护士提醒，可以选择绑定院内档案。</view>\n"
    "    <view class=\"primary-btn bind-btn tap-btn\" hover-class=\"tap-btn-hover\" catchtap=\"goBind\">绑定院内档案（可选）</view>\n"
    "  </view>"
)


def main() -> int:
    if not HOME_WXML.exists():
        print(f"[skip] {HOME_WXML} not found.")
        return 0
    src = HOME_WXML.read_text(encoding="utf-8")
    if NEW_BLOCK in src:
        print("[skip] mini-program home wxml already softened.")
        return 0
    if OLD_BLOCK not in src:
        print("[warn] couldn't locate original unbound-card block; mini-program copy not changed.")
        return 0
    src = src.replace(OLD_BLOCK, NEW_BLOCK, 1)
    HOME_WXML.write_text(src, encoding="utf-8")
    print("[ok] mini-program home wxml softened.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
