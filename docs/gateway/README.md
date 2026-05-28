# 医疗数据接入网关 (Gateway) — 设计与使用说明

## 1. 解决什么问题？

慢病管理平台在落地到不同等级的医院时，对接方式天差地别：

| 医院类型 | 最常见对接方式 | 我们的应对 |
|---|---|---|
| 走在前面的医院 / 新建院区 | REST API（最好是 FHIR R4 标准） | `POST /gateway/fhir/...` 与 `POST /gateway/his/events/...` |
| 大多数二级 / 三级医院 | 前置机中间表（SQL Server / Oracle 视图） | `IntermediatePollerService` 定时拉取 |
| 三甲医院 / 集成平台用户 | HL7 v2 over MLLP (TCP Socket) | `Hl7ListenerService` 监听端口 (默认 2575) |

本模块的目标是**用一套统一的 NormalizedEvent + IntegrationSyncRecord 审计模型**接住这三种通道，让上层业务无需关心数据是从 HL7 字符串、FHIR JSON 还是 SQL 视图里来的。

> `gateway-production-hardening` 补丁完成后, 中间表适配器已经从 mock-only
> 进化到可直接对接 SQL Server / Oracle 真实前置机, 网关也具备了等保所需的
> 多租户 API key + IP 白名单 + 失败重试 + 审计报表 等能力.

---

## 2. 总体架构

```
                   ┌─────────────────────────────────────────────────┐
  ① FHIR R4 ─────▶│                                                 │
  ② HIS Event JSON│         InboundEventService.ingest*()           │──▶ IntegrationSyncBatch
  ③ HL7 v2 MLLP ─▶│  (统一审计 + 幂等 + 写 IntegrationSyncRecord)   │    IntegrationSyncRecord
  ④ 中间表 Cron ─▶│                                                 │    (IntegrationCenter 页面立刻可见)
                   └──────────────────────┬──────────────────────────┘
                                          │
                            autoPromote?  │
                                          ▼
                   ┌─────────────────────────────────────────────────┐
                   │     IntegrationPromoteService.dispatch()        │
                   │   字段映射 (IntegrationFieldMapping)  ───┐      │
                   │   写入 Patient / DiseaseProfile / VitalRecord    │
                   │        / MedicationRecord / EncounterRecord     │
                   │        / MedicalRecordSummary / ExamReportRecord │
                   │   出院 -> DischargeFollowupPlanGenerator         │
                   └──────────────────────┬──────────────────────────┘
                                          │
                                  失败时   │
                                          ▼
                   ┌─────────────────────────────────────────────────┐
                   │     GatewayPromotionWorker (退避 60s -> 1h)      │
                   │   超过 maxAttempts -> GatewayAlertService 告警   │
                   └─────────────────────────────────────────────────┘
```

所有通道解析完外部数据后，都会构造一个 `NormalizedEvent`：

```ts
interface NormalizedEvent {
  eventId: string;                  // 幂等 key
  channel: GatewayChannel;          // FHIR_REST | HIS_EVENT_REST | HL7_MLLP | INTERMEDIATE_DB
  resourceType: GatewayResourceType;// PATIENT | DIAGNOSIS | OBSERVATION | MEDICATION | ENCOUNTER | DISCHARGE | DOCUMENT | EXAM_REPORT
  receivedAt: Date;
  patient?: PatientIdentifier;
  normalizedPayload: Record<string, unknown>;
  rawPayload: unknown;
  triggerEvent?: string;
}
```

---

## 3. 环境变量

参考 `docs/gateway/.env.gateway.example`：

### 3.1 通道开关 (沿用)

| 变量 | 默认 | 说明 |
|---|---|---|
| `GATEWAY_API_KEY` | （未设） | dev 环境的 legacy 全局 key. 生产环境会被拒绝, 必须用 per-source key |
| `GATEWAY_HL7_ENABLED` | `false` | 是否启动 HL7 MLLP TCP 监听 |
| `GATEWAY_HL7_HOST` | `0.0.0.0` | HL7 监听 host |
| `GATEWAY_HL7_PORT` | `2575` | HL7 监听端口（HL7 业界默认） |
| `GATEWAY_INTERMEDIATE_POLLER_ENABLED` | `false` | 是否启动中间表轮询 |
| `GATEWAY_INTERMEDIATE_POLLER_INTERVAL_MS` | `300000` | 轮询间隔（毫秒，默认 5 分钟） |

