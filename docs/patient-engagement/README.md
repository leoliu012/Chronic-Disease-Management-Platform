# patient-engagement — 每家医院独立服务号 (v2)

## 设计前提

> **每家医院使用各自的微信服务号** (公众号).
> 平台不持有"全平台一个服务号"; 不接企业微信; 不接小程序生态.

这是 `patient_engagement_hospital_wechat_v2` 的核心立场. v1 的"平台服务号 + 全局
`WECHAT_OFFICIAL_ACCOUNT_*` env" 模型已弃用; 运行时不再读取该 env.

## 各方职责

| 角色 | 责任 |
| --- | --- |
| 医院 | 自己申请、备案、认证微信服务号 (公众号), 提供 appId、appSecret、模板消息 ID, 提供 OAuth 回调域名. 在医院内部完成认证流程. |
| 患者 | 微信里关注本院的服务号 → 通过 OAuth 网页授权一次, 把 openId 绑定到自己的患者档案. |
| 平台 | 提供 H5 链接 + 后台界面. 把每家医院的服务号配置安全加密落库. 调用本院 appId 完成 send_template + OAuth. 提供 SMS 兜底, 不提供企业微信 / 私域 / 第三方运营组件. |

## 数据隔离

- `HospitalTenant` 是租户主体.
- 每家医院仅一行 `HospitalWechatOfficialAccount`, `appSecretEncrypted` 用 AES-256-GCM 加密 (key 派生自 `PATIENT_ENGAGEMENT_SECRET_KEY`).
- `PatientWechatIdentity` 必带 `hospitalTenantId`. 同一个微信用户在不同医院的服务号下有不同 openId, 因此 unique 是 `(hospitalTenantId, appId, openId)`.
- 后端任何一次"按 patient 操作"都会在入口处校验 `user.hospitalTenantId === patient.hospitalTenantId`; ADMIN 可跨; MANAGER 仅读.

## 关键 API

| 端点 | 用途 |
| --- | --- |
| `GET  /hospital-wechat/account` | 当前医院的服务号配置 (脱敏). ADMIN 可加 `?hospitalTenantId=` 切换. |
| `POST /hospital-wechat/account` | 配置/更新服务号. `appSecret` 仅在重写时提交; 留空保留旧值. 非 ADMIN 不能改 `isVerified`. |
| `POST /hospital-wechat/account/test-access-token` | 触发本院 access_token 拉取 (dev=mock). |
| `POST /hospital-wechat/account/test-send` | 给患者发一条测试模板消息 (必须该患者在本院已有 openId). |
| `POST /patient-engagement/patients/:id/questionnaire-links` 等 | 入口处 `tenant.assertPatientVisibleToUser` 校验. AUTO 模式按"本院能否发微信" + "患者是否在本院关注过" 选 WECHAT_OFFICIAL_ACCOUNT, 否则 SMS, 否则 MANUAL_COPY. |
| `POST /patient-engagement/messages/:id/resend` | 重发. 拒绝跨医院. |
| `GET  /public-forms/:token` | 公开 H5, 不需要登录. 返回包含 `hospital.{id,name,displayName,serviceAccountName}`. |
| `POST /public-forms/:token/...` | 提交问卷/复测/打卡/到院. **每条 POST 都先在 `$transaction` 内做原子 claim — 重复双击只会成功一次.** |
| `GET  /patient-engagement/wechat/oauth/start?token=...` | 跳本院 `open.weixin.qq.com/connect/oauth2/...`. state 签名包含 `(tokenHash, hospitalTenantId, nonce, exp)`. 无 hospitalTenantId 直接 4xx fail closed. |
| `GET  /patient-engagement/wechat/oauth/callback` | 验证 state 签名 + tenant 匹配, 然后 upsert `PatientWechatIdentity(hospitalTenantId, appId, openId)`. |

## 部署 / 生产 checklist

10 项, 缺一不可:

1. 配置 `PATIENT_ENGAGEMENT_SECRET_KEY` (32+ 随机字节). **生产不设, 服务启动失败.**
2. 关闭 `WECHAT_OFFICIAL_ACCOUNT_MOCK` / `SMS_MOCK` (=false), 或干脆删掉这两个 env.
3. 每家上线的医院在 `HospitalWechatOfficialAccount` 里有一行 + `isEnabled=true` + `isVerified=true`.
4. 每家医院的 `appSecret` 已通过 UI (POST /hospital-wechat/account) 写入 (加密落库).
5. 每家医院已配齐 4 个 `template*Id` (问卷/复测/用药/到院).
6. 每家医院的 OAuth 回调域 (`oauthCallbackDomain`) 已在微信公众平台后台备过案.
7. 后端 `/patient-engagement/wechat/oauth/start` 和 `/.../callback` 的对外域名 = 上面的回调域.
8. PostgreSQL backup / restore 验证过包含 `HospitalWechatOfficialAccount` + `PatientWechatIdentity` 两张表 (含加密字段).
9. 全平台 audit log 已经覆盖 `HOSPITAL_WECHAT_ACCOUNT_UPSERTED` / `HOSPITAL_WECHAT_TEST_SEND` 两类动作.
10. v1 的 `WECHAT_OFFICIAL_ACCOUNT_APP_ID / _APP_SECRET / _TEMPLATE_*` 已从 `.env.prod` 移除 (避免运维误以为还在用).

## 不会做的事 (反需求)

- ❌ 不接企业微信. 患者用的是个人微信.
- ❌ 不做"私域运营 / 群发". 平台只在患者主动同意的随访任务上下文里触达.
- ❌ 不会"自动免登录改密码 / 拉黑 / 加好友". 一切动作都需要医院后台 (NestJS Web) 显式发起.
