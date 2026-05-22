#!/usr/bin/env python3
"""Apply the trend-chart-unify / cancel-next-follow-up / task-flow-overlap /
pre-start-task-selection patch.

This script is idempotent: re-running it after a successful first run prints
"No additional edits were needed".

Run from the repo root (the directory that contains apps/, scripts/, etc.):

    python3 scripts/apply_trend_chart_unify_followup_and_prestart_patch.py "$PWD"

What this patch does:

  1. PatientDetailPage.tsx
     - Imports `TrendRangeFilterBar`, `filterVitalsByTrendRange`,
       `describeTrendRange`, and `DEFAULT_TREND_RANGE` from VitalTrendChart.
     - Imports the new `trend-chart-unified-v1.css`.
     - Adds a single shared `vitalTrendRange` state.
     - Renders <TrendRangeFilterBar /> above the metric-trend-stack and
       threads the filtered vitals + rangeLabel into each chart.
     - Removes the "下次随访时间" banner block (and its "已被覆盖" notice)
       from the follow-up workspace tab.

  2. PatientTaskSidePanel.tsx
     - Adds a task selection list to the pre-start gate, so the nurse can
       switch between待处理 tasks before clicking "开始处理".

  3. patient-task-side-panel.css (no edit; the pre-start CSS lives in the
     new trend-chart-unified-v1.css so we can keep this script's footprint
     small.)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# entrypoint
# ---------------------------------------------------------------------------

def main() -> None:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd().resolve()
    web_src = root / "apps" / "web" / "src"

    required = [
        web_src / "components" / "VitalTrendChart.tsx",
        web_src / "components" / "PatientTaskSidePanel.tsx",
        web_src / "pages" / "PatientDetailPage.tsx",
        web_src / "trend-chart-unified-v1.css",
    ]
    missing = [str(p) for p in required if not p.exists()]
    if missing:
        raise SystemExit(
            "Missing required file(s):\n  - "
            + "\n  - ".join(missing)
            + "\n\nRun this script from the repo root (the directory that\n"
              "contains apps/, scripts/, etc.) — NOT from inside apps/api or\n"
              "apps/web. Make sure the patch zip was rsynced first so that\n"
              "the new VitalTrendChart.tsx and trend-chart-unified-v1.css\n"
              "are already on disk."
        )

    edits: list[str] = []

    edits += patch_patient_detail_page(web_src / "pages" / "PatientDetailPage.tsx")
    edits += patch_patient_task_side_panel(web_src / "components" / "PatientTaskSidePanel.tsx")

    print()
    if edits:
        print("Applied edits:")
        for e in edits:
            print(f"  - {e}")
    else:
        print("No additional edits were needed (idempotent re-run).")

    print(
        "\nFollow-up:\n"
        "  1. Restart Vite dev server (npm --prefix apps/web run dev) so the\n"
        "     new CSS file is picked up.\n"
        "  2. Smoke check:\n"
        "     - 患者详情页 -> 指标监测 Tab: 趋势图上方出现『时间范围』\n"
        "       过滤条；切换『近 7 天』/『自定义』后所有趋势图同步更新；\n"
        "       legend 中的色卡颜色与图内线条 / 阈值虚线一致；图上只剩\n"
        "       『风险预警生成』的标注。\n"
        "     - 患者详情页 -> 电话随访 Tab: 顶部不再有『下次随访时间』\n"
        "       banner；新建电话沟通记录功能保持原状。\n"
        "     - 任务流程图：长描述节点不再相互重叠。\n"
        "     - 任务未开始时，右侧侧边栏只展示『任务选择』+『关联风险\n"
        "       预警』+『开始处理按钮』。"
    )


# ---------------------------------------------------------------------------
# PatientDetailPage.tsx
# ---------------------------------------------------------------------------

def patch_patient_detail_page(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    edits: list[str] = []

    # 1. import TrendRangeFilterBar / filterVitalsByTrendRange / describeTrendRange / DEFAULT_TREND_RANGE
    text, added = upgrade_vital_trend_chart_import(text)
    if added:
        edits.append(f"{path.name}: extended VitalTrendChart import")

    # 2. import the new trend-chart-unified-v1.css
    text, added = ensure_css_import(
        text,
        css_module="../trend-chart-unified-v1.css",
        after_anchor="import '../patient-detail-task-ux-polish.css';",
    )
    if added:
        edits.append(f"{path.name}: imported trend-chart-unified-v1.css")

    # 3. add shared `vitalTrendRange` state right after vitalEventMarkers useMemo
    text, added = insert_vital_trend_range_state(text)
    if added:
        edits.append(f"{path.name}: added vitalTrendRange state (default 90 days)")

    # 4. wrap the trend stack with the filter bar + filtered vitals
    text, added = wrap_trend_stack_with_range_filter(text)
    if added:
        edits.append(f"{path.name}: wrapped trend stack with TrendRangeFilterBar + per-chart filtering")

    # 5. remove the "下次随访时间" banner block (and the overwritten notice)
    text, added = remove_next_follow_up_banner_block(text)
    if added:
        edits.append(f"{path.name}: removed 下次随访时间 banner + overwritten notice")

    path.write_text(text, encoding="utf-8")
    return edits


def upgrade_vital_trend_chart_import(text: str) -> tuple[str, bool]:
    marker = "trend-range-filter-import-v1"
    if marker in text:
        return text, False

    pattern = re.compile(
        r"import \{([^}]*)\} from '\.\./components/VitalTrendChart';"
    )
    m = pattern.search(text)
    if not m:
        return text, False

    existing = [s.strip() for s in m.group(1).split(",") if s.strip()]
    additions = [
        "TrendRangeFilterBar",
        "filterVitalsByTrendRange",
        "describeTrendRange",
        "DEFAULT_TREND_RANGE",
    ]
    for name in additions:
        if name not in existing:
            existing.append(name)

    new_import = (
        f"// {marker}\n"
        f"import {{ {', '.join(existing)} }} from '../components/VitalTrendChart';"
    )
    return text[: m.start()] + new_import + text[m.end():], True


def ensure_css_import(text: str, *, css_module: str, after_anchor: str) -> tuple[str, bool]:
    new_import_line = f"import '{css_module}';"
    if new_import_line in text:
        return text, False
    if after_anchor not in text:
        return text, False
    return text.replace(after_anchor, after_anchor + "\n" + new_import_line, 1), True


def insert_vital_trend_range_state(text: str) -> tuple[str, bool]:
    marker = "vital-trend-range-state-v1"
    if marker in text:
        return text, False

    anchor = (
        "  // 指标趋势图的事件标注\n"
        "  const vitalEventMarkers = useMemo(() => {"
    )
    if anchor not in text:
        return text, False

    new_state_block = (
        "  // " + marker + ": shared time-range filter for every trend chart on this page.\n"
        "  const [vitalTrendRange, setVitalTrendRange] = useState(DEFAULT_TREND_RANGE);\n\n"
        + anchor
    )
    return text.replace(anchor, new_state_block, 1), True


def wrap_trend_stack_with_range_filter(text: str) -> tuple[str, bool]:
    marker = "trend-range-filter-wrap-v1"
    if marker in text:
        return text, False

    # The target block is the IIFE that builds systolic/diastolic/glucose/...
    # vital arrays and returns a <div className="metric-trend-stack">.
    # Replace its first lines (the `const systolicVitals = ...` block) so
    # every series is filtered through `filterVitalsByTrendRange`, and inject
    # the <TrendRangeFilterBar /> + range label rendering above the stack.
    old_block = (
        "              ) : (() => {\n"
        "                const systolicVitals = vitalRecordTimeline.filter((item) => item.data?.type === 'SYSTOLIC_BP');\n"
        "                const diastolicVitals = vitalRecordTimeline.filter((item) => item.data?.type === 'DIASTOLIC_BP');\n"
        "                const glucoseVitals = vitalRecordTimeline.filter((item) => item.data?.type === 'BLOOD_GLUCOSE');\n"
        "                const weightVitals = vitalRecordTimeline.filter((item) => item.data?.type === 'WEIGHT');\n"
        "                const heartRateVitals = vitalRecordTimeline.filter((item) => item.data?.type === 'HEART_RATE');\n"
        "                const spo2Vitals = vitalRecordTimeline.filter((item) => item.data?.type === 'SPO2');\n"
        "                return (\n"
        "                  <div className=\"metric-trend-stack\">\n"
    )
    if old_block not in text:
        return text, False

    new_block = (
        "              ) : (() => {\n"
        "                // " + marker + ": share one time-range across every trend chart on this tab.\n"
        "                const rangeLabel = describeTrendRange(vitalTrendRange);\n"
        "                const systolicVitals = filterVitalsByTrendRange(\n"
        "                  vitalRecordTimeline.filter((item) => item.data?.type === 'SYSTOLIC_BP'),\n"
        "                  vitalTrendRange,\n"
        "                );\n"
        "                const diastolicVitals = filterVitalsByTrendRange(\n"
        "                  vitalRecordTimeline.filter((item) => item.data?.type === 'DIASTOLIC_BP'),\n"
        "                  vitalTrendRange,\n"
        "                );\n"
        "                const glucoseVitals = filterVitalsByTrendRange(\n"
        "                  vitalRecordTimeline.filter((item) => item.data?.type === 'BLOOD_GLUCOSE'),\n"
        "                  vitalTrendRange,\n"
        "                );\n"
        "                const weightVitals = filterVitalsByTrendRange(\n"
        "                  vitalRecordTimeline.filter((item) => item.data?.type === 'WEIGHT'),\n"
        "                  vitalTrendRange,\n"
        "                );\n"
        "                const heartRateVitals = filterVitalsByTrendRange(\n"
        "                  vitalRecordTimeline.filter((item) => item.data?.type === 'HEART_RATE'),\n"
        "                  vitalTrendRange,\n"
        "                );\n"
        "                const spo2Vitals = filterVitalsByTrendRange(\n"
        "                  vitalRecordTimeline.filter((item) => item.data?.type === 'SPO2'),\n"
        "                  vitalTrendRange,\n"
        "                );\n"
        "                return (\n"
        "                  <div className=\"metric-trend-stack\">\n"
        "                    <TrendRangeFilterBar value={vitalTrendRange} onChange={setVitalTrendRange} />\n"
    )
    text = text.replace(old_block, new_block, 1)

    # Now thread `rangeLabel` into each chart instance so the chart subtitle
    # reflects the selected window. We add the prop right before
    # `formatTime={formatTime}` on each chart in this block.
    chart_props_targets = [
        # blood pressure
        (
            "                      <BloodPressureTrendChart\n"
            "                        systolicVitals={systolicVitals}\n"
            "                        diastolicVitals={diastolicVitals}\n"
            "                        unit=\"mmHg\"\n"
            "                        eventMarkers={vitalEventMarkers}\n"
            "                        formatTime={formatTime}\n"
            "                      />",
            "                      <BloodPressureTrendChart\n"
            "                        systolicVitals={systolicVitals}\n"
            "                        diastolicVitals={diastolicVitals}\n"
            "                        unit=\"mmHg\"\n"
            "                        eventMarkers={vitalEventMarkers}\n"
            "                        rangeLabel={rangeLabel}\n"
            "                        formatTime={formatTime}\n"
            "                      />",
        ),
        # glucose
        (
            "                      <VitalTrendChart\n"
            "                        vitals={glucoseVitals}\n"
            "                        vitalType=\"BLOOD_GLUCOSE\"\n"
            "                        vitalTypeName=\"血糖\"\n"
            "                        unit=\"mmol/L\"\n"
            "                        thresholdHigh={10}\n"
            "                        thresholdLow={3.9}\n"
            "                        eventMarkers={vitalEventMarkers}\n"
            "                        formatTime={formatTime}\n"
            "                      />",
            "                      <VitalTrendChart\n"
            "                        vitals={glucoseVitals}\n"
            "                        vitalType=\"BLOOD_GLUCOSE\"\n"
            "                        vitalTypeName=\"血糖\"\n"
            "                        unit=\"mmol/L\"\n"
            "                        thresholdHigh={10}\n"
            "                        thresholdLow={3.9}\n"
            "                        eventMarkers={vitalEventMarkers}\n"
            "                        rangeLabel={rangeLabel}\n"
            "                        formatTime={formatTime}\n"
            "                      />",
        ),
        # weight
        (
            "                      <VitalTrendChart\n"
            "                        vitals={weightVitals}\n"
            "                        vitalType=\"WEIGHT\"\n"
            "                        vitalTypeName=\"体重\"\n"
            "                        unit=\"kg\"\n"
            "                        eventMarkers={vitalEventMarkers}\n"
            "                        formatTime={formatTime}\n"
            "                      />",
            "                      <VitalTrendChart\n"
            "                        vitals={weightVitals}\n"
            "                        vitalType=\"WEIGHT\"\n"
            "                        vitalTypeName=\"体重\"\n"
            "                        unit=\"kg\"\n"
            "                        eventMarkers={vitalEventMarkers}\n"
            "                        rangeLabel={rangeLabel}\n"
            "                        formatTime={formatTime}\n"
            "                      />",
        ),
        # heart rate
        (
            "                      <VitalTrendChart\n"
            "                        vitals={heartRateVitals}\n"
            "                        vitalType=\"HEART_RATE\"\n"
            "                        vitalTypeName=\"心率\"\n"
            "                        unit=\"bpm\"\n"
            "                        thresholdHigh={120}\n"
            "                        thresholdLow={50}\n"
            "                        eventMarkers={vitalEventMarkers}\n"
            "                        formatTime={formatTime}\n"
            "                      />",
            "                      <VitalTrendChart\n"
            "                        vitals={heartRateVitals}\n"
            "                        vitalType=\"HEART_RATE\"\n"
            "                        vitalTypeName=\"心率\"\n"
            "                        unit=\"bpm\"\n"
            "                        thresholdHigh={120}\n"
            "                        thresholdLow={50}\n"
            "                        eventMarkers={vitalEventMarkers}\n"
            "                        rangeLabel={rangeLabel}\n"
            "                        formatTime={formatTime}\n"
            "                      />",
        ),
        # spo2
        (
            "                      <VitalTrendChart\n"
            "                        vitals={spo2Vitals}\n"
            "                        vitalType=\"SPO2\"\n"
            "                        vitalTypeName=\"血氧\"\n"
            "                        unit=\"%\"\n"
            "                        thresholdLow={95}\n"
            "                        eventMarkers={vitalEventMarkers}\n"
            "                        formatTime={formatTime}\n"
            "                      />",
            "                      <VitalTrendChart\n"
            "                        vitals={spo2Vitals}\n"
            "                        vitalType=\"SPO2\"\n"
            "                        vitalTypeName=\"血氧\"\n"
            "                        unit=\"%\"\n"
            "                        thresholdLow={95}\n"
            "                        eventMarkers={vitalEventMarkers}\n"
            "                        rangeLabel={rangeLabel}\n"
            "                        formatTime={formatTime}\n"
            "                      />",
        ),
    ]
    for old, new in chart_props_targets:
        if old in text:
            text = text.replace(old, new, 1)

    return text, True


def remove_next_follow_up_banner_block(text: str) -> tuple[str, bool]:
    """Remove both the "下次随访时间" main banner IIFE and the "已被覆盖"
    overwrite-notice that sits right above it. We anchor the deletion on the
    unique `phone-follow-up-next-visit-patch:banner` marker comment and the
    closing `})()}` of the IIFE."""
    marker = "next-follow-up-banner-removed-v1"
    if marker in text:
        return text, False

    # The overwrite-notice block + the IIFE block both live between the
    # marker comment and the closing `})()}` that immediately precedes
    # `<section className="visit-patient-detail-card"`.
    pattern = re.compile(
        r"\s*\{/\* phone-follow-up-next-visit-patch:banner \*/\}"
        r"[\s\S]*?"
        r"\}\)\(\)\}\n",
        re.MULTILINE,
    )
    new_text, n = pattern.subn(
        "\n          {/* " + marker + ": 下次随访时间 banner intentionally removed from patient detail page. */}\n",
        text,
        count=1,
    )
    if n == 0:
        return text, False
    return new_text, True


# ---------------------------------------------------------------------------
# PatientTaskSidePanel.tsx
# ---------------------------------------------------------------------------

def patch_patient_task_side_panel(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    edits: list[str] = []

    text, added = add_prestart_task_list(text)
    if added:
        edits.append(f"{path.name}: added task selection list to pre-start gate")

    path.write_text(text, encoding="utf-8")
    return edits


def add_prestart_task_list(text: str) -> tuple[str, bool]:
    marker = "prestart-task-list-v1"
    if marker in text:
        return text, False

    old_block = (
        "  if (shouldShowPreStartOnly) {\n"
        "    return (\n"
        "      <aside className=\"patient-task-side-panel\" aria-label=\"患者任务处置面板\">\n"
        "        {renderPanelHeader()}\n"
        "        {renderPanelNotices()}\n"
        "\n"
        "        <section className=\"task-panel-section task-panel-prestart-gate\">\n"
        "          {relatedAlert ? (\n"
        "            renderRelatedAlertCard('prestart-related-alert')\n"
        "          ) : (\n"
        "            <div className=\"task-panel-current-task prestart-current-task\">\n"
        "              <div className=\"task-panel-current-task-topline\">\n"
        "                <span className=\"badge\">{taskTypeLabelMap[getTaskType(selectedTask)] ?? getTaskType(selectedTask)}</span>\n"
        "                <em className={getStatusClass(selectedTaskStatus)}>{statusLabelMap[selectedTaskStatus] ?? selectedTaskStatus}</em>\n"
        "              </div>\n"
        "              <h3>{localizeBackendText(selectedTask.title)}</h3>\n"
        "              <p>截止：{formatTime(getTaskDueAt(selectedTask))}</p>\n"
        "            </div>\n"
        "          )}\n"
        "\n"
        "          <button\n"
        "            className=\"button task-panel-start-primary-button\"\n"
        "            type=\"button\"\n"
        "            onClick={startProcessing}\n"
        "            disabled={submittingMode === 'START'}\n"
        "          >\n"
        "            {submittingMode === 'START' ? '正在开始处理...' : '开始处理'}\n"
        "          </button>\n"
        "        </section>\n"
        "      </aside>\n"
        "    );\n"
        "  }\n"
    )
    if old_block not in text:
        return text, False

    new_block = (
        "  if (shouldShowPreStartOnly) {\n"
        "    // " + marker + ": before the task is started, show task selection + related risk alert + start button only.\n"
        "    return (\n"
        "      <aside className=\"patient-task-side-panel\" aria-label=\"患者任务处置面板\">\n"
        "        {renderPanelHeader()}\n"
        "        {renderPanelNotices()}\n"
        "\n"
        "        <section className=\"task-panel-section task-panel-queue-section task-panel-prestart-task-list\">\n"
        "          <div className=\"task-panel-section-title task-panel-prestart-task-list-title\">\n"
        "            <span>选择任务</span>\n"
        "            <strong>{openTasks.length} 条待处理</strong>\n"
        "          </div>\n"
        "          <div className=\"task-panel-task-list\">\n"
        "            {sortedTasks.map((task) => {\n"
        "              const taskId = getTaskId(task);\n"
        "              const selected = taskId === selectedTaskStableId;\n"
        "              const status = getTaskStatus(task);\n"
        "              return (\n"
        "                <button\n"
        "                  key={taskId || `${task.time}-${task.title}`}\n"
        "                  type=\"button\"\n"
        "                  className={selected ? 'task-panel-task-card active' : 'task-panel-task-card'}\n"
        "                  onClick={() => onSelectTask(taskId, 'close')}\n"
        "                >\n"
        "                  <span>{taskTypeLabelMap[getTaskType(task)] ?? getTaskType(task)}</span>\n"
        "                  <strong>{localizeBackendText(task.title)}</strong>\n"
        "                  <small>截止：{formatTime(getTaskDueAt(task))}</small>\n"
        "                  <em className={getStatusClass(status)}>{statusLabelMap[status] ?? status}</em>\n"
        "                </button>\n"
        "              );\n"
        "            })}\n"
        "          </div>\n"
        "        </section>\n"
        "\n"
        "        <section className=\"task-panel-section task-panel-prestart-gate\">\n"
        "          {relatedAlert ? (\n"
        "            renderRelatedAlertCard('prestart-related-alert')\n"
        "          ) : (\n"
        "            <div className=\"task-panel-current-task prestart-current-task\">\n"
        "              <div className=\"task-panel-current-task-topline\">\n"
        "                <span className=\"badge\">{taskTypeLabelMap[getTaskType(selectedTask)] ?? getTaskType(selectedTask)}</span>\n"
        "                <em className={getStatusClass(selectedTaskStatus)}>{statusLabelMap[selectedTaskStatus] ?? selectedTaskStatus}</em>\n"
        "              </div>\n"
        "              <h3>{localizeBackendText(selectedTask.title)}</h3>\n"
        "              <p>截止：{formatTime(getTaskDueAt(selectedTask))}</p>\n"
        "            </div>\n"
        "          )}\n"
        "\n"
        "          <button\n"
        "            className=\"button task-panel-start-primary-button\"\n"
        "            type=\"button\"\n"
        "            onClick={startProcessing}\n"
        "            disabled={submittingMode === 'START'}\n"
        "          >\n"
        "            {submittingMode === 'START' ? '正在开始处理...' : '开始处理'}\n"
        "          </button>\n"
        "        </section>\n"
        "      </aside>\n"
        "    );\n"
        "  }\n"
    )

    return text.replace(old_block, new_block, 1), True


if __name__ == "__main__":
    main()