### 3.2 gateway-production-hardening 新增

| 变量 | 默认 | 说明 |
|---|---|---|
| `GATEWAY_GLOBAL_IP_ALLOWLIST` | （未设） | 全局 CIDR 白名单, 逗号分隔; 留空 = 不限制 |
| `GATEWAY_INTERMEDIATE_ADAPTER` | `mock` | `mock` / `sqlserver` / `oracle` 三选一 |
| `GATEWAY_INTERMEDIATE_MSSQL_*` | — | SQL Server 连接 + 表名 (见下文) |
| `GATEWAY_INTERMEDIATE_ORACLE_*` | — | Oracle 连接 + 表名 |
| `GATEWAY_PROMOTION_WORKER_ENABLED` | `false` | 失败 record 自动重试. **强烈建议生产开启** |
| `GATEWAY_PROMOTION_WORKER_INTERVAL_MS` | `60000` | 重试 worker tick 间隔 |
| `GATEWAY_PROMOTION_WORKER_MAX_ATTEMPTS` | `6` | 单条 record 最多尝试次数, 达到后告警 |
| `GATEWAY_PROMOTION_WORKER_BATCH` | `50` | 单次 tick 最多扫多少条 |
| `GATEWAY_ALERT_WEBHOOK_URL` | （未设） | 告警 webhook URL (RETRY_EXHAUSTED 等触发) |

---

## 4. 三种通道的接入手册

### 4.1 RESTful / FHIR R4

**端点**：

- `POST /gateway/fhir/:resourceType` — 单一资源
- `POST /gateway/fhir/Bundle` — 事务 / 批量

**Header**：

```
Content-Type: application/json
X-Gateway-Api-Key: gwk_<prefix>_<secret>     # 由 /gateway/admin/api-keys 签发
```

**Body**：任意符合 FHIR R4 形状的 JSON。我们严格识别 `resourceType` 和 `id`，其他字段由 `fhir-to-normalized.mapper.ts` 尽力解析。

**支持的 FHIR Resource** (在 InboundEventService 已注册):
- `Patient` → PATIENT
- `Condition` → DIAGNOSIS
- `Observation` → OBSERVATION
- `MedicationRequest` / `MedicationStatement` → MEDICATION
- `Encounter` → ENCOUNTER / DISCHARGE
- `Composition` / `DocumentReference` → DOCUMENT
- **`DiagnosticReport`** → EXAM_REPORT — 影像/心电/病理/内镜/肺功能等非数值检查报告 (gateway-production-hardening)

样例：见 `docs/gateway/samples/curl-fhir-patient.sh`、`curl-fhir-bundle.sh`。

### 4.2 简化 HIS 业务事件 REST

为对接不动 FHIR 的医院 IT 准备的"扁平化 JSON"接口，字段命名贴近 WS/T 500 系列习惯：

| 端点 | 用途 |
|---|---|
| `POST /gateway/his/events/discharge` | 出院 |
| `POST /gateway/his/events/prescription` | 开处方 |
| `POST /gateway/his/events/lab-result` | 检验结果 |
| `POST /gateway/his/events/vital` | 体征记录 |
| `POST /gateway/his/events/patient-updated` | 患者基本信息变更 |
| `POST /gateway/his/events/encounter` | 就诊事件 |

每个事件都必须带 `eventId` 用于幂等；同一 `eventId` 重复送达会返回 `status: "DUPLICATED"`。

样例：`docs/gateway/samples/curl-his-discharge.sh`。

### 4.3 HL7 v2 over MLLP (TCP)

