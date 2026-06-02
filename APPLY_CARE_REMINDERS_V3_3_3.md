# care_reminders_v3_3_3_worker_reconcile

承接 v3.3 / v3.3.1 / v3.3.2，补齐三个剩余项。

## 1. Worker 生成提醒前先 reconcile（最重要）

之前 `CareReminderWorkerService.passGenerate()` 直接查 `isActive:true` 的 schedule 并按其 `scheduledTimes`
生成 occurrence。如果护士刚在"指标监测"改了血压时间，但没人打开"慢病提醒"页（listForPatient 才 reconcile）、
也没跑 reconcile 脚本，worker 会用**旧时间**生成提醒——"按时自动提醒"这个核心场景不稳。

修复：`passGenerate()` 开头先收集所有 `sourceType in (MEDICATION,VITAL)` 的 schedule 的 patientId，
对每个 patient 调 `syncAllSchedulesForPatient()`（内部含 sourceId 回填 + 按来源计划对齐 + isActive 跟随），
每个 patient 用 try/catch 包裹（单个失败不影响整轮），然后**重新查**一遍 fresh 的 `isActive:true` schedule
再生成 occurrence。这样即使没人开页面，worker 也按计划当前时间生成。

### occurrence 漂移清理
`generateForSchedule` 用 `createMany({skipDuplicates:true})` + `@@unique([scheduleId,dueAt])`，只新增不删除。
所以时间从 20:00 改成 07:30/19:30 后，旧的 20:00 PENDING occurrence 会残留、与新时间并存。
修复：reconcile 时若某 schedule 的 `scheduledTimes` 变化，先 `pruneFuturePendingIfTimesChanged()` 删除该
schedule **未来的、未发送的（PENDING 且 dueAt > now）** occurrence，再更新 schedule；worker 随后按新时间重建。
已发送 / 已打开 / 已完成 / 已错过 / 已升级 / 过去的，一律保留。

## 2. 全局"慢病提醒中心"也去掉"今日提醒"

`CareRemindersPage.tsx`（独立路由，跨患者）移除"今日提醒（前后 24 小时）"板块及其 `listTodayOccurrences` 调用。
保留"未完成 / 已升级"列表，并给它加上"立即发送 / 再次发送"操作（让护士对遗漏的提醒补发），按钮统一 pe-admin。

## 3. 删除前端不用的 API helper

`apps/web/src/api/care-reminders.ts` 删除已无调用方的：
`createMedicationSchedule`、`createVitalSchedule`、`pauseSchedule`、`resumeSchedule`、`cancelSchedule`、
以及更早为"新增提醒计划"表单加的 `listPatientMedications` / `listPatientVitalPlans` /
`MedicationOption` / `VitalPlanOption`，和现在没人用的 `listTodayOccurrences`。
（后端对应端点仍在并继续挡绑定计划，只是前端不再暴露/误用。）

## smoke 增强
- 5b：worker run-once 后，血压 VITAL schedule 仍对齐计划（每日 2 次 07:30/19:30）——验证 worker 侧 reconcile。
- 18c：全局 CareRemindersPage 源码不再包含"今日提醒" / `listTodayOccurrences`。

## 应用（WSL，仓库根目录）

```bash
ZIP="/mnt/c/Users/leoxi/Downloads/care_reminders_v3_3_3_worker_reconcile_patch.zip"
TMP="/tmp/care_reminders_v3_3_3_worker_reconcile_patch"
rm -rf "$TMP"; mkdir -p "$TMP"; unzip -q "$ZIP" -d "$TMP"; rsync -av "$TMP/" ./

python3 scripts/apply_care_reminders_v3_3_3_worker_reconcile.py

cd apps/api
# 重启后端，worker 改动才生效：
npm run start:dev
# 另一个终端（API 跑起来后）：
npm run smoke:care-reminders
npm run smoke:patient-engagement
cd ../web && npm run build
```

patcher 幂等（覆盖为同一版本）。

## 验证（本地沙箱已做）

- 后端用真实 tsc（NestJS + Prisma client + class-validator，strict）编译整个 care-reminders 模块：
  worker + schedule.service 改动 **0 类型错误**。
- 前端真实 tsc：CareRemindersPage / api/care-reminders / CareRemindersPanel **0 错误**，删 helper 无断引用。
- smoke 脚本 `node --check` 通过。
- prune 逻辑单测：时间变化才触发；只删 dueAt > now 的 PENDING；已发送/已完成/已错过/过去的全部保留。

### 说明
- **必须重启 API**，worker 是常驻服务，改动重启后才生效。
- worker reconcile 现在每轮都会把 schedule 对齐计划，所以对已有库，存量"脏 schedule"会在 worker 下一轮自动修正并清理旧的未来 PENDING occurrence；也可仍用 `node prisma/reconcile-care-reminder-schedules.js` 立即修。
- 沙箱连不了 Postgres、跑不了浏览器，worker 真实生成时序、补发交互、按钮视觉需你跑起来确认。
