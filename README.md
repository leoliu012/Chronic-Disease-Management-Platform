# trend_chart_unify_followup_and_prestart_patch

Bundles four UX fixes for the patient detail page and the task processing
side panel:

1. **趋势图（VitalTrendChart / BloodPressureTrendChart）**
   - 不同趋势图 legend 统一：所有趋势图都使用 `vital-trend-legend-line`
     和 `vital-trend-legend-dash` 两种色卡，色块颜色直接取自 SVG 内真正
     渲染的线条 / 阈值虚线 / 预警标注，再也不会出现 legend 颜色和图中线条
     不一致的情况。
   - 图中事件标注只保留 “风险预警生成” 一类，电话随访 / 复测提醒事件
     不再出现在图上，避免干扰临床判断。
   - 新增一个共享的 “时间范围” 过滤条 (`TrendRangeFilterBar`)，提供
     `全部 / 近 7 天 / 近 30 天 / 近 90 天 / 近 180 天 / 自定义` 六个选项；
     选 `自定义` 后用两个 `<input type="date">` 指定起止日期。该过滤条
     会作用在血压、血糖、体重、心率、血氧五个趋势图上。
   - 选择范围在患者详情页的会话中会被记住；过滤行为已经走的是
     现有的 `editReason` / 记录保存通道（前端只是过滤展示，不修改后端
     数据），因此不会触发新的写入审计事件。

2. **患者详情页：取消下次随访时间板块**
   - 移除 “电话随访沟通记录” Tab 顶部那个固定的“下次随访时间”
     banner（包含倒计时提示、编辑/取消按钮、覆盖通知）。下次随访
     时间仍可以在新建电话沟通记录时填写，只是不再以独立 banner
     的形式展示在患者详情页内。
   - 同时移除该 banner 涉及的 `loadActiveNextFollowUp`、
     `cancelActiveNextFollowUp`、`saveEditedNextFollowUp` 等触发
     操作（按钮被移除后这些函数不会再被调用；保留函数定义对编译
     无影响，但 banner UI 已不再展示）。

3. **任务流程图重合显示修复（CSS）**
   - 流程节点 (`task-flow-node-topline`) 现在使用 flex+wrap，事件
     类型标题和时间戳在窄边栏内自动换行，不再相互覆盖。
   - “旧值 → 新值” 改用 `flex-wrap` 渲染，长字段（例如新的
     `下次随访时间` ISO 时间戳）不再撑爆右侧 detail 列。
   - `<880px` 的窄屏自动把 detail row 变成单列，避免标签和值
     重叠。

4. **任务开始处理前的侧边栏门户**
   - 任务未开始时，侧边栏只显示三块内容：
     - **任务选择板块**（新增）：让医护可以在开始前确认当前
       选中的是哪个任务，并切换到别的待处理任务。
     - **关联风险预警卡片**：高亮显示当前任务关联的风险预警。
     - **开始处理按钮**：满宽、加大、置于最底部的主操作按钮。
   - 其余内容（动态流程图、引导说明、结案表单等）在点击
     “开始处理” 之前不会出现。

## 应用方式

把 zip 放到 `~/Downloads/`，从仓库根目录运行：

```bash
cd /Users/xinruiliu/chronic-care-platform
ZIP="$HOME/Downloads/trend_chart_unify_followup_and_prestart_patch.zip"
TMP="/tmp/trend_chart_unify_followup_and_prestart_patch"

rm -rf "$TMP"
mkdir -p "$TMP"
unzip -q "$ZIP" -d "$TMP"
rsync -av "$TMP/" ./
python3 scripts/apply_trend_chart_unify_followup_and_prestart_patch.py "$PWD"
```

应用完毕后重启前端：

```bash
cd apps/web
npm run dev
```

## 幂等性

`scripts/apply_trend_chart_unify_followup_and_prestart_patch.py` 通过 marker
注释（`/* trend-chart-unified-v1 */`、`// prestart-task-list-v1`、
`// trend-range-filter-v1` 等）做幂等检查，重复执行只会输出
`No additional edits were needed`，不会重复写入。