- 默认监听 `0.0.0.0:2575`，使用 MLLP 协议（`<VT>...<FS><CR>` 帧）。
- 解析器零依赖（基于 Node `net` 模块），覆盖 ADT^A01/A03/A04/A08/A11/A28/A31、ORM^O01、ORU^R01、MDM^T02 等常用触发事件。
- 收到任意消息后都会回 ACK：解析成功 `AA`，已知格式但暂不支持 `AE`，无法解析 `AR`。

测试方式：
```bash
GATEWAY_HL7_ENABLED=true GATEWAY_HL7_PORT=2575 npm run start:dev
node docs/gateway/samples/test-hl7-client.js
```

### 4.4 视图 / 前置机中间表 (gateway-production-hardening)

由 `IntermediatePollerService` 定时拉取，写入 NormalizedEvent。
**适配器现在由 `GATEWAY_INTERMEDIATE_ADAPTER` 环境变量切换, 无需改代码**:

| 取值 | 实现 | 需要的 npm 包 |
|---|---|---|
| `mock` (默认) | `MockIntermediateDbAdapter` | — |
| `sqlserver` | `SqlServerIntermediateDbAdapter` | `mssql` (`optionalDependencies`) |
| `oracle` | `OracleIntermediateDbAdapter` | `oracledb` (`optionalDependencies`) |

**SQL Server 部署示例**:
```bash
cd apps/api
npm install mssql                                  # 装可选依赖
cat >> .env <<'EOF'
GATEWAY_INTERMEDIATE_POLLER_ENABLED=true
GATEWAY_INTERMEDIATE_ADAPTER=sqlserver
GATEWAY_INTERMEDIATE_MSSQL_HOST=10.1.0.50
GATEWAY_INTERMEDIATE_MSSQL_PORT=1433
GATEWAY_INTERMEDIATE_MSSQL_USER=chronic_readonly
GATEWAY_INTERMEDIATE_MSSQL_PASSWORD=...
GATEWAY_INTERMEDIATE_MSSQL_DATABASE=HIS_BRIDGE
EOF
npm run start:dev
```

适配器期望前置机端有 5 个视图 (列名以 snake_case, 详见 `docs/gateway/samples/intermediate-tables.sql`):
- `v_chronic_patient` — 患者基本信息
- `v_chronic_diagnosis` — 诊断
- `v_chronic_lab_result` — 检验结果
- `v_chronic_prescription` — 处方
- `v_chronic_discharge` — 出院小结

视图名可通过 `GATEWAY_INTERMEDIATE_*_TABLE` 覆写, 兼容已有命名习惯.

Oracle 部署与 SQL Server 同构, 把 `mssql` 换成 `oracledb`, `MSSQL` 换成 `ORACLE`, 视图名默认是大写 (`V_CHRONIC_*`).

---

## 5. 管理端接口（`/gateway/admin/*`）

走 JWT + RBAC，仅 `ADMIN` / `MANAGER` 角色可访问。

### 5.1 既有接口

| 端点 | 说明 |
|---|---|
| `GET /gateway/admin/health` | 各通道健康状态 + 已签发 API key 计数 + retry worker 状态 + 全局 IP 白名单配置 |
| `GET /gateway/admin/recent-events?limit=50` | 最近 N 条入站事件 |
| `POST /gateway/admin/intermediate/poll-now` | 手动触发一次中间表轮询 |

### 5.2 gateway-production-hardening 新增

#### API Key 管理

| 端点 | 说明 |
|---|---|
| `POST   /gateway/admin/api-keys` | 为指定 IntegrationSource 签发一把 key. **`fullKey` 仅返回一次** |
| `GET    /gateway/admin/api-keys?sourceId=&includeRevoked=true` | 列出 key |
| `DELETE /gateway/admin/api-keys/:id` | 吊销 key (立刻生效, 不可逆) |

`POST` 请求体:
```json
{
  "sourceId": "<IntegrationSource.id>",
  "description": "上海三院 - 集成平台主账号",
  "ipAllowlist": ["10.1.0.0/16", "10.2.5.7/32"]
}
```

