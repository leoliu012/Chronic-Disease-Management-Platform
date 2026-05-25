# 医疗数据接入网关 (Gateway) — 设计与使用说明

## 1. 解决什么问题？

慢病管理平台在落地到不同等级的医院时，对接方式天差地别：

| 医院类型 | 最常见对接方式 | 我们的应对 |
|---|---|---|
| 走在前面的医院 / 新建院区 | REST API（最好是 FHIR R4 标准） | `POST /gateway/fhir/...` 与 `POST /gateway/his/events/...` |
| 大多数二级 / 三级医院 | 前置机中间表（SQL Server / Oracle 视图） | `IntermediatePollerService` 定时拉取 |
| 三甲医院 / 集成平台用户 | HL7 v2 over MLLP (TCP Socket) | `Hl7ListenerService` 监听端口 (默认 2575) |

本模块的目标是**用一套统一的 NormalizedEvent + IntegrationSyncRecord 审计模型**接住这三种通道，让上层业务无需关心数据是从 HL7 字符串、FHIR JSON 还是 SQL 视图里来的。

> 当前数据全部为 **mock / 内存假数据**，但所有接口结构都按照真实生产可即插即用的标准设计。
> 接入真实医院时，只需要：① 设置环境变量开启对应通道；② 把 `MockIntermediateDbAdapter` 替换为真实的 SQL Server / Oracle 适配器。

---

## 2. 总体架构

```
                   ┌─────────────────────────────────────────────────┐
  ① FHIR R4 ─────▶│                                                 │
  ② HIS Event JSON│         InboundEventService.ingest*()           │──▶ IntegrationSyncBatch
  ③ HL7 v2 MLLP ─▶│  (统一审计 + 幂等 + 写 IntegrationSyncRecord)   │    IntegrationSyncRecord
  ④ 中间表 Cron ─▶│                                                 │    (现有 IntegrationCenter 页面立刻可见)
                   └─────────────────────────────────────────────────┘
```

所有通道解析完外部数据后，都会构造一个 `NormalizedEvent`：

```ts
interface NormalizedEvent {
  eventId: string;                  // 幂等 key
  channel: GatewayChannel;          // FHIR_REST | HIS_EVENT_REST | HL7_MLLP | INTERMEDIATE_DB
  resourceType: GatewayResourceType;// PATIENT | DIAGNOSIS | OBSERVATION | MEDICATION | ENCOUNTER | DISCHARGE | DOCUMENT
  receivedAt: Date;
  patient?: PatientIdentifier;
  normalizedPayload: Record<string, unknown>;
  rawPayload: unknown;
  triggerEvent?: string;
}
```

**为什么先入审计表，不直接写 Patient / VitalRecord 等业务表？**
真实生产中医院字段经常与我们的内部规则冲突（ICD 不在码表、药品名匹配失败等）。让审计先到位、再由人工或规则引擎决定哪些事件升档（promote）成业务数据，能避免污染主数据。`autoPromote` 留作下一阶段扩展点。

---

## 3. 环境变量

参考 `docs/gateway/.env.gateway.example`：

| 变量 | 默认 | 说明 |
|---|---|---|
| `GATEWAY_API_KEY` | （未设） | 入站 REST 接口必须的 `X-Gateway-Api-Key`。**不设则全部拒绝**（fail-closed） |
| `GATEWAY_HL7_ENABLED` | `false` | 是否启动 HL7 MLLP TCP 监听 |
| `GATEWAY_HL7_HOST` | `0.0.0.0` | HL7 监听 host |
| `GATEWAY_HL7_PORT` | `2575` | HL7 监听端口（HL7 业界默认） |
| `GATEWAY_INTERMEDIATE_POLLER_ENABLED` | `false` | 是否启动中间表轮询 |
| `GATEWAY_INTERMEDIATE_POLLER_INTERVAL_MS` | `300000` | 轮询间隔（毫秒，默认 5 分钟） |
| `GATEWAY_INTERMEDIATE_POLLER_USE_MOCK` | `true` | 当前阶段使用 mock 适配器；生产环境换成 `false` 并提供真实适配器 |

---

## 4. 三种通道的接入手册

### 4.1 RESTful / FHIR R4

**端点**：

- `POST /gateway/fhir/:resourceType` — 单一资源
- `POST /gateway/fhir/Bundle` — 事务 / 批量

**Header**：

```
Content-Type: application/json
X-Gateway-Api-Key: <你为该医院分配的 key>
```

