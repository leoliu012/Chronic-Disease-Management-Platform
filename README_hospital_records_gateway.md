# hospital-records-seed-patch (gateway-driven)

把 demo 的 4 张院内病历数据从「直接 createMany 写主表」改成「走网关流水线」,
让 demo 行为和真实医院 HIS / LIS / EMR 通过 `POST /gateway/his/events/*`
接入的端到端链路一致。

## 为什么改

之前 `seed-all.js` 用 `prisma.encounterRecord.createMany(...)` 等
4 句话把数据直接灌进业务表, 绕过了:

- `IntegrationSyncBatch` (审计批次)
- `IntegrationSyncRecord` (审计行 + `promotionStatus` 推进态)
- `IntegrationPromoteService` (审计 → 主数据的 promote 流水线)

结果是: 演示时打开【接口中心】, 看不到任何网关流水; 患者详情页里
的院内病历也没有 `sourceSystem = GATEWAY_HIS_EVENT_REST` 标记;
demo 行为和真实接入的两端是脱节的。

这个补丁把每一条 demo 院内病历都改成"模拟医院端推到网关 → 审计 →
promote 到主表"的完整流程, 落库后:

- 业务表 4 张全部由 promote 流程生成, `sourceSystem` 写的是
  `GATEWAY_HIS_EVENT_REST` (跟生产 REST 通道一致)
- `IntegrationSyncRecord` 每一行都填了 `localTargetType`/`localTargetId`,
  从【接口中心】点详情可以反查到业务主表的对应行
- 重跑 seed 时清理顺序: 先删 `IntegrationSyncRecord` (按 `externalRecordId`),
  再按 patientId 清业务表, 不会留悬挂引用

## 一并补全的网关能力 (生产代码, 不只是 demo)

之前网关只支持 `ENCOUNTER / DISCHARGE / MEDICATION / DOCUMENT` 四个资源
类型经由 HTTP 接入, 而 `ExamReportRecord` 完全没有网关入口。补丁补齐:

| 文件 | 改动 |
|---|---|
| `gateway/gateway.constants.ts` | 新增 `GATEWAY_RESOURCE.EXAM_REPORT`; FHIR `DiagnosticReport` 映射到它 |
| `gateway/dto/his-event.dto.ts` | 新增 `HisDocumentEventDto`, `HisExamReportEventDto` |
| `gateway/controllers/his-events.controller.ts` | 新增 `POST /gateway/his/events/document` 和 `POST /gateway/his/events/exam-report` |
| `gateway/services/integration-promote.service.ts` | 新增 `promoteExamReport()` + dispatch 路由 `EXAM_REPORT` |

这意味着上线后, 医院 HIS / PACS 可以推影像 / 心电 / 病理报告进我们的系统
而无需新建管道。

## 应用补丁

```bash
ZIP="$HOME/Downloads/hospital_records_seed_patch.zip"
TMP="/tmp/hospital_records_seed_patch"
rm -rf "$TMP"
mkdir -p "$TMP"
unzip -q "$ZIP" -d "$TMP"
rsync -av "$TMP/" ./
```

文件清单 (全部都是替换, 没有删除):

```
apps/api/prisma/seed-all.js                                  # 重写: 走网关
apps/api/prisma/check-hospital-records.js                    # 升级: 多报审计状态
apps/api/src/gateway/gateway.constants.ts                    # +EXAM_REPORT
apps/api/src/gateway/dto/his-event.dto.ts                    # +2 DTOs
apps/api/src/gateway/controllers/his-events.controller.ts    # +2 endpoints
apps/api/src/gateway/services/integration-promote.service.ts # +promoteExamReport
```

## 启动顺序 (必读)

```bash
cd apps/api

# 1. 重新生成 Prisma client (schema 没动, 这一步只是保险)
npx prisma generate

# 2. 重启后端开发服务器, 让新的 gateway TS 代码加载
#    (如果你之前有 nest start --watch 在跑, 它会自动 reload)
#    NestJS 启动日志里现在应该多出两条:
#      [RouterExplorer] Mapped {/gateway/his/events/document, POST}
#      [RouterExplorer] Mapped {/gateway/his/events/exam-report, POST}

# 3. 重跑 seed
node prisma/seed-all.js
```

seed 结尾的关键输出:

```
  ✓ Gateway-driven hospital records: 42 events ingested, 42 promoted to business tables
  ✓ Verify demo-patient-001 (王建国): enc=3 medrec=2 exam=2 rx=3  |  audit-rows PROMOTED=42
```

`42` 是 11 (encounter) + 7 (medrec) + 10 (exam) + 14 (medication) 的合计, 也是
新增的 `IntegrationSyncBatch` / `IntegrationSyncRecord` 行数。

## 三步验证

### 1) DB 状态 — `check-hospital-records.js`

```bash
cd apps/api && node prisma/check-hospital-records.js
```

健康 DB 应该看到:

```
EncounterRecord (就诊记录):          11
MedicalRecordSummary (病历摘要):     7
ExamReportRecord (检查报告):         10
HospitalMedicationOrder (院内处方):  14
IntegrationSyncBatch (审计批次):     42  (+ 旧的其他)
IntegrationSyncRecord (审计行):      42  (+ 旧的其他)

Gateway source:  数据接入网关 - 简化 HIS 事件 REST  (autoPromote=false)
  externalRecordType    promotionStatus  count
  ────────────────────────────────────────────
  ENCOUNTER             PROMOTED        11
  DOCUMENT              PROMOTED        7
  EXAM_REPORT           PROMOTED        10
  MEDICATION            PROMOTED        14

Audit → business-row linkage spot-check:
  ✓ ENCOUNTER   : audit xxxxxxxx... → EncounterRecord/demo-encounter-...  OK
  ✓ DOCUMENT    : audit xxxxxxxx... → MedicalRecordSummary/demo-medrec-...  OK
  ✓ EXAM_REPORT : audit xxxxxxxx... → ExamReportRecord/demo-exam-...  OK
  ✓ MEDICATION  : audit xxxxxxxx... → HospitalMedicationOrder/demo-rx-...  OK

FK integrity (HMO → Encounter):       ✓ 14 all linked
```

### 2) 患者详情页

刷新 `/patients/demo-patient-001` (王建国), 应该看到:

- 就诊记录(3) / 病历摘要(2) / 检查报告(2) / 院内处方(3)
- 最近就诊卡片显示急诊那条 188/112 mmHg
- 每条记录的 `sourceSystem` 现在是 `GATEWAY_HIS_EVENT_REST` (生产值)

### 3) 接口中心 — 网关流水

进入接口中心, 选 `数据接入网关 - 简化 HIS 事件 REST`, 应该看到:

- 42 条 batch (按时间顺序, 每个 batch 内只有 1 条 record, 这是 REST
  单次推送的真实形态)
- 每条 record 的 `promotionStatus = PROMOTED`, 点详情可以看到
  `localTargetType` + `localTargetId` 指向业务主表
- 切到「按资源类型」筛: ENCOUNTER 11 / DOCUMENT 7 / EXAM_REPORT 10 / MEDICATION 14

## 与生产的差别 (透明声明)

| 维度 | 生产 | 这个 seed |
|---|---|---|
| 数据来路 | 医院 HIS HTTP POST 进 `/gateway/his/events/*` | seed 直接调 Prisma, 跳过 HTTP |
| 审计层 | `InboundEventService.writeRecord` 写入, `promotionStatus = PENDING` | 直接写, 立即标 `PROMOTED` |
| Promote | `IntegrationPromoteService.promoteRecord` 异步推进 | seed 在同一个 `$transaction` 里同步推进 |
| `IntegrationSource.autoPromote` | 默认 `false` (人工核验) | seed 主动 promote, 不依赖该开关 |

业务表行的最终形状 (字段值 / FK 链 / `sourceSystem` / `externalRecordId`)
和真实生产跑 `autoPromote=true` 一致, 因此前端和下游报表查询走的是同一份
代码路径。

## 测试已经验证过的

- TypeScript 文件均通过括号 / 大括号配平检查
- `seed-all.js` 通过 `node --check` 语法检查
- 在内存 Prisma mock 上跑通 `seedHospitalRecordsViaGateway()`:
  - 42 events ingested / 42 promoted
  - 4 个 `externalRecordType` 类别全部到位 (ENCOUNTER:11, DOCUMENT:7, EXAM_REPORT:10, MEDICATION:14)
  - 42 条 audit 行的 `localTargetId` 全部能解到真实业务行
  - HospitalMedicationOrder.encounterRecordId FK 链完整