响应:
```json
{
  "id": "...",
  "sourceId": "...",
  "prefix": "a1b2c3d4e5f6",
  "fullKey": "gwk_a1b2c3d4e5f6_<32字符随机>",
  "description": "上海三院 - 集成平台主账号",
  "ipAllowlist": ["10.1.0.0/16", "10.2.5.7/32"],
  "createdAt": "2026-05-26T...",
  "hint": "Save fullKey now — it is shown only once. Use header X-Gateway-Api-Key."
}
```

#### 审计报表 (等保 / 三级等保 评审)

| 端点 | 说明 |
|---|---|
| `GET /gateway/admin/audit-report?from=&to=&sourceId=` | JSON 报表 |
| `GET /gateway/admin/audit-report.csv?...` | 同样内容的 CSV, 浏览器直接下载 |

时间窗默认最近 7 天. 报表内容包含:
1. **按 source 的 promote 状态分布** (PENDING / PROMOTED / CONFLICT / FAILED / NOT_REQUIRED)
2. **Top 失败原因聚类** — 抽 `[REASON]` 标签做 bucket
3. **API key 使用情况** — usageCount / lastUsedAt / lastUsedIp / 是否在窗内活跃
4. **重试耗尽的 record 列表** — 用来当作运维清单

#### Promotion retry worker

| 端点 | 说明 |
|---|---|
| `GET  /gateway/admin/promotion-worker` | 当前状态 / 上次 tick 摘要 |
| `POST /gateway/admin/promotion-worker/run-now` | 不等下一轮 tick, 立刻扫一次 |

---

## 6. 安全模型 (gateway-production-hardening 升级)

| 通道 | 鉴权 |
|---|---|
| FHIR REST / HIS Event REST | (1) `GATEWAY_GLOBAL_IP_ALLOWLIST` (若配置) → (2) `X-Gateway-Api-Key: gwk_<prefix>_<secret>` (per-source) → (3) 该 key 自己的 `ipAllowlist` (若配置). 生产环境的 dev 端 legacy `GATEWAY_API_KEY` 已被强制禁用 |
| HL7 MLLP | 必须在医院内网 / VPN 中暴露; 默认监听 `0.0.0.0`, 建议防火墙绑定院方集成引擎 IP |
| 中间表 Poller | 出向连接医院前置机; 账号密码由 `.env` 持有, 推荐建一个只读 DB 账号 |
| 管理端 `/gateway/admin/*` | 全局 JwtAuthGuard + RolesGuard (`ADMIN`/`MANAGER`); 所有"会变更"的操作都会写 `AuditLog` |

**API key 存储**: 仅持久化 `sha256(secret)`, 完整 key 仅在签发时返回一次, 类似 GitHub PAT 体验. 校验走 `crypto.timingSafeEqual`.

**轮换 / 吊销**: 一律通过 `/gateway/admin/api-keys` 走, 不要去 DB 改; 这样能保证 AuditLog 完整.

---

## 7. 出院后随访任务自动生成 (gateway-production-hardening)

当 `IntegrationPromoteService.promoteEncounter` 检测到本次 promote 是 **出院**
(`resourceType in [ENCOUNTER, DISCHARGE]` 且 `payload.dischargeDate` 已填),
会写完 `MedicalRecordSummary` 后调用 `DischargeFollowupPlanGeneratorService`,
**幂等**生成一组出院后随访 Task:

| 时间锚点 | Task 类型前缀 | 渠道 | 说明 |
|---|---|---|---|
| 出院 D+2 | `DISCHARGE_FU_PHONE_D2_*` | 电话 | 用药 + 症状核查 |
| 出院 D+3 ⚠️ | `DISCHARGE_FU_VITAL_D3_*` | 体征 | **仅 HYPERTENSION / CHD / T2DM 高风险病种**生成 |
| 出院 D+7 | `DISCHARGE_FU_MEDICATION_D7_*` | 问卷 | 用药依从问卷 |
| 出院 D+14 | `DISCHARGE_FU_VISIT_D14_*` | 当面 | 复诊提醒 |
| 出院 D+30 | `DISCHARGE_FU_VITAL_D30_*` | 体征 | 综合复盘 |

幂等机制: `Task.type` 后缀挂上 `__<encounterId>`, 同一次出院重跑 promote 不会重复生成.

