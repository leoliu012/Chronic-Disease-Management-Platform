# trial_stabilization_v8_1_final_cleanup

这是当前试点前的最终增量收口补丁。它承接：

- Care Reminder Worker v7：PG advisory lock、heartbeat、运行指标、SENDING 恢复、指数退避与人工 replay；
- Audit / Ops v8：`@Audit()` 医疗审计 metadata、`/health/*`、`/admin/ops/*` 和管理员运维页面；
- 已验证的 reminder grouping / 微信随访 UX。

本补丁只修复最新源码和真实运行验证中仍然存在的两个问题，不引入护理组、CarePlan、BullMQ 或新的平行待办模型。

## 修复 1：过期 H5 链接自动收敛

现有 `FormLinkService.resolveByToken()` 只有在患者打开链接时才把过期 `ACTIVE` 链接更新为 `EXPIRED`。
如果患者从未打开链接，数据库和运维页会长期显示：

```text
activeLinksAlreadyExpired > 0
```

v8.1 在 Care Reminder Worker 已有 advisory lock 的 leader round 中增加：

```text
status = ACTIVE AND expiresAt <= now
→ status = EXPIRED
```

只有拿到 PG advisory lock 的实例执行清理。多 API 实例不会重复做 housekeeping。

新增每轮运行指标：

```text
expiredLinks
```

并在管理员运维页展示最近 24 小时“自动收敛过期链接”数量。

## 修复 2：第二医院 demo fixture 不再制造孤儿提醒

旧 `seed-all.js` 创建：

```text
demo-care-sched-101-med
sourceType = MEDICATION
sourceId = null
payload.medicationName = 示例药物
```

这违反既有产品不变量：

```text
MedicationRecord / VitalMonitoringPlan 是主数据
CareReminderSchedule 是触达派生层
MEDICATION / VITAL schedule 必须绑定来源
```

v8.1 增加：

```text
demo-med-101
```

并将：

```text
demo-care-sched-101-med → demo-med-101
```

绑定。seed 重复执行时也会自愈旧 fixture。

## 修复 3：运维页语义优化

`responsibleNurseId = null` 是待分配队列状态，并非数据损坏。
管理员页面将：

```text
患者缺少责任护士
```

调整为：

```text
待分配患者
进入待认领队列，不视为数据错误
```

## 数据库变更

仅增加一个 nullable-safe、带默认值的整数列：

```sql
ALTER TABLE "CareReminderWorkerRun"
ADD COLUMN "expiredLinks" INTEGER NOT NULL DEFAULT 0;
```

不会删除或改写历史业务数据。

---

## WSL 应用方式

从仓库根目录运行：

```bash
cd ~/Dev/Chronic-Disease-Management-Platform

ZIP="/mnt/c/Users/leoxi/Downloads/trial_stabilization_v8_1_final_cleanup_patch.zip"
TMP="/tmp/trial_stabilization_v8_1_final_cleanup_patch"

rm -rf "$TMP"
mkdir -p "$TMP"
unzip -q "$ZIP" -d "$TMP"
rsync -av "$TMP/" ./

python3 scripts/apply_trial_stabilization_v8_1.py
node scripts/assert-trial-stabilization-v8-1.js
```

开发环境：

```bash
cd apps/api

npx prisma migrate dev
npx prisma generate

node prisma/repair-trial-stabilization-v8-1.js --dry-run
node prisma/repair-trial-stabilization-v8-1.js
node prisma/reconcile-care-reminder-schedules.js

npm run build
```

正式医院环境不要运行 `migrate dev`：

```bash
cd apps/api

npx prisma migrate deploy
npx prisma generate

node prisma/repair-trial-stabilization-v8-1.js --dry-run
node prisma/repair-trial-stabilization-v8-1.js
node prisma/reconcile-care-reminder-schedules.js

npm run build
```

修改 Worker 后必须重启 API：

```bash
cd ~/Dev/Chronic-Disease-Management-Platform/apps/api
npm run start:dev
```

---

## 黑盒验收

在 API 已启动的另一个 WSL 终端运行：

```bash
cd ~/Dev/Chronic-Disease-Management-Platform/apps/api

node prisma/smoke-trial-stabilization-v8-1.js
node prisma/check-trial-stabilization-v8-1.js

node prisma/check-care-reminder-worker-v7.js
node prisma/smoke-audit-ops-v8.js
npm run smoke:care-reminders
npm run smoke:patient-engagement

cd ../web
npm run build
```

`smoke-trial-stabilization-v8-1.js` 会：

1. 管理员登录；
2. 临时创建一条已经过期但仍为 `ACTIVE` 的 H5 链接；
3. 触发一次 Worker leader round；
4. 验证链接自动变为 `EXPIRED`；
5. 验证 `expiredLinks` 写入 Worker run；
6. 验证 `/admin/ops/reminder-worker` 暴露该指标；
7. 验证 `/admin/ops/data-integrity` 中 `activeLinksAlreadyExpired = 0`；
8. 删除临时测试链接。

## 预期数据完整性结果

```text
sourceLessBoundSchedules: 0
activeLinksAlreadyExpired: 0
patientsWithoutResponsibleNurse: 1
staleOpenTasks: 8
```

后两项无需强行清零：

- `patientsWithoutResponsibleNurse: 1` 是第二医院跨租户 demo 患者，保留为未来待认领队列 fixture；
- `staleOpenTasks: 8` 是演示工作台的 SLA 超时和 reminder escalation 数据，应保留用于验证护士处置流程。

## Git 检查与提交

```bash
cd ~/Dev/Chronic-Disease-Management-Platform

git diff --stat
git diff -- \
  apps/api/prisma/schema.prisma \
  apps/api/prisma/seed-all.js \
  apps/api/src/care-reminders/care-reminder-worker.service.ts \
  apps/api/src/admin-ops/admin-ops.service.ts \
  apps/web/src/pages/AdminOpsPage.tsx

git status
```

确认构建与 smoke 通过后：

```bash
git add \
  apps/api/prisma \
  apps/api/src/care-reminders/care-reminder-worker.service.ts \
  apps/api/src/admin-ops/admin-ops.service.ts \
  apps/web/src/pages/AdminOpsPage.tsx \
  scripts/apply_trial_stabilization_v8_1.py \
  scripts/assert-trial-stabilization-v8-1.js \
  APPLY_TRIAL_STABILIZATION_V8_1.md

git commit -m "fix(trial): converge expired H5 links and repair reminder demo source binding"
```

## 暂不混入本补丁

以下继续作为独立 P1 / PR-8：

```text
CareTeam / 队列认领 / 交接班
/work-items 首页统一摘要
三高共管 CarePlan
NextBestAction
transactional outbox + BullMQ / Redis queue
```
