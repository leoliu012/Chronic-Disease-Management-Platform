# PR-8: hypertension-diabetes-careplan-pilot

## 目标

在已有闭环基础上增加真正的慢病管理价值层，首期只覆盖：

```text
高血压
2 型糖尿病
高脂血症
肥胖 / 代谢综合征
```

护士首页不再只显示任务条目，而是提供：

```text
今天最应该优先处理的 20 个患者
为什么优先
建议动作
最近是否已触达
患者是否回应
是否需要医生介入
```

本 PR 不替代现有 `Task`。`Task` 仍是唯一临床处置主对象。CarePlan 和 NextBestAction
负责解释、排序和建议；真正需要执行的人工处置继续创建或关联 Task。

---

## 产品不变量

1. `Task` 是唯一临床处置 work item，不增加平行待办模型。
2. `RiskAlert` 是风险证据，`RiskEpisode` 聚合同类风险。
3. `CareReminderOccurrence` 是患者自管理动作。
4. `PatientOutboundMessage` 是触达 case。
5. `NextBestAction` 是建议，不自动替代医生决策。
6. 每次人工确认、忽略、转医生、创建任务都写 `TaskProcessingEvent` 和 `AuditLog`。
7. 首期优先可解释规则，不引入黑盒模型。

---

## 建议新增模型

### CarePlan

患者某个慢病共管计划。

```prisma
model CarePlan {
  id               String   @id @default(uuid())
  patientId        String
  planType         String   // CARDIOMETABOLIC
  status           String   // ACTIVE / PAUSED / COMPLETED
  title            String
  enrolledAt       DateTime @default(now())
  pausedAt         DateTime?
  completedAt      DateTime?
  createdBy        String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  goals            CareGoal[]
  cadences         FollowUpCadence[]
  stratifications  PatientRiskStratification[]
  nextBestActions  NextBestAction[]

  @@index([patientId, status])
}
```

### CareGoal

首期目标示例：

```text
血压控制
血糖控制
LDL-C 管理
体重管理
服药依从性
复诊完成
```

字段建议：

```prisma
model CareGoal {
  id             String   @id @default(uuid())
  carePlanId     String
  goalType       String
  displayName    String
  target         Json
  status         String   // ACTIVE / ACHIEVED / PAUSED
  lastEvaluatedAt DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([carePlanId, goalType, status])
}
```

### FollowUpCadence

明确当前应随访的节奏：

```prisma
model FollowUpCadence {
  id          String   @id @default(uuid())
  carePlanId  String
  cadenceType String   // NURSE_PHONE / QUESTIONNAIRE / VITAL_RECHECK / DOCTOR_VISIT
  intervalDays Int
  nextDueAt   DateTime?
  isActive    Boolean  @default(true)
  policyVersion String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([carePlanId, isActive, nextDueAt])
}
```

### PatientRiskStratification

保存某个时间点的解释性风险分层快照：

```prisma
model PatientRiskStratification {
  id             String   @id @default(uuid())
  carePlanId     String
  patientId      String
  riskLevel      String   // LOW / MEDIUM / HIGH / VERY_HIGH
  priorityScore  Int
  reasons        Json     // 可解释证据数组
  policyVersion  String
  calculatedAt   DateTime @default(now())

  @@index([patientId, calculatedAt])
  @@index([riskLevel, priorityScore, calculatedAt])
}
```

### NextBestAction

护士首页展示的建议动作：

```prisma
model NextBestAction {
  id                String   @id @default(uuid())
  carePlanId        String
  patientId         String
  actionType        String
  title             String
  reasonSummary     String
  evidence          Json
  priorityScore     Int
  requiresDoctor    Boolean  @default(false)
  status            String   // PROPOSED / ACCEPTED / DISMISSED / COMPLETED / EXPIRED
  linkedTaskId      String?
  acceptedBy        String?
  acceptedAt        DateTime?
  dismissedBy       String?
  dismissedAt       DateTime?
  dismissReason     String?
  expiresAt         DateTime?
  policyVersion     String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([patientId, status, priorityScore])
  @@index([carePlanId, status])
  @@index([linkedTaskId])
}
```

---

## 首期优先级算法

先采用可解释规则分数，不使用不可解释模型。

示例：

