# care_reminders_v3_3_source_bound_ui_cleanup

Care Reminders v3.3：让长期提醒计划真正成为用药/指标计划的**派生层**，慢病提醒页改为**只读绑定视图**，并统一按钮 UX。

## 解决的问题

1. **血压每日 2 次（07:30、19:30）在慢病提醒里却显示每日 1 次、时间还不一样。**
   - 根因：`CareReminderSchedule` 自己存了一套 `scheduledTimes`，从不与 `VitalMonitoringPlan` 同步，于是漂移。
   - 修复（后端）：`listForPatient` 返回前 **reconcile** —— 读来源计划，把 schedule 的
     `scheduledTimes / timesPerUnit / frequencyUnit / title / isActive / payload` 对齐计划再返回；
     新增 `syncScheduleFromMedicationRecord / syncScheduleFromVitalMonitoringPlan / syncAllSchedulesForPatient`；
     create 端点写入后也立刻按来源计划对齐（忽略与计划不符的入参时间）。即使旧脏数据，打开页面即自动修正。
   - `buildSourceSummary` 现在带上 `scheduledTimes/timesPerUnit/frequencyUnit`，并本地化血压为「血压（收缩压/舒张压）」。

2. **慢病提醒里仍能「新增提醒计划」，会绕过主数据造成混乱。**
   - 修复（前端）：移除 `AddScheduleForm`、`adding` 状态、新增按钮、空状态里的新增提示。

3. **绑定计划的长期提醒不应能删除/取消。**
   - 修复（前端）：移除「取消计划」按钮与 `cancelSchedule` 调用。
   - 修复（后端）：`cancelSchedule` 对 `sourceType=MEDICATION/VITAL` 直接返回 400
     “绑定用药/指标计划的提醒不能在此删除，请到对应计划板块停用。”（即使有人直接打 API 也挡住。）

4. **患者详情页「今日提醒」板块多余、与长期提醒重复。**
   - 修复（前端）：移除 `TodaySection` 及其 state / API（不再请求 today 数据）。保留：长期提醒（只读）、未完成/已升级、护士主动消息、历史触达。

5. **微信随访 / 慢病提醒按钮 UX 不统一。**
   - 修复（前端 + CSS）：统一到 `pe-admin-primary`（主操作）/ `pe-admin-secondary`（普通操作）/
     `pe-admin-danger`（危险，仅微信随访保留）/ `pe-admin-link-button`（链接型）。补齐了通用按钮基样式
     （之前 `pe-admin-primary` 仅在弹窗里有定义，独立使用其实无样式）。

> 产品原则：MedicationRecord / VitalMonitoringPlan 是唯一主数据；CareReminderSchedule 只是触达层派生。
> 慢病提醒页只展示绑定关系、频率、时间、状态、跳转查看/修改来源计划，不在此新增/删除/取消。

## 实现选择（关于"在计划保存时同步"）

规格给了两条路：在医嘱/监测计划 create/update/deactivate 时调用 sync（更彻底），或先在
`listForPatient + 脚本`里修正（降级）。本补丁采用**降级路径**：`listForPatient` 每次 reconcile +
reconcile 脚本修存量。原因：在 medications / vital-plans 模块注入 care-reminders service 会引入跨模块
依赖与潜在循环依赖，风险高于收益；reconcile-on-read 已保证页面永远显示与计划一致的数据。
若你希望做到写时同步，告诉我，我再按你的模块边界接好依赖。

## 补丁内容

- `scripts/apply_care_reminders_v3_3_source_bound_backend.py` — 后端（schedule service /
  controller / reconcile 脚本）。
- `scripts/apply_care_reminders_v3_3_source_bound_frontend.py` — 前端（panel 只读化 / page / tab /
  api 类型 / 统一按钮 CSS）。
- `scripts/apply_care_reminders_v3_3_smoke.py` — smoke 增强。
- `files/...` — 上述脚本安装的全文件版本（patcher 幂等，直接覆盖到目标路径）。

## 应用（WSL，仓库根目录）

```bash
ZIP="/mnt/c/Users/leoxi/Downloads/care_reminders_v3_3_source_bound_ui_cleanup_patch.zip"
TMP="/tmp/care_reminders_v3_3_source_bound_ui_cleanup_patch"
rm -rf "$TMP"; mkdir -p "$TMP"; unzip -q "$ZIP" -d "$TMP"; rsync -av "$TMP/" ./

python3 scripts/apply_care_reminders_v3_3_source_bound_backend.py
python3 scripts/apply_care_reminders_v3_3_source_bound_frontend.py
python3 scripts/apply_care_reminders_v3_3_smoke.py

cd apps/api
npx prisma generate
node prisma/reconcile-care-reminder-schedules.js --dry-run   # 先看会改/删什么
node prisma/reconcile-care-reminder-schedules.js             # 实际修正 + 去重
npm run smoke:care-reminders
npm run smoke:patient-engagement

cd ../web
npm run build
```

patcher 幂等（重复运行覆盖为同一版本）。reconcile 脚本支持 `--dry-run`。

## 验证（本地沙箱已做）

- 后端 `care-reminder-schedule.service.ts` / `care-reminders.controller.ts` 语法 0 错误；
  reconcile 脚本、smoke 脚本 `node --check` 通过。
- 前端用与项目一致的严格 `tsc`（strict + vite/client）：`CareRemindersPanel.tsx` /
  `CareRemindersPage.tsx` / `PatientEngagementTab.tsx` / `api/care-reminders.ts` **0 类型错误**，无回归。
- reconcile / sync 核心逻辑单测：脏的「每日 1 次 08:00」会被修正为计划的「每日 2 次 07:30、19:30」。
- panel 静态检查：无 `新增提醒计划` / `AddScheduleForm` / `cancelSchedule(` / `取消计划` / `TodaySection`。

### 说明
沙箱连不了真实 Postgres、跑不了浏览器，所以 reconcile 在真实库的效果、跳转交互、按钮视觉需你按上面命令跑完后在页面确认。逻辑、类型、接线、脚本算法均已验证。