**Body**：任意符合 FHIR R4 形状的 JSON。我们只严格识别 `resourceType` 和 `id`，其他字段由 `fhir-to-normalized.mapper.ts` 尽力解析（未识别字段保留在 `rawPayload`，不会丢）。

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
- 一条 ORU^R01 含多个 OBX 时会拆成多个 `NormalizedEvent` 分别入库。

测试方式：
```bash
GATEWAY_HL7_ENABLED=true GATEWAY_HL7_PORT=2575 npm run start:dev
node docs/gateway/samples/test-hl7-client.js
```

### 4.4 视图 / 前置机中间表

由 `IntermediatePollerService` 定时拉取，写入 NormalizedEvent。

**默认实现**：`MockIntermediateDbAdapter` —— 内存假数据，方便联调和演示。

**生产环境替换**：实现 `IntermediateDbAdapter` 接口，把 `gateway.module.ts` 里 `INTERMEDIATE_DB_ADAPTER` 的 `useClass` 换成你的真实适配器即可，**不需要改 Poller / Controller / 任何上层代码**。

接口定义见 `apps/api/src/gateway/interfaces/intermediate-db.adapter.ts`：

```ts
export interface IntermediateDbAdapter {
  fetchPatientsModifiedAfter(since: Date): Promise<IntermediatePatientRow[]>;
  fetchDiagnosesModifiedAfter(since: Date): Promise<IntermediateDiagnosisRow[]>;
  fetchLabResultsAfter(since: Date): Promise<IntermediateLabRow[]>;
  fetchPrescriptionsAfter(since: Date): Promise<IntermediatePrescriptionRow[]>;
  fetchDischargesAfter(since: Date): Promise<IntermediateDischargeRow[]>;
}
```

参考的中间表 DDL 见 `docs/gateway/samples/intermediate-tables.sql`（同时给了 SQL Server 与 Oracle 两套语法）。

---

## 5. 管理端接口（`/gateway/admin/*`）

走 JWT + RBAC，仅 `ADMIN` / `MANAGER` 角色可访问：

| 端点 | 说明 |
|---|---|
| `GET /gateway/admin/health` | 各通道健康状态 (HL7 监听 / Poller cursor / API key 是否配置) |
| `GET /gateway/admin/recent-events?limit=50` | 最近 N 条入站事件 |
| `POST /gateway/admin/intermediate/poll-now` | 手动触发一次中间表轮询 |

---

## 6. 安全模型

| 通道 | 鉴权 |
|---|---|
| FHIR REST / HIS Event REST | `X-Gateway-Api-Key` (与 `GATEWAY_API_KEY` 等长比较，fail-closed) |
| HL7 MLLP | 必须在医院内网 / VPN 中暴露；默认只监听 `0.0.0.0`，建议防火墙绑定院方集成引擎 IP |
| 中间表 Poller | 出向连接医院前置机；账号密码由 Adapter 实现持有 |
| 管理端 `/gateway/admin/*` | 全局 JwtAuthGuard + RolesGuard (`ADMIN`/`MANAGER`) |

---

## 7. 关于 `app.module.ts` 的提醒

> 本补丁会**完整覆盖** `apps/api/src/app.module.ts`，因为需要在 `imports` 数组里追加 `GatewayModule`。
> 这份覆盖基于 `src_dump.txt` 中的快照（含 PatientsModule / DiseaseProfilesModule / IntegrationsModule 等全部 28 个 module）。
> **如果你的本地版本比 dump 更新（新增了别的 module），rsync 覆盖后请手动 diff 一下，把新增的 module import 重新加回来**。修复路径：
>
> ```bash
> git diff HEAD -- apps/api/src/app.module.ts
> ```

---

## 8. 下一步可扩展点

1. **autoPromote**：从 `IntegrationSyncRecord` 自动 promote 到 `Patient` / `VitalRecord` / `MedicalRecordSummary` 等业务表（需要患者匹配 + 主数据冲突处理）。
2. **真实 SQL Server / Oracle 适配器**：见 `intermediate-tables.sql`，按对应方言写适配器。
3. **HL7 v3 / CDA**：当前只实现 v2，v3 / CDA 走 XML，可在 `parsers/` 下平行新增 `cda-to-normalized.mapper.ts`。
4. **mTLS / OAuth Client Credentials**：对接公网 FHIR Server 时，把 `GatewayApiKeyGuard` 升级为 mTLS 客户端证书校验或 OAuth2 introspection。
5. **可观察性**：将 `getRecentEvents` / `getStatus` 接入 Prometheus exporter，让运维看到每分钟事件数 / 延迟分布。