| 证据 | 加分 |
|---|---:|
| 近 7 天血压 ≥ 5 次超标 | +35 |
| 出现极高危血压 | +50 |
| 近 3 天服药打卡缺失 | +20 |
| 最近一次触达失败 | +15 |
| 近 14 天未按要求提交血糖 | +20 |
| LDL-C 长期高于目标 | +15 |
| 体重持续上升 | +10 |
| 到院提醒未按时完成 | +25 |
| 已有开放 VERY_HIGH episode | +50 |
| 已有同类开放 Task | 不重复建 Task，提升现有项排序 |

每次计算保存：

```text
policyVersion
priorityScore
reasons[]
evidence[]
calculatedAt
```

护士必须能看到“为什么排在前面”。

---

## Next Best Action 示例

### 示例 1

```text
王某
优先级：高

近 7 天血压 5 次超标
近 3 天未服药打卡
最近一次短信触达失败

建议：
电话随访
重新发送复测提醒
必要时转医生
```

### 示例 2

```text
李某
优先级：极高

今日血压 185/116 mmHg
已有开放 RiskEpisode
患者尚未确认到院

建议：
立即电话联系
确认到院
转医生复核
```

---

## 后端接口建议

```http
GET  /care-plans/patients/:patientId
POST /care-plans/patients/:patientId/enroll
PATCH /care-plans/:id/status

GET  /care-plans/prioritized-patients?limit=20
GET  /care-plans/patients/:patientId/risk-stratifications
GET  /care-plans/patients/:patientId/next-best-actions

POST /care-plans/next-best-actions/:id/accept
POST /care-plans/next-best-actions/:id/dismiss
POST /care-plans/next-best-actions/:id/create-task
```

`create-task` 必须：

1. 检查是否已有同类开放 Task；
2. 有则关联并提升排序，不重复创建；
3. 没有才创建 Task；
4. 写 `TaskProcessingEvent`；
5. 写 `AuditLog`。

---

## 护士首页建议

新增一个顶部区域：

```text
今日优先患者
```

每张患者卡展示：

```text
患者姓名 / 院内号
风险等级
优先原因（最多 3 条）
建议动作
最近一次患者触达状态
患者最近回应
是否需要医生介入
进入处理页
```

默认展示前 20 人，支持：

```text
全部
需要医生介入
触达失败
未按时打卡
到院未完成
```

卡片底部的“进入处理页”仍然跳入现有 Task 处理页，不新增另一套处置页面。

---

## 定时计算

首期可继续放在 Nest Worker 中：

```text
每天凌晨重新计算一次
患者新异常指标后增量计算
MedicationCheckIn 漏服后增量计算
PatientOutboundAttempt 失败后增量计算
RiskEpisode 状态变化后增量计算
```

稳定版本再迁移为：

```text
transactional outbox
→ BullMQ / Redis queue
→ care-plan evaluator consumer
```

---

## 审计动作

PR-8 至少新增：

```text
ENROLL_CARE_PLAN
PAUSE_CARE_PLAN
RESUME_CARE_PLAN
ACCEPT_NEXT_BEST_ACTION
DISMISS_NEXT_BEST_ACTION
CREATE_TASK_FROM_NEXT_BEST_ACTION
RECALCULATE_PATIENT_RISK_STRATIFICATION
```

---

## 验收标准

### 数据层

- 同一患者可有一个 ACTIVE `CARDIOMETABOLIC` CarePlan；
- 每次风险重算保留可解释快照；
- NextBestAction 不覆盖历史记录；
- 接受建议后关联已有或新建 Task；
- 不产生平行待办表。

### 业务层

准备至少 8 个 demo 患者：

- 高血压连续超标；
- 糖尿病漏打卡；
- LDL-C 长期超标；
- 肥胖且体重上升；
- 多风险叠加；
- 短信触达失败；
- 到院未完成；
- 稳定低危患者。

验收：

- 前 20 名排序与规则一致；
- 每位患者至少显示一条可解释原因；
- 重复计算不重复生成开放 Task；
- 护士接受建议后能在现有任务处理页完成闭环；
- 所有人工动作均有审计记录。

---

## 建议拆分

```text
PR-8A  schema + seed + explainable evaluator
PR-8B  prioritized-patients API + nurse homepage cards
PR-8C  accept / dismiss / create-task workflow + audit
PR-8D  incremental evaluator triggers + ops metrics
```

这样可以在保持现有闭环稳定的前提下逐步增加临床价值。
