# patient-engagement — 本地开发指南 (v2)

## 1. env 一遍过

`apps/api/.env`:

```
DATABASE_URL=postgresql://...
PATIENT_FORM_TOKEN_SECRET=dev_change_me
PATIENT_ENGAGEMENT_SECRET_KEY=dev_patient_engagement_secret_change_me   # ← 新增
PATIENT_ENGAGEMENT_BASE_URL=http://localhost:5173

# v1 全局环境变量已弃用 — 运行时不再读
# WECHAT_OFFICIAL_ACCOUNT_*  仅保留为兼容空值
WECHAT_OFFICIAL_ACCOUNT_MOCK=true
SMS_MOCK=true
```

## 2. seed 出的演示数据

`apps/api/prisma/seed-all.js` 会创建:

- `HospitalTenant{ id: 'demo-tenant-001', code: 'demo-hospital' }`
- `HospitalWechatOfficialAccount{ hospitalTenantId: 'demo-tenant-001', appId: 'wx_demo_hospital_001', isEnabled: true, isVerified: true, 四个模板 ID }`
- 患者 `demo-patient-001` / `002` 已有本院 openId (`PatientWechatIdentity.hospitalTenantId = 'demo-tenant-001'`)
- 患者 `demo-patient-003` *没有* openId → 触达走 SMS 兜底
- 若干 `PatientFormLink` + `PatientOutboundMessage` 覆盖 SENT / CLICKED / SUBMITTED / FAILED / EXPIRED / REVOKED

> **注意**: seed 里写入的 `appSecretEncrypted` 是占位密文 (`v1.AAAA.AAAA.AAAA`).
> `decryptSecret` 会安全失败并返回 null. 走 mock 通道发送不依赖明文 secret,
> 只有切到生产模式真实调微信时才需要; 那时请在
> `/hospital-wechat/account` 页面重新输入一次 appSecret.

## 3. 启动

```bash
cd apps/api && npm install
npx prisma generate
npx prisma migrate dev   # 或: npx prisma migrate dev --name patient_engagement_hospital_wechat_v2
node prisma/seed-all.js
node prisma/check-patient-engagement.js   # 诊断打印
npm run start:dev

# 新终端
cd apps/web && npm install && npm run dev

# 全量 smoke
cd apps/api && npm run smoke:patient-engagement
```

## 4. 配置一家新医院 (dev 演示)

1. 在 PostgreSQL 里加一行 `HospitalTenant`:

   ```sql
   INSERT INTO "HospitalTenant" (id, name, code, displayName, isActive)
   VALUES ('hosp-foo', '示例三甲医院 · 慢病随访', 'demo-foo', '示例三甲医院 · 慢病随访', true);
   ```

2. 在 `/hospital-wechat/account?hospitalTenantId=hosp-foo` 页面填:
   - appId = `wx_foo_001` (随便填, mock 不校验)
   - appSecret = `random_dev_secret` (会被加密)
   - 4 个 template ID 随意 (mock 不会真用)
   - 勾上 已启用 / 已认证

3. 在数据库给一两个患者绑到 `hosp-foo`, 再给其中一个加 PatientWechatIdentity 行验证 hospitalTenantId 隔离.

4. smoke 不覆盖多医院 — 自己手动测两次跨 tenant 调用应该 403.

## 5. mock vs 真实

`WECHAT_OFFICIAL_ACCOUNT_MOCK=true` 时:

- 不真实调微信
- 不需要外网, 不需要医院真服务号
- send 直接成功, OAuth 直接返回伪 openId
- 所有 PatientOutboundMessage 仍按真实状态机记录

切到生产模式 (mock=false) 时:

- access_token / OAuth 交换 / send_template 的真实实现是 v2 的后续工作 (在
  `WechatOfficialAccountService` 中标了 `Real ... not yet implemented`)
- 临时:可以保留 mock=true 上线, 真实接入后再切

## 6. 常见调试

- "请求 405 / 路径 404" — 确认 `app.module.ts` 已经引 `PatientEngagementModule`.
- "PATIENT_ENGAGEMENT_SECRET_KEY is required" — 你处于 NODE_ENV=production
  但没设这个 env. 设上即可.
- "decryptSecret: bad envelope" — 该医院的 appSecret 是 placeholder 占位密文,
  在 UI 里重新填一次即可.
- "TOKEN_USED" — Bug 4 的正确表现: 同一个 token 只能成功提交一次. 重复请求被
  抢占阻止.
