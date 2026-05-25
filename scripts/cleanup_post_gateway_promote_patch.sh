#!/usr/bin/env bash
# scripts/cleanup_post_gateway_promote_patch.sh
#
# gateway-promote-pipeline 补丁应用之后必须跑一次的卫生清理。
# 因为 rsync 只能 ADD/OVERWRITE，无法删除 source tree 已经废弃的文件，
# 所以这些删除动作单独抽出来。
#
# 全部用 `rm -f`：找不到文件不会报错，重复跑也是安全的。
#
# 用法（从仓库根目录跑）：
#   bash scripts/cleanup_post_gateway_promote_patch.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Cleaning up legacy artifacts in $ROOT_DIR"

# 旧的 .bak — 与当前页面/CSS 完全分叉，留着只会让 grep 命中两次
rm -f apps/web/src/pages/PatientDetailPage.tsx.bak
rm -f apps/web/src/patient-detail-task-ux-polish.css.bak

# 旧 PATCH_NOTES 的草稿（如果之前手工保存过；不存在就跳过）
rm -f PATCH_NOTES.draft.md

echo "==> Cleanup done."
echo "    Recommended next steps:"
echo "    1) cd apps/api && npx prisma migrate dev      # apply 20260525120000_add_integration_promote"
echo "    2) cd apps/api && npx prisma generate"
echo "    3) cd apps/api && node scripts/register-quality-scripts.js"
echo "    4) cd apps/api && node prisma/seed-all.js"
echo "    5) cd apps/api && node scripts/doctor.js"
echo "    6) cd apps/api && npm run start:dev           # in one terminal"
echo "    7) cd apps/api && npm run smoke:all           # in another terminal"
