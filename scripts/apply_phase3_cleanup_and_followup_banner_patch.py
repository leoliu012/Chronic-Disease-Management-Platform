#!/usr/bin/env python3
"""Phase-3 cleanup patch: explanatory-text sweep, sidebar/timeline coherence,
restored 下次随访时间 banner, duplicate phone-follow-up task fix, and the new
PatientHandlingHistoryView wiring.

Run from the repo root (the directory that contains apps/, scripts/):

    python3 scripts/apply_phase3_cleanup_and_followup_banner_patch.py "$PWD"

Idempotent: re-runs print "No additional edits were needed".
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
    api_src = root / "apps" / "api" / "src"

    required = [
        web_src / "pages" / "PatientDetailPage.tsx",
        web_src / "pages" / "NurseDashboardPage.tsx",
        web_src / "components" / "PatientTaskSidePanel.tsx",
        web_src / "components" / "PatientHandlingHistoryView.tsx",
        web_src / "handling-history-v2.css",
        api_src / "follow-ups" / "follow-ups.service.ts",
    ]
    missing = [str(p) for p in required if not p.exists()]
    if missing:
        raise SystemExit(
            "Missing required file(s):\n  - "
            + "\n  - ".join(missing)
            + "\n\nRun this script from the repo root (the directory that\n"
              "contains apps/, scripts/, etc.) and make sure the patch zip\n"
              "was rsynced first so that PatientHandlingHistoryView.tsx and\n"
              "handling-history-v2.css already exist on disk."
        )

    edits: list[str] = []

    edits += patch_patient_detail_page(web_src / "pages" / "PatientDetailPage.tsx")
    edits += patch_nurse_dashboard_page(web_src / "pages" / "NurseDashboardPage.tsx")
    edits += patch_task_side_panel(web_src / "components" / "PatientTaskSidePanel.tsx")
    edits += patch_follow_ups_service(api_src / "follow-ups" / "follow-ups.service.ts")

    print()
    if edits:
        print("Applied edits:")
        for e in edits:
            print(f"  - {e}")
    else:
        print("No additional edits were needed (idempotent re-run).")

    print(
        "\nFollow-up:\n"
        "  1. Restart the API and the Vite dev server.\n"
        "  2. Smoke check:\n"
        "     - 护士工作台: 4 区域的解释性 <p> 文字消失。\n"
        "     - 患者详情页各 tab: 解释性 section-hint 已移除。\n"
        "     - 电话随访 tab: 顶部恢复『下次随访时间』banner（编辑/取消/\n"
        "       覆盖通知/已生成任务徽章）。\n"
        "     - 全部记录里的 PENDING 任务节点: 只有『处理当前任务』按钮。\n"
        "     - 任务侧边栏与全部记录一致显示 PENDING/IN_PROGRESS 任务。\n"
        "     - 处置记录 tab: 出现时间筛选 + 懒加载任务卡片，展开看到处理\n"
        "       流程图。\n"
        "     - 不再出现两个相同的『电话随访』计划任务。\n"
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def ensure_import_line(text: str, *, import_line: str, after_anchor: str) -> tuple[str, bool]:
    if import_line in text:
        return text, False
    if after_anchor not in text:
        return text, False
    return text.replace(after_anchor, after_anchor + "\n" + import_line, 1), True


# ---------------------------------------------------------------------------
# PatientDetailPage.tsx
# ---------------------------------------------------------------------------

PATIENT_DETAIL_EXPLANATORY_BLOCKS = [
    (
        "actions/risk-disposal section-hint",
        '\n                <p className="section-hint">先选择需要处置的风险预警，再勾选处置方式。提交处置后，该风险预警会自动标记为已处理。普通待办任务和风险随访任务在患者详情页内分区处理。</p>',
    ),
    (
        "actions/risk-disposal click-hint section-hint",
        '\n                    <p className="section-hint">处置方式不会通过单击卡片直接提交；必须勾选处置方式、填写电子签名后提交。</p>',
    ),
    (
        "disease/慢病档案 section-hint",
        '\n                <p className="section-hint">先查看已有诊断和风险分层；需要补录时再展开新增表单。</p>',
    ),
    (
        "monitoring/vital-form section-hint",
        '\n                <p className="section-hint">系统会按阈值自动判定异常并生成风险预警，通常无需手动勾选异常。</p>',
    ),
    (
        "monitoring/plan section-hint",
        '\n              <p className="section-hint">指标打卡计划由医院端维护。患者端只按计划录入，系统显示下一次打卡时间。</p>',
    ),
    (
        "medication/list section-hint",
        '\n                <p className="section-hint">先查看患者已有用药计划；新增或修改时再展开表单。</p>',
    ),
    (
        "medication/new-plan section-hint",
        '\n                <p className="section-hint">用药计划应由医生/护士或 HIS/药房处方接口维护；患者小程序只负责查看和打卡。</p>',
    ),
    (
        "care/follow-up section-hint",
        '\n                <p className="section-hint">普通待办任务在患者详情页内闭环；电话随访进入独立 tab，到院提醒进入“到院提醒”tab，结案进入右侧面板。</p>',
    ),
    (
        "follow-up/sub-header section-hint",
        '\n              <p className="section-hint">默认展示历史沟通记录，按记录创建时间倒序加载。需要记录新沟通时，再点击右侧按钮展开表单。</p>',
    ),
    (
        "handling-history section-hint (legacy)",
        '\n              <p className="section-hint">聚合电话随访、任务状态变更和风险处置结果。医护处理任务时可在右侧面板操作，完整病历和趋势仍保留在左侧患者档案。</p>',
    ),
    (
        "timeline/全流程 section-hint",
        '\n            <p className="section-hint">将全流程记录拆分为记录明细、指标趋势和处置闭环，避免所有信息直接堆在同一屏。</p>',
    ),
    (
        "timeline/closed-loop section-hint",
        '\n              <p className="section-hint">将相关的预警、任务、处置和随访结果合并为完整流程；该区块只在“处置闭环”二级页签下展示。</p>',
    ),
    (
        "vitals/近期健康指标 muted small",
        '\n                  <p className="muted small">院内录入、患者小程序和 LIS 同步的指标统一进入这里。</p>',
    ),
    (
        "vital-monitoring/打卡计划 muted small",
        '\n                  <p className="muted small">这些计划会同步到患者小程序，用于提醒和漏测判断。</p>',
    ),
    (
        "medication/打卡同步 muted small",
        '\n                  <p className="muted small">这些计划会同步到患者微信小程序，患者只能按计划打卡或反馈漏服。</p>',
    ),
    (
        "tasks/dead 'care' tab muted small",
        '\n                  <p className="muted small">电话随访记录在“电话随访”tab 内维护；任务结案在右侧处置面板内完成。</p>',
    ),
    (
        "alerts panel muted small",
        '\n                  <p className="muted small">可以选中预警快速完成处置；如需电话沟通，请进入“电话随访”tab。</p>',
    ),
    (
        "follow-up form muted small",
        '\n                  <p className="muted small">该记录直接归入患者档案，不再绑定具体任务；任务结案仍在右侧处置面板完成。</p>',
    ),
    (
        "follow-up history muted small (lazy loading)",
        '\n                <p className="muted small">Lazy loading 分页加载；默认按记录创建时间从新到旧排序。</p>',
    ),
]


NEXT_FOLLOW_UP_BANNER_PLACEHOLDER = (
    "\n          {/* next-follow-up-banner-removed-v1: 下次随访时间 banner intentionally removed from patient detail page. */}\n"
)

NEXT_FOLLOW_UP_BANNER_BLOCK = """
          {/* phone-follow-up-next-visit-patch:banner */}
          {overwrittenNextFollowUpNotice && (
            <div className="follow-up-next-visit-overwrite-notice" role="status">
              <strong>下次随访时间已被覆盖：</strong>
              原计划 {formatTime(overwrittenNextFollowUpNotice.previous)}
              → 现在 {formatTime(overwrittenNextFollowUpNotice.next)}。
              系统将基于新的时间生成电话随访提醒任务。
              <button
                type="button"
                className="dismiss"
                onClick={() => setOverwrittenNextFollowUpNotice(null)}
              >
                我知道了
              </button>
            </div>
          )}
          {(() => {
            if (activeNextFollowUpLoading && !activeNextFollowUp) {
              return (
                <div className="follow-up-next-visit-banner is-empty" role="status">
                  <div className="follow-up-next-visit-banner-main">
                    <span className="follow-up-next-visit-banner-label">下次随访时间</span>
                    <strong className="follow-up-next-visit-banner-time placeholder">加载中…</strong>
                  </div>
                </div>
              );
            }
            if (!activeNextFollowUp) {
              return (
                <div className="follow-up-next-visit-banner is-empty" role="note">
                  <div className="follow-up-next-visit-banner-main">
                    <span className="follow-up-next-visit-banner-label">下次随访时间</span>
                    <strong className="follow-up-next-visit-banner-time placeholder">尚未设置</strong>
                    <span className="follow-up-next-visit-banner-hint">在新建电话沟通记录时填写「下次随访时间」即可启用。系统会在到期前 2 天自动生成「电话随访」提醒任务。</span>
                  </div>
                </div>
              );
            }
            const nextMs = new Date(activeNextFollowUp.nextFollowUpTime).getTime();
            const now = Date.now();
            const isOverdue = Number.isFinite(nextMs) && nextMs < now;
            const isImminent = Number.isFinite(nextMs) && !isOverdue && (nextMs - now) <= 2 * 24 * 60 * 60 * 1000;
            const bannerClass = isOverdue
              ? 'follow-up-next-visit-banner is-overdue'
              : isImminent
                ? 'follow-up-next-visit-banner is-imminent'
                : 'follow-up-next-visit-banner';
            return (
              <div className={bannerClass} role="status">
                <div className="follow-up-next-visit-banner-main">
                  <span className="follow-up-next-visit-banner-label">下次随访时间</span>
                  <strong className="follow-up-next-visit-banner-time">{formatTime(activeNextFollowUp.nextFollowUpTime)}</strong>
                  <span className="follow-up-next-visit-banner-hint">
                    {isOverdue
                      ? '该时间已过期，请尽快与患者确认随访或重新安排时间。'
                      : isImminent
                        ? '距离下次随访不足 2 天，系统已自动生成「电话随访」提醒任务。'
                        : '距离下次随访 ≥ 2 天，到期前 2 天系统会自动生成提醒任务。'}
                  </span>
                  {activeNextFollowUpTask && (
                    <span className="follow-up-next-visit-banner-task-badge" title={activeNextFollowUpTask.id}>
                      已生成任务：{activeNextFollowUpTask.title}（{activeNextFollowUpTask.status}）
                    </span>
                  )}
                </div>
                <div className="follow-up-next-visit-banner-actions">
                  {editingNextFollowUp ? (
                    <div className="follow-up-next-visit-banner-edit">
                      <input
                        type="datetime-local"
                        value={nextFollowUpEditDraft}
                        onChange={(event) => setNextFollowUpEditDraft(event.target.value)}
                        disabled={savingNextFollowUp}
                      />
                      <button
                        type="button"
                        className="button"
                        onClick={saveEditedNextFollowUp}
                        disabled={savingNextFollowUp}
                      >
                        {savingNextFollowUp ? '保存中…' : '保存'}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={cancelEditNextFollowUp}
                        disabled={savingNextFollowUp}
                      >
                        放弃
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={beginEditNextFollowUp}
                        disabled={savingNextFollowUp || activeNextFollowUpLoading}
                      >
                        编辑时间
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={cancelActiveNextFollowUp}
                        disabled={savingNextFollowUp || activeNextFollowUpLoading}
                      >
                        取消计划
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
"""


def patch_patient_detail_page(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    edits: list[str] = []

    # 1. Imports
    text, added = ensure_import_line(
        text,
        import_line="import { PatientHandlingHistoryView } from '../components/PatientHandlingHistoryView';",
        after_anchor="import { PatientTaskSidePanel } from '../components/PatientTaskSidePanel';",
    )
    if added:
        edits.append(f"{path.name}: imported PatientHandlingHistoryView")

    text, added = ensure_import_line(
        text,
        import_line="import '../handling-history-v2.css';",
        after_anchor="import '../patient-detail-task-ux-polish.css';",
    )
    if added:
        edits.append(f"{path.name}: imported handling-history-v2.css")

    # 2. Restore 下次随访时间 banner
    marker = "phone-follow-up-next-visit-patch:banner"
    if marker not in text and NEXT_FOLLOW_UP_BANNER_PLACEHOLDER in text:
        text = text.replace(
            NEXT_FOLLOW_UP_BANNER_PLACEHOLDER,
            NEXT_FOLLOW_UP_BANNER_BLOCK,
            1,
        )
        edits.append(f"{path.name}: restored 下次随访时间 banner block")

    # 3. Explanatory paragraph sweep
    sweep_removed: list[str] = []
    for label, needle in PATIENT_DETAIL_EXPLANATORY_BLOCKS:
        if needle in text:
            text = text.replace(needle, "", 1)
            sweep_removed.append(label)
    if sweep_removed:
        edits.append(
            f"{path.name}: removed {len(sweep_removed)} explanatory blocks"
        )

    # 4. Timeline TASK PENDING action simplification
    old_pending_block = (
        "                  {item.type === 'TASK' &&\n"
        "                    item.data?.status === 'PENDING' && (\n"
        "                      <div className=\"timeline-actions\">\n"
        "                        <button className=\"timeline-action-button primary\" type=\"button\" onClick={() => item.data?.id && openFollowUpTab(item.data.id)}>\n"
        "                          记录电话随访\n"
        "                        </button>\n"
        "                        <button className=\"timeline-action-button\" type=\"button\" onClick={() => item.data?.id && openInlineTaskPanel(item.data.id, 'close')}>\n"
        "                          打开处置面板\n"
        "                        </button>\n"
        "                        {item.data?.relatedAlertId && (\n"
        "                          <span className=\"timeline-action-hint\">关联风险已合并到该任务详情中</span>\n"
        "                        )}\n"
        "                        <span className=\"timeline-action-hint\">待办任务请在患者档案内闭环</span>\n"
        "                      </div>\n"
        "                    )}\n"
    )
    new_pending_block = (
        "                  {item.type === 'TASK' &&\n"
        "                    item.data?.status === 'PENDING' && (\n"
        "                      <div className=\"timeline-actions\">\n"
        "                        {/* timeline-task-actions-v3: 只保留单一处理入口 */}\n"
        "                        <button className=\"timeline-action-button primary\" type=\"button\" onClick={() => item.data?.id && openInlineTaskPanel(item.data.id, 'close')}>\n"
        "                          处理当前任务\n"
        "                        </button>\n"
        "                      </div>\n"
        "                    )}\n"
    )
    if "timeline-task-actions-v3" not in text and old_pending_block in text:
        text = text.replace(old_pending_block, new_pending_block, 1)
        edits.append(f"{path.name}: simplified timeline TASK PENDING action buttons")

    # 5. Replace handling-history workspace with new component
    old_handling_history_section = (
        "      {activeWorkspace === 'handling-history' && (\n"
        "        <section className=\"panel patient-handling-history-panel collapsible-workspace-panel\">\n"
        "          <div className=\"hospital-section-header\">\n"
        "            <div>\n"
        "              <span>最近处理历史</span>\n"
        "              <h2>处置记录与任务闭环</h2>\n"
        "            </div>\n"
        "            {firstOpenTask?.data?.id && (\n"
        "              <button className=\"button\" type=\"button\" onClick={() => openInlineTaskPanel(firstOpenTask.data.id, 'close')}>\n"
        "                打开当前任务结案面板\n"
        "              </button>\n"
        "            )}\n"
        "          </div>\n"
        "\n"
        "          {handlingHistoryTimeline.length === 0 ? (\n"
        "            <div className=\"empty-state\">当前患者暂无处理历史。</div>\n"
        "          ) : (\n"
        "            <div className=\"handling-history-list\">\n"
        "              {handlingHistoryTimeline.slice(0, 30).map((item, index) => (\n"
        "                <article className=\"handling-history-card\" key={`${item.type}-${item.time}-${item.data?.id ?? index}`}>\n"
        "                  <div className=\"handling-history-time\">\n"
        "                    <strong>{timelineTypeLabelMap[item.type] ?? item.type}</strong>\n"
        "                    <span>{formatTime(item.time)}</span>\n"
        "                  </div>\n"
        "                  <div>\n"
        "                    <h3>{localizeBackendText(item.title)}</h3>\n"
        "                    <p>{localizeBackendText(item.description)}</p>\n"
        "                    <div className=\"handling-history-meta\">\n"
        "                      {item.data?.status && <span>状态：{statusLabelMap[item.data.status] ?? item.data.status}</span>}\n"
        "                      {item.data?.followUpType && <span>方式：{followUpTypeLabelMap[item.data.followUpType] ?? item.data.followUpType}</span>}\n"
        "                      {item.data?.operatorId && <span>记录人：{item.data.operatorId}</span>}\n"
        "                      {item.data?.handledBy && <span>处理人：{item.data.handledBy}</span>}\n"
        "                    </div>\n"
        "                  </div>\n"
        "                </article>\n"
        "              ))}\n"
        "            </div>\n"
        "          )}\n"
        "        </section>\n"
        "      )}\n"
    )
    new_handling_history_section = (
        "      {activeWorkspace === 'handling-history' && (\n"
        "        /* handling-history-v2: lazy-loaded task list + flow chart */\n"
        "        <PatientHandlingHistoryView\n"
        "          patientId={patientId ?? ''}\n"
        "          patient={data.patient}\n"
        "          formatTime={formatTime}\n"
        "          localizeBackendText={localizeBackendText}\n"
        "        />\n"
        "      )}\n"
    )
    if "<PatientHandlingHistoryView" not in text and old_handling_history_section in text:
        text = text.replace(old_handling_history_section, new_handling_history_section, 1)
        edits.append(f"{path.name}: wired PatientHandlingHistoryView into handling-history workspace")

    path.write_text(text, encoding="utf-8")
    return edits


# ---------------------------------------------------------------------------
# NurseDashboardPage.tsx
# ---------------------------------------------------------------------------

NURSE_DASHBOARD_PARAGRAPHS = [
    (
        "workItems heading paragraph",
        '\n                  <p>任务、预警、风险随访合并展示。所有任务回到患者详情页处理；电话随访在独立 tab 记录，到院与结案在右侧面板完成。</p>',
    ),
    (
        "vitals heading paragraph",
        '<p>指标异常作为风险来源线索；处理入口会落到患者详情页内的电话随访 tab 与处置面板。</p>',
    ),
    (
        "patients heading paragraph",
        '<p>当前护士负责患者清单。复杂筛选请进入“患者档案”的主索引页面。</p>',
    ),
    (
        "completed heading paragraph",
        '<p>显示最近完成任务，更多历史记录请在患者详情页时间线查看。</p>',
    ),
]


def patch_nurse_dashboard_page(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    edits: list[str] = []

    removed: list[str] = []
    for label, needle in NURSE_DASHBOARD_PARAGRAPHS:
        if needle in text:
            text = text.replace(needle, "", 1)
            removed.append(label)
    if removed:
        edits.append(f"{path.name}: removed {len(removed)} heading paragraph(s)")

    action_hint_pattern = re.compile(
        r"\s*<span className=\"work-item-action-hint\">\s*\{item\.itemType === 'RISK_FOLLOW_UP_TASK'[\s\S]*?\}\s*</span>",
    )
    new_text, n = action_hint_pattern.subn("", text, count=1)
    if n > 0:
        text = new_text
        edits.append(f"{path.name}: removed per-item .work-item-action-hint explanatory span")

    path.write_text(text, encoding="utf-8")
    return edits


# ---------------------------------------------------------------------------
# PatientTaskSidePanel.tsx
# ---------------------------------------------------------------------------

def patch_task_side_panel(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    edits: list[str] = []

    marker = "isActionableTask-orphan-fix-v1"
    if marker in text:
        return edits

    old_block = (
        "function isActionableTask(task: TimelineEvent, timeline: TimelineEvent[]) {\n"
        "  if (!isOpenTask(task)) return false;\n"
        "\n"
        "  const relatedAlert = getRelatedAlertForTask(task, timeline);\n"
        "  if (!relatedAlert) return true;\n"
        "\n"
        "  return !isClosedAlertStatus(relatedAlert.data?.status);\n"
        "}"
    )
    new_block = (
        "// " + marker + ": a PENDING/IN_PROGRESS task is always actionable, even\n"
        "// if its related alert has already been resolved/dismissed. Hiding such\n"
        "// tasks was the root cause of the \"sidebar 空 but 全部记录 still shows\n"
        "// 待办任务\" inconsistency reported by clinical users.\n"
        "function isActionableTask(task: TimelineEvent, _timeline: TimelineEvent[]) {\n"
        "  return isOpenTask(task);\n"
        "}"
    )
    if old_block in text:
        text = text.replace(old_block, new_block, 1)
        edits.append(f"{path.name}: dropped closed-alert filter from isActionableTask")

    path.write_text(text, encoding="utf-8")
    return edits


# ---------------------------------------------------------------------------
# follow-ups.service.ts (backend)
# ---------------------------------------------------------------------------

def patch_follow_ups_service(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    edits: list[str] = []

    marker = "phone-follow-up-dedupe-v1"
    if marker in text:
        return edits

    old_sync = (
        "  async syncPhoneFollowUpScheduledTask(patientId: string) {\n"
        "    return this.prisma.$transaction(async (tx) => {\n"
        "      const active = await this.findActiveScheduledRecord(patientId, tx);\n"
        "      const activeTime = active?.nextFollowUpTime ?? null;\n"
        "      const existingTask = await this.findOpenPhoneFollowUpTask(patientId, tx);\n"
        "\n"
        "      if (!activeTime) {\n"
        "        if (existingTask) {\n"
        "          await this.cancelOpenPhoneFollowUpScheduledTasks(\n"
        "            patientId,\n"
        "            '当前没有有效的下次随访时间，原电话随访提醒任务被取消。',\n"
        "            tx,\n"
        "          );\n"
        "        }\n"
        "        return { task: null };\n"
        "      }\n"
        "\n"
        "      // If existing task already targets the active time (within 1 minute), keep it.\n"
        "      if (\n"
        "        existingTask &&\n"
        "        existingTask.dueAt &&\n"
        "        Math.abs(existingTask.dueAt.getTime() - activeTime.getTime()) < 60_000\n"
        "      ) {\n"
        "        return { task: existingTask };\n"
        "      }\n"
        "\n"
        "      if (existingTask) {\n"
        "        await this.cancelOpenPhoneFollowUpScheduledTasks(\n"
        "          patientId,\n"
        "          '下次随访时间已更新，原电话随访提醒任务被取消，将根据最新时间重新生成。',\n"
        "          tx,\n"
        "        );\n"
        "      }\n"
        "\n"
        "      const task = await this.createPhoneFollowUpTaskIfDue(patientId, activeTime, tx);\n"
        "      return { task };\n"
        "    });\n"
        "  }"
    )

    new_sync = (
        "  async syncPhoneFollowUpScheduledTask(patientId: string) {\n"
        "    // " + marker + ": the previous version used findFirst() which silently\n"
        "    // left a second duplicate '电话随访' task untouched when the first\n"
        "    // matched activeTime. We now iterate over EVERY open scheduled task,\n"
        "    // keep at most one matching active time, and cancel the rest.\n"
        "    return this.prisma.$transaction(async (tx) => {\n"
        "      const active = await this.findActiveScheduledRecord(patientId, tx);\n"
        "      const activeTime = active?.nextFollowUpTime ?? null;\n"
        "\n"
        "      const existingTasks = await tx.task.findMany({\n"
        "        where: {\n"
        "          patientId,\n"
        "          type: PHONE_FOLLOW_UP_TASK_TYPE,\n"
        "          status: { in: OPEN_TASK_STATUSES },\n"
        "        },\n"
        "        orderBy: { createdAt: 'desc' },\n"
        "      });\n"
        "\n"
        "      if (!activeTime) {\n"
        "        if (existingTasks.length > 0) {\n"
        "          await this.cancelOpenPhoneFollowUpScheduledTasks(\n"
        "            patientId,\n"
        "            '当前没有有效的下次随访时间，原电话随访提醒任务被取消。',\n"
        "            tx,\n"
        "          );\n"
        "        }\n"
        "        return { task: null };\n"
        "      }\n"
        "\n"
        "      // Prefer the most recent task whose dueAt matches active time within 1 min.\n"
        "      const matchingTask = existingTasks.find(\n"
        "        (item) =>\n"
        "          item.dueAt && Math.abs(item.dueAt.getTime() - activeTime.getTime()) < 60_000,\n"
        "      );\n"
        "\n"
        "      if (matchingTask) {\n"
        "        const duplicateIds = existingTasks\n"
        "          .filter((item) => item.id !== matchingTask.id)\n"
        "          .map((item) => item.id);\n"
        "        if (duplicateIds.length > 0) {\n"
        "          await tx.task.updateMany({\n"
        "            where: { id: { in: duplicateIds } },\n"
        "            data: { status: TaskStatus.CANCELED },\n"
        "          });\n"
        "          await Promise.all(\n"
        "            duplicateIds.map((taskId) =>\n"
        "              tx.taskProcessingEvent\n"
        "                .create({\n"
        "                  data: {\n"
        "                    taskId,\n"
        "                    patientId,\n"
        "                    eventType: 'CANCEL_PROCESSING',\n"
        "                    title: '重复的电话随访提醒任务被取消',\n"
        "                    description: '同一患者存在多条电话随访提醒任务，系统保留最匹配下次随访时间的一条，其余自动取消。',\n"
        "                  },\n"
        "                })\n"
        "                .catch(() => null),\n"
        "            ),\n"
        "          );\n"
        "        }\n"
        "        return { task: matchingTask };\n"
        "      }\n"
        "\n"
        "      if (existingTasks.length > 0) {\n"
        "        await this.cancelOpenPhoneFollowUpScheduledTasks(\n"
        "          patientId,\n"
        "          '下次随访时间已更新，原电话随访提醒任务被取消，将根据最新时间重新生成。',\n"
        "          tx,\n"
        "        );\n"
        "      }\n"
        "\n"
        "      const task = await this.createPhoneFollowUpTaskIfDue(patientId, activeTime, tx);\n"
        "      return { task };\n"
        "    });\n"
        "  }"
    )
    if old_sync in text:
        text = text.replace(old_sync, new_sync, 1)
        edits.append(f"{path.name}: syncPhoneFollowUpScheduledTask now deduplicates open tasks")

    old_create_if_due = (
        "  private async createPhoneFollowUpTaskIfDue(\n"
        "    patientId: string,\n"
        "    nextFollowUpTime: Date,\n"
        "    client: DbClient = this.prisma,\n"
        "  ) {\n"
        "    const now = Date.now();\n"
        "    const target = nextFollowUpTime.getTime();\n"
        "    const timeUntil = target - now;\n"
        "\n"
        "    // Only generate when the appointment is reachable within the lead window AND not\n"
        "    // far in the past (a stale 30-day-old \"nextFollowUpTime\" should not auto-generate\n"
        "    // a new reminder task).\n"
        "    if (timeUntil > REMINDER_LEAD_TIME_MS) return null;\n"
        "    if (timeUntil < -REMINDER_LEAD_TIME_MS) return null;\n"
        "\n"
        "    const existing = await this.findOpenPhoneFollowUpTask(patientId, client);\n"
        "    if (existing) return existing;\n"
    )
    new_create_if_due = (
        "  private async createPhoneFollowUpTaskIfDue(\n"
        "    patientId: string,\n"
        "    nextFollowUpTime: Date,\n"
        "    client: DbClient = this.prisma,\n"
        "  ) {\n"
        "    const now = Date.now();\n"
        "    const target = nextFollowUpTime.getTime();\n"
        "    const timeUntil = target - now;\n"
        "\n"
        "    // Only generate when the appointment is reachable within the lead window AND not\n"
        "    // far in the past (a stale 30-day-old \"nextFollowUpTime\" should not auto-generate\n"
        "    // a new reminder task).\n"
        "    if (timeUntil > REMINDER_LEAD_TIME_MS) return null;\n"
        "    if (timeUntil < -REMINDER_LEAD_TIME_MS) return null;\n"
        "\n"
        "    // " + marker + ": collapse stale duplicates left over from a previous\n"
        "    // buggy build into a single open reminder task.\n"
        "    const existingTasks = await client.task.findMany({\n"
        "      where: {\n"
        "        patientId,\n"
        "        type: PHONE_FOLLOW_UP_TASK_TYPE,\n"
        "        status: { in: OPEN_TASK_STATUSES },\n"
        "      },\n"
        "      orderBy: { createdAt: 'desc' },\n"
        "    });\n"
        "    if (existingTasks.length > 0) {\n"
        "      const [keep, ...duplicates] = existingTasks;\n"
        "      if (duplicates.length > 0) {\n"
        "        await client.task.updateMany({\n"
        "          where: { id: { in: duplicates.map((t) => t.id) } },\n"
        "          data: { status: TaskStatus.CANCELED },\n"
        "        });\n"
        "      }\n"
        "      return keep;\n"
        "    }\n"
    )
    if old_create_if_due in text:
        text = text.replace(old_create_if_due, new_create_if_due, 1)
        edits.append(f"{path.name}: createPhoneFollowUpTaskIfDue now deduplicates open tasks")

    path.write_text(text, encoding="utf-8")
    return edits


if __name__ == "__main__":
    main()
