# APPLY — patient_engagement_hospital_wechat_v2

## 1. 解压到仓库根

```bash
ZIP="$HOME/Downloads/patient_engagement_hospital_wechat_v2_fix_patch.zip"
TMP="/tmp/patient_engagement_hospital_wechat_v2_fix_patch"
rm -rf "$TMP" && mkdir -p "$TMP" && unzip -q "$ZIP" -d "$TMP" && rsync -av "$TMP/" ./
```

> `rsync` 会覆盖被 patch 的文件 (engagement service / controller / module / scripts /
> migration / web 文件), 不会动其它无关代码.

## 2. 跑 6 个 idempotent patcher

(顺序无关, 每个独立处理一个文件; 重跑只打印 `[skip]`.)

```bash
python3 scripts/apply_patient_engagement_hospital_wechat_schema.py
python3 scripts/apply_patient_engagement_hospital_wechat_app_module.py
python3 scripts/apply_patient_engagement_hospital_wechat_seed.py
python3 scripts/apply_patient_engagement_hospital_wechat_patient_detail_page.py
python3 scripts/apply_patient_engagement_hospital_wechat_app_tsx.py
python3 scripts/apply_patient_engagement_hospital_wechat_package_json.py
```

期望输出: 每个脚本一行 `[ok]` 或 `[skip]`.

## 3. apply migration + seed + smoke

```bash
cd apps/api
npm install
npx prisma generate
npx prisma migrate dev --name patient_engagement_hospital_wechat_v2
node prisma/seed-all.js
node prisma/check-patient-engagement.js
npm run start:dev
```

新终端启动前端:

```bash
cd apps/web && npm install && npm run dev
```

跑 smoke (需要 API 已经在监听 :3000):

```bash
cd apps/api && npm run smoke:patient-engagement
```

## 4. 验收步骤

1. 浏览器打开 `/patients/demo-patient-001`, 看到 **微信随访** tab (Bug 1 fix).
2. 进入 tab, 点 *发问卷*, *发送=否*, 提交 → 历史列表里有一条 `本院服务号 / MANUAL_COPY · 待发送` 的消息, 含可复制链接 (Bug 3 fix).
3. 复制链接, 在隐身窗口打开 → 看到 H5, 顶部品牌是医院 displayName. 然后回到后台 — 同一个标签页里来回切换不报 "Rendered fewer hooks" (Bug 2 fix).
4. 提交问卷一次 → 200 ok. 立刻再 POST 一次同一个 token → 403 `TOKEN_USED` (Bug 4 fix).
5. 登录一个非 ADMIN 用户, 访问其它医院患者 → 403 (Bug 5 fix).
6. ADMIN 打开 `/hospital-wechat/account?hospitalTenantId=demo-tenant-001`, 看到 demo 配置 + ✓ 已启用 + ✓ 已认证.

## 5. smoke 预期通过项

(实际跑前需要 API + DB 都已起来. 输出格式: PASS/FAIL 行.)

- `login ADMIN` — PASS
- `GET demo HospitalWechatOfficialAccount` — PASS
- `demo-patient-001 contact summary — has openId` — PASS
- `create+send questionnaire (AUTO) → WECHAT` — PASS
- `GET /public-forms/:token returns hospital block` — PASS
- `submit questionnaire` — PASS
- `duplicate submit blocked` — PASS (Bug 4)
- `demo-patient-003 AUTO → SMS fallback` — PASS
- `send=false → MANUAL_COPY message exists` — PASS (Bug 3)
- `MANUAL_COPY message visible in /messages with linkUrl` — PASS

(`cross-tenant isolation` 是 SKIP — seed 只有一家医院, 测跨租户需要手动建第二个 tenant + non-admin user.)