如需调整时间锚点或追加病种特化, 编辑 `apps/api/src/follow-ups/discharge-followup-plan.constants.ts` 即可.

---

## 8. IntegrationFieldMapping 动态生效 (gateway-production-hardening)

`IntegrationFieldMapping` 表 (在 IntegrationCenter 页面维护) 现在会在 `IntegrationPromoteService.dispatch` 入口被 `FieldMappingResolverService` 真正应用:

- `externalField` → `localField` 改名
- `transformRule` 走以下白名单 (无 `eval`, 无 JS 执行):
  - `UPPER` / `LOWER` / `TRIM`
  - `DATE:iso` / `DATE:yyyy-MM-dd` — 时间格式标准化
  - `JSON_PATH:$.foo.bar` — 从嵌套对象提取 (仅 dot-path)
  - `MAP:k1=v1;k2=v2;k3=v3` — 简单 lookup 表
- `defaultValue` — 上游未传时填默认值
- 未知 transformRule 静默跳过, 不阻塞 promote

缓存 TTL 60s, 改完字段映射 1 分钟内自动生效.

---

## 9. 失败重试与告警

`GatewayPromotionWorker` 启动后会按以下规则扫描:

```sql
WHERE promotionStatus = 'FAILED'
  AND nextRetryAt <= NOW()
  AND nextRetryAt IS NOT NULL
  AND promotionAttempts < GATEWAY_PROMOTION_WORKER_MAX_ATTEMPTS
ORDER BY nextRetryAt ASC
LIMIT GATEWAY_PROMOTION_WORKER_BATCH
```

退避序列: 60s, 120s, 240s, 480s, 960s, 1800s, 然后 cap 在 60min.
默认 6 次后 (≈ 60 分钟总曝光) 宣告耗尽: 清空 `nextRetryAt`, 通过
`GatewayAlertService.emit('RETRY_EXHAUSTED', ...)` 走告警 webhook.

告警 webhook payload (通用 JSON, 你的转发服务自己适配钉钉/企微/Slack):

```json
{
  "kind": "RETRY_EXHAUSTED",
  "severity": "error",
  "title": "Gateway promote 重试耗尽: DISCHARGE",
  "summary": "record=... source=... attempts=6/6 lastError=...",
  "context": { "recordId": "...", "sourceCode": "...", ... },
  "occurredAt": "2026-05-26T..."
}
```

同一 dedupKey (recordId) 在 5 分钟内不会重复推送, 防告警轰炸.

---

## 10. 关于 `app.module.ts` 的提醒

> 本补丁会**完整覆盖** `apps/api/src/app.module.ts` 不需要改 — `FollowUpsModule`
> 在它已有的 import 里; `GatewayModule` 已经把新 service 注册好.

> 如果你的本地版本比 dump 更新（新增了别的 module）, rsync 覆盖会用 dump 版本
> 替换本地 `gateway.module.ts` / `follow-ups.module.ts` / `gateway-admin.controller.ts`
> 等. **rsync 前请先 `git diff HEAD`, 把本地新增的 import / provider 重新合并回来**.

---

## 11. 下一步可扩展点

1. **mTLS / OAuth Client Credentials**: 对接公网 FHIR Server 时, 把 `GatewayApiKeyGuard` 升级为 mTLS 客户端证书校验或 OAuth2 introspection.
2. **HL7 v3 / CDA**: 当前只实现 v2, v3 / CDA 走 XML, 可在 `parsers/` 下平行新增 `cda-to-normalized.mapper.ts`.
3. **Prometheus exporter**: 把 `GET /gateway/admin/health` 的 status payload 换成 `/metrics` 端点, 让运维看到每分钟事件数 / promote 延迟分布.
4. **多 webhook 通道**: 目前一个 `GATEWAY_ALERT_WEBHOOK_URL` 走天下, 可以扩成按 severity / kind 分路.
5. **更细颗粒度的 IntegrationFieldMapping**: 当前 transformRule 是 4 种白名单变换, 可按业务需要新增 (e.g. ICD9→ICD10 映射表).
