# care_reminders_v3_3_1_write_protection

补齐 v3.3 在后端遗漏的写保护，并修掉"血压仍显示每日 1 次"的根因（种子里的提醒没绑 sourceId，导致 reconcile 跳过它）。

## 修复

### 1. `update / pause / resume` 现在也拒绝绑定计划（之前只有 `cancel` 挡住）
`care-reminder-schedule.service.ts` 的 `update()` 入口对 `sourceType=MEDICATION/VITAL` 直接抛 400
「绑定用药/指标计划的提醒不能在此直接修改，请到对应计划板块修改。」。`pause()`/`resume()` 都经过 `update()`，
因此一并被挡。前端不会点到，但旧前端 / 脚本 / 直接打 API 也无法再改坏绑定提醒。
（内部 reconcile/sync 走 `prisma.update` 直连，不经过 `update()`，不受影响。）

### 2. `POST /vital-schedules` 现在必须绑定指标监测计划
controller 校验：缺 `vitalMonitoringPlanId` → 400「指标提醒必须绑定指标监测计划。」；
校验该计划属于当前患者；并以**计划**的 `vitalType / customMeasureTimes / timesPerUnit / frequencyUnit`
为来源（**忽略 body 里的 scheduledTimes**）。不再可能创建无绑定的 VITAL 提醒。

### 3.（根因）血压仍显示每日 1 次：种子提醒没绑 sourceId
排查发现 demo 的血压 `CareReminderSchedule`（`demo-care-sched-001-bp`）**根本没有 `sourceId`**，
只有 `payload.vitalType`，且时间是脏的 `每日 1 次 20:00`。而 v3.3 的 reconcile 靠 `sourceId` 找计划，
`sourceId` 为 null 的行被跳过 → 永远不会被修正。
修复：
- **自愈存量**：`syncAllSchedulesForPatient()` 与 reconcile 脚本在 reconcile 前先 `backfillSourceIds()`：
  用 `payload.vitalPlanId/medicationId`，否则按 `patientId + vitalType / medicationName` 匹配患者的计划，
  回填 `sourceId`，随后即可正常 reconcile 成计划的「每日 2 次 07:30、19:30」。匹配不到来源的孤儿行保持不动（不误删）。
- **修种子**：demo 血压提醒改为绑定 `demo-vital-plan-001-bp`、每日 2 次 07:30/19:30、payload 补全；
  patient-003 的「血糖」提醒（该患者并无血糖计划）改绑其真实的 SPO2 计划。
  注意：seed 用 `upsert + update:{}`，只对**全新 seed** 生效；已有库靠上面的 backfill + reconcile 自愈。

### 4. smoke 增强
3f/3g/3h：对绑定计划的 schedule 执行 PATCH / pause / resume 均应 400；
3i：创建无计划的 VITAL schedule 应 400。

## 应用（WSL，仓库根目录）

```bash
ZIP="/mnt/c/Users/leoxi/Downloads/care_reminders_v3_3_1_write_protection_patch.zip"
TMP="/tmp/care_reminders_v3_3_1_write_protection_patch"
rm -rf "$TMP"; mkdir -p "$TMP"; unzip -q "$ZIP" -d "$TMP"; rsync -av "$TMP/" ./

python3 scripts/apply_care_reminders_v3_3_1_write_protection.py

cd apps/api
npx prisma generate
node prisma/reconcile-care-reminder-schedules.js --dry-run   # 先看会回填/修正什么
node prisma/reconcile-care-reminder-schedules.js             # 回填 sourceId + 对齐计划 + 去重
npm run smoke:care-reminders
npm run smoke:patient-engagement
cd ../web && npm run build
```

patcher 幂等（覆盖为同一版本）。reconcile 脚本支持 `--dry-run`（dry-run 下不持久化回填，故对这些行的 reconcile 数量会少报，实际跑会先回填再对齐）。

## 验证（本地沙箱已做）

- `care-reminder-schedule.service.ts` / `care-reminders.controller.ts` TS 语法 0 错误；
  reconcile / seed / smoke 脚本 `node --check` 通过。
- 逻辑单测：
  - 无 sourceId 的血压提醒 → backfill 匹配到 `demo-vital-plan-001-bp` → reconcile 成每日 2 次 07:30/19:30；
  - patient-003 的孤儿血糖提醒（无血糖计划）→ 匹配不到 → 保持不动；
  - `update/pause/resume` 守卫：VITAL/MEDICATION 阻断、ad-hoc 放行。

### 说明
沙箱连不了真实 Postgres，reconcile 在真实库的回填/对齐效果需你按上面命令跑完确认。建议先 `--dry-run`。
对当前已存在的库，请务必跑一次 reconcile（无参数），把血压提醒的 sourceId 回填并对齐到计划，
否则旧的 sourceId-less 行仅在打开患者详情页（触发 listForPatient 的 backfill）时才会被持久化修正。
