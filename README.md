# patient_engagement_hospital_wechat_v2_fix_patch

升级 `patient_engagement_wechat_h5_v1` →
**per-hospital 服务号 + 5 个 v1 bug 修复**.

## 5 个 v1 bug

| # | bug | 修复位置 |
| - | --- | --- |
| 1 | "微信随访" tab 按钮在患者档案页不显示 | `apps/web/src/pages/PatientDetailPage.tsx` (patcher 脚本) |
| 2 | 公开 H5 路径下 `AppContent` hooks 顺序异常 → React 报 "Rendered fewer hooks than expected" | `apps/web/src/App.tsx` (patcher 脚本 — hooks-first 重写) |
| 3 | 创建链接时 `send=false` 不留任何痕迹 — 弹窗关掉链接就丢了 | `apps/api/src/patient-engagement/patient-engagement.service.ts` (创建一条 MANUAL_COPY/PENDING 消息) |
| 4 | 双击 / retry 同一个 token 会写多条 QuestionnaireResult / VitalRecord | `form-link.service.ts` (`claimForSubmission` 原子) + `public-form.controller.ts` (在 `$transaction` 内调用) |
| 5 | 医生/护士可越权读其它医院的患者档案 | `patient-engagement-tenant.service.ts` (`assertPatientVisibleToUser`) + 在每个 admin endpoint 调用 |

## per-hospital 服务号 (v2 核心)

- 新表 `HospitalWechatOfficialAccount` (一行/医院)
- `PatientWechatIdentity.hospitalTenantId` 必填, unique = `(hospitalTenantId, appId, openId)`
- 安全迁移: 先 nullable, backfill, fallback demo-tenant-001, 再 `SET NOT NULL`
- AES-256-GCM 加密 appSecret / accessToken, key 派生自 `PATIENT_ENGAGEMENT_SECRET_KEY`
- 生产没设 key → fail closed; dev fallback + warn
- 所有 send / OAuth 接口接受 `hospitalTenantId`, 不再从 `process.env` 读 wechat 配置
- OAuth state 签名: `(tokenHash, hospitalTenantId, nonce, exp)`. 无 tenant 直接 fail closed.

## 文件

- `apps/api/prisma/migrations/20260528120000_patient_engagement_hospital_wechat_v2/migration.sql` — DDL + 安全 backfill
- `apps/api/src/patient-engagement/*.ts` — 9 个文件 (full file replacement)
- `apps/api/prisma/check-patient-engagement.js`, `apps/api/scripts/smoke-patient-engagement.js`
- `apps/web/src/api/{patient-engagement.ts, hospital-wechat.ts}`
- `apps/web/src/components/PatientEngagementTab.tsx`
- `apps/web/src/pages/{PublicFormPage.tsx, HospitalWechatAccountPage.tsx}`
- `scripts/apply_patient_engagement_hospital_wechat_*.py` — 6 个 idempotent patchers
- `docs/patient-engagement/{README.md, LOCAL_DEV.md}`

## 应用

见 `APPLY.md`. 一行一行复制就行.
