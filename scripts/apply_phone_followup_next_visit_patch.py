#!/usr/bin/env python3
"""Apply the phone-follow-up next-visit-time patch.

This patch adds an active "下次随访时间" banner to the phone follow-up tab
on the patient detail page, with inline edit/cancel controls. When the
scheduled time is within 2 days of "now", the backend auto-generates a
"电话随访" task. New follow-up records that include a 下次随访时间
overwrite the previously active schedule and surface a notice to the user.

Backend files (full replacements) are shipped alongside this script and are
copied into place via the rsync step in the install command. This script
performs the surgical edits to the frontend that cannot be safely shipped
as full-file replacements (PatientDetailPage.tsx is ~3.4k lines).

Run from the repository root:
    python3 scripts/apply_phone_followup_next_visit_patch.py "$PWD"
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd().resolve()
WEB_SRC = ROOT / "apps" / "web" / "src"
API_SRC = ROOT / "apps" / "api" / "src"

changed: list[str] = []
notes: list[str] = []


def write_if_changed(path: Path, before: str, after: str) -> None:
    if before != after:
        path.write_text(after, encoding="utf-8")
        changed.append(str(path.relative_to(ROOT)))


# ---------------------------------------------------------------------------
# 1) main.tsx — register the new CSS module.
# ---------------------------------------------------------------------------

main_tsx = WEB_SRC / "main.tsx"
if not main_tsx.exists():
    raise SystemExit(f"Missing required file: {main_tsx.relative_to(ROOT)}")

main_text = main_tsx.read_text(encoding="utf-8")
new_main = main_text
if "./follow-up-next-visit.css" not in new_main:
    # Append the new import next to the operation-feedback css import so the
    # banner styles land in the same css layer as adjacent patient-detail UI.
    anchor = "import './operation-feedback.css';"
    if anchor in new_main:
        new_main = new_main.replace(
            anchor,
            anchor + "\nimport './follow-up-next-visit.css';",
            1,
        )
    else:
        # Fallback: insert before the App import.
        app_anchor = "import App from './App.tsx';"
        if app_anchor not in new_main:
            raise SystemExit(
                "main.tsx is unexpectedly shaped: cannot find an anchor to register "
                "follow-up-next-visit.css. Aborting so the build is not broken."
            )
        new_main = new_main.replace(
            app_anchor,
            "import './follow-up-next-visit.css';\n" + app_anchor,
            1,
        )

write_if_changed(main_tsx, main_text, new_main)


# ---------------------------------------------------------------------------
# 2) PatientDetailPage.tsx — surgical edits.
#
#    We add:
#      - Type + state for the active scheduled next-follow-up.
#      - A loader/refresher that re-runs after follow-up create/edit/delete.
#      - Edit/cancel handlers using the new backend endpoints.
#      - A banner UI inserted at the top of the follow-up tab.
#      - An "overwrite" notice when submitFollowUp returns
#        replacedPreviousScheduled.
# ---------------------------------------------------------------------------

page_path = WEB_SRC / "pages" / "PatientDetailPage.tsx"
if not page_path.exists():
    raise SystemExit(f"Missing required file: {page_path.relative_to(ROOT)}")

page_text = page_path.read_text(encoding="utf-8")
new_page = page_text

MARKER = "phone-follow-up-next-visit-patch:"


def has_marker(name: str) -> bool:
    return f"{MARKER}{name}" in new_page


# ----- 2a) Insert state declarations after followUpSignature state. -----

state_anchor = (
    "  const [followUpSignature, setFollowUpSignature] = useState('');"
)
if state_anchor not in new_page:
    raise SystemExit(
        "Could not locate followUpSignature state in PatientDetailPage.tsx. "
        "Refusing to patch a file that does not match the expected shape."
    )

if not has_marker("state"):
    state_block = (
        "\n\n  // " + MARKER + "state — see scripts/apply_phone_followup_next_visit_patch.py\n"
        "  const [activeNextFollowUp, setActiveNextFollowUp] = useState<{\n"
        "    followUpRecordId: string;\n"
        "    nextFollowUpTime: string;\n"
        "    sourceFollowUpType?: string;\n"
        "    sourceFollowUpTime?: string;\n"
        "    operatorId?: string | null;\n"
        "    recordCreatedAt?: string;\n"
        "  } | null>(null);\n"
        "  const [activeNextFollowUpTask, setActiveNextFollowUpTask] = useState<{\n"
        "    id: string;\n"
        "    title: string;\n"
        "    type: string;\n"
        "    status: string;\n"
        "    dueAt?: string | null;\n"
        "  } | null>(null);\n"
        "  const [activeNextFollowUpLoading, setActiveNextFollowUpLoading] = useState(false);\n"
        "  const [editingNextFollowUp, setEditingNextFollowUp] = useState(false);\n"
        "  const [nextFollowUpEditDraft, setNextFollowUpEditDraft] = useState('');\n"
        "  const [savingNextFollowUp, setSavingNextFollowUp] = useState(false);\n"
        "  const [overwrittenNextFollowUpNotice, setOverwrittenNextFollowUpNotice] = useState<{\n"
        "    previous: string;\n"
        "    next: string;\n"
        "  } | null>(null);"
    )
    new_page = new_page.replace(state_anchor, state_anchor + state_block, 1)


# ----- 2b) Insert helper functions just before primeFollowUpDraft. -----

helper_anchor = "  function primeFollowUpDraft() {"
if helper_anchor not in new_page:
    raise SystemExit(
        "Could not locate primeFollowUpDraft() in PatientDetailPage.tsx."
    )

if not has_marker("helpers"):
    helpers_block = (
        "  // " + MARKER + "helpers\n"
        "  async function loadActiveNextFollowUp() {\n"
        "    if (!patientId) {\n"
        "      setActiveNextFollowUp(null);\n"
        "      setActiveNextFollowUpTask(null);\n"
        "      return;\n"
        "    }\n"
        "    setActiveNextFollowUpLoading(true);\n"
        "    try {\n"
        "      const res = await api.get(\n"
        "        `/patients/${patientId}/follow-ups/active-next-follow-up`,\n"
        "      );\n"
        "      const payload = res.data ?? {};\n"
        "      setActiveNextFollowUp(payload.active ?? null);\n"
        "      setActiveNextFollowUpTask(payload.scheduledTask ?? null);\n"
        "    } catch (err) {\n"
        "      console.warn('Failed to load active next follow-up schedule.', err);\n"
        "      setActiveNextFollowUp(null);\n"
        "      setActiveNextFollowUpTask(null);\n"
        "    } finally {\n"
        "      setActiveNextFollowUpLoading(false);\n"
        "    }\n"
        "  }\n\n"
        "  function beginEditNextFollowUp() {\n"
        "    if (!activeNextFollowUp) return;\n"
        "    // datetime-local needs YYYY-MM-DDTHH:mm in local time.\n"
        "    const d = new Date(activeNextFollowUp.nextFollowUpTime);\n"
        "    if (Number.isNaN(d.getTime())) {\n"
        "      setNextFollowUpEditDraft('');\n"
        "    } else {\n"
        "      const pad = (n: number) => String(n).padStart(2, '0');\n"
        "      setNextFollowUpEditDraft(\n"
        "        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,\n"
        "      );\n"
        "    }\n"
        "    setEditingNextFollowUp(true);\n"
        "  }\n\n"
        "  function cancelEditNextFollowUp() {\n"
        "    setEditingNextFollowUp(false);\n"
        "    setNextFollowUpEditDraft('');\n"
        "  }\n\n"
        "  async function saveEditedNextFollowUp() {\n"
        "    if (!patientId || savingNextFollowUp) return;\n"
        "    const iso = toIsoDateTime(nextFollowUpEditDraft);\n"
        "    if (!iso) {\n"
        "      setError('请填写有效的下次随访时间。');\n"
        "      return;\n"
        "    }\n"
        "    resetNotice();\n"
        "    setSavingNextFollowUp(true);\n"
        "    try {\n"
        "      await api.patch(\n"
        "        `/patients/${patientId}/follow-ups/active-next-follow-up`,\n"
        "        { nextFollowUpTime: iso, editReason: '在患者详情页内调整下次随访时间' },\n"
        "      );\n"
        "      setMessage('下次随访时间已更新。');\n"
        "      setEditingNextFollowUp(false);\n"
        "      setNextFollowUpEditDraft('');\n"
        "      await Promise.all([\n"
        "        loadActiveNextFollowUp(),\n"
        "        loadFollowUpHistory({ reset: true }),\n"
        "        loadTimeline(),\n"
        "      ]);\n"
        "    } catch (err) {\n"
        "      console.error(err);\n"
        "      setError(getApiErrorMessage(err, '下次随访时间更新失败，请稍后重试。'));\n"
        "    } finally {\n"
        "      setSavingNextFollowUp(false);\n"
        "    }\n"
        "  }\n\n"
        "  async function cancelActiveNextFollowUp() {\n"
        "    if (!patientId || savingNextFollowUp) return;\n"
        "    if (!window.confirm('确定取消该患者当前的下次随访时间？取消后已生成的电话随访提醒任务也会一并关闭。')) {\n"
        "      return;\n"
        "    }\n"
        "    resetNotice();\n"
        "    setSavingNextFollowUp(true);\n"
        "    try {\n"
        "      await api.patch(\n"
        "        `/patients/${patientId}/follow-ups/active-next-follow-up`,\n"
        "        { nextFollowUpTime: null, editReason: '在患者详情页内取消下次随访时间' },\n"
        "      );\n"
        "      setMessage('下次随访时间已取消，关联的电话随访提醒任务也已关闭。');\n"
        "      setEditingNextFollowUp(false);\n"
        "      setNextFollowUpEditDraft('');\n"
        "      await Promise.all([\n"
        "        loadActiveNextFollowUp(),\n"
        "        loadFollowUpHistory({ reset: true }),\n"
        "        loadTimeline(),\n"
        "      ]);\n"
        "    } catch (err) {\n"
        "      console.error(err);\n"
        "      setError(getApiErrorMessage(err, '取消下次随访时间失败，请稍后重试。'));\n"
        "    } finally {\n"
        "      setSavingNextFollowUp(false);\n"
        "    }\n"
        "  }\n\n"
    )
    new_page = new_page.replace(helper_anchor, helpers_block + helper_anchor, 1)


# ----- 2c) Trigger loadActiveNextFollowUp() alongside follow-up history. -----

# The existing effect loads follow-up history when the user switches to the
# follow-up tab. We piggy-back the active-schedule loader so it stays in sync.
followup_effect_anchor = (
    "  useEffect(() => {\n"
    "    if (activeWorkspace !== 'follow-up' || followUpHistoryLoaded || followUpHistoryLoading) return;\n"
    "    loadFollowUpHistory({ reset: true });\n"
    "  }, [activeWorkspace, followUpHistoryLoaded, followUpHistoryLoading, patientId]);"
)

if followup_effect_anchor not in new_page:
    notes.append(
        "Could not find the follow-up tab effect verbatim; the auto-load on tab "
        "switch will only run when other reloads trigger. The banner still works."
    )
else:
    if not has_marker("tab-effect"):
        replacement = (
            followup_effect_anchor
            + "\n\n"
            + "  // " + MARKER + "tab-effect\n"
            + "  useEffect(() => {\n"
            + "    if (activeWorkspace !== 'follow-up') return;\n"
            + "    loadActiveNextFollowUp();\n"
            + "    // intentionally not depending on the loader identity\n"
            + "    // eslint-disable-next-line react-hooks/exhaustive-deps\n"
            + "  }, [activeWorkspace, patientId]);"
        )
        new_page = new_page.replace(followup_effect_anchor, replacement, 1)


# ----- 2d) submitFollowUp(): capture the response and surface the overwrite notice. -----

submit_anchor = (
    "    try {\n"
    "      await api.post(`/patients/${patientId}/follow-ups`, {\n"
    "        followUpType,\n"
    "        followUpTime: new Date().toISOString(),\n"
    "        content: [\n"
    "          `联系结果：${followUpContactOutcome}`,\n"
    "          content.trim(),\n"
    "        ].filter(Boolean).join('\\n'),\n"
    "        result: `随访结论：${followUpConclusion}。${result.trim()}`,\n"
    "        suggestion: `${suggestion.trim()}\\n电子签名：${signature}`,\n"
    "        nextFollowUpTime: toIsoDateTime(nextFollowUpTime),\n"
    "        operatorId: nurseId,\n"
    "      });\n"
    "\n"
    "      resetFollowUpForm();\n"
    "      setFollowUpFormOpen(false);\n"
    "      setMessage('电话随访记录已保存。');\n"
    "      setActiveTimelineType('FOLLOW_UP');\n"
    "      setFollowUpHistoryLoaded(false);\n"
    "\n"
    "      await Promise.all([\n"
    "        loadTimeline(),\n"
    "        loadFollowUpHistory({ reset: true }),\n"
    "      ]);"
)

submit_replacement = (
    "    try {\n"
    "      // " + MARKER + "submit\n"
    "      const submitRes = await api.post(`/patients/${patientId}/follow-ups`, {\n"
    "        followUpType,\n"
    "        followUpTime: new Date().toISOString(),\n"
    "        content: [\n"
    "          `联系结果：${followUpContactOutcome}`,\n"
    "          content.trim(),\n"
    "        ].filter(Boolean).join('\\n'),\n"
    "        result: `随访结论：${followUpConclusion}。${result.trim()}`,\n"
    "        suggestion: `${suggestion.trim()}\\n电子签名：${signature}`,\n"
    "        nextFollowUpTime: toIsoDateTime(nextFollowUpTime),\n"
    "        operatorId: nurseId,\n"
    "      });\n"
    "\n"
    "      const submitPayload = submitRes?.data ?? {};\n"
    "      const replaced = submitPayload.replacedPreviousScheduled;\n"
    "      const generatedReminder = submitPayload.generatedReminderTask;\n"
    "\n"
    "      resetFollowUpForm();\n"
    "      setFollowUpFormOpen(false);\n"
    "      if (replaced && replaced.nextFollowUpTime && submitPayload.nextFollowUpTime) {\n"
    "        setOverwrittenNextFollowUpNotice({\n"
    "          previous: String(replaced.nextFollowUpTime),\n"
    "          next: String(submitPayload.nextFollowUpTime),\n"
    "        });\n"
    "        setMessage('电话随访记录已保存，原下次随访时间已被本次记录覆盖。');\n"
    "      } else if (generatedReminder) {\n"
    "        setMessage('电话随访记录已保存，已自动生成「电话随访」提醒任务。');\n"
    "      } else {\n"
    "        setMessage('电话随访记录已保存。');\n"
    "      }\n"
    "      setActiveTimelineType('FOLLOW_UP');\n"
    "      setFollowUpHistoryLoaded(false);\n"
    "\n"
    "      await Promise.all([\n"
    "        loadTimeline(),\n"
    "        loadFollowUpHistory({ reset: true }),\n"
    "        loadActiveNextFollowUp(),\n"
    "      ]);"
)

if not has_marker("submit"):
    if submit_anchor not in new_page:
        notes.append(
            "submitFollowUp() block did not match verbatim; the 'overwrite' notice "
            "will not appear. Check apps/web/src/pages/PatientDetailPage.tsx by hand."
        )
    else:
        new_page = new_page.replace(submit_anchor, submit_replacement, 1)


# ----- 2e) Insert the banner JSX at the top of the follow-up workspace. -----

banner_anchor = (
    "          <div className=\"hospital-section-header follow-up-ledger-header\">"
)
banner_anchor_full = (
    "                {followUpFormOpen ? '收起新建表单' : '新建电话沟通记录'}\n"
    "              </button>\n"
    "              <button className=\"secondary-button\" type=\"button\" onClick={() => loadFollowUpHistory({ reset: true })} disabled={followUpHistoryLoading}>\n"
    "                刷新记录\n"
    "              </button>\n"
    "            </div>\n"
    "          </div>\n"
)

banner_jsx = (
    "          {/* " + MARKER + "banner */}\n"
    "          {overwrittenNextFollowUpNotice && (\n"
    "            <div className=\"follow-up-next-visit-overwrite-notice\" role=\"status\">\n"
    "              <strong>下次随访时间已被覆盖：</strong>\n"
    "              原计划 {formatTime(overwrittenNextFollowUpNotice.previous)}\n"
    "              → 现在 {formatTime(overwrittenNextFollowUpNotice.next)}。\n"
    "              系统将基于新的时间生成电话随访提醒任务。\n"
    "              <button\n"
    "                type=\"button\"\n"
    "                className=\"dismiss\"\n"
    "                onClick={() => setOverwrittenNextFollowUpNotice(null)}\n"
    "              >\n"
    "                我知道了\n"
    "              </button>\n"
    "            </div>\n"
    "          )}\n"
    "          {(() => {\n"
    "            if (activeNextFollowUpLoading && !activeNextFollowUp) {\n"
    "              return (\n"
    "                <div className=\"follow-up-next-visit-banner is-empty\" role=\"status\">\n"
    "                  <div className=\"follow-up-next-visit-banner-main\">\n"
    "                    <span className=\"follow-up-next-visit-banner-label\">下次随访时间</span>\n"
    "                    <strong className=\"follow-up-next-visit-banner-time placeholder\">加载中…</strong>\n"
    "                  </div>\n"
    "                </div>\n"
    "              );\n"
    "            }\n"
    "            if (!activeNextFollowUp) {\n"
    "              return (\n"
    "                <div className=\"follow-up-next-visit-banner is-empty\" role=\"note\">\n"
    "                  <div className=\"follow-up-next-visit-banner-main\">\n"
    "                    <span className=\"follow-up-next-visit-banner-label\">下次随访时间</span>\n"
    "                    <strong className=\"follow-up-next-visit-banner-time placeholder\">尚未设置</strong>\n"
    "                    <span className=\"follow-up-next-visit-banner-hint\">在新建电话沟通记录时填写「下次随访时间」即可启用。系统会在到期前 2 天自动生成「电话随访」提醒任务。</span>\n"
    "                  </div>\n"
    "                </div>\n"
    "              );\n"
    "            }\n"
    "            const nextMs = new Date(activeNextFollowUp.nextFollowUpTime).getTime();\n"
    "            const now = Date.now();\n"
    "            const isOverdue = Number.isFinite(nextMs) && nextMs < now;\n"
    "            const isImminent = Number.isFinite(nextMs) && !isOverdue && (nextMs - now) <= 2 * 24 * 60 * 60 * 1000;\n"
    "            const bannerClass = isOverdue\n"
    "              ? 'follow-up-next-visit-banner is-overdue'\n"
    "              : isImminent\n"
    "                ? 'follow-up-next-visit-banner is-imminent'\n"
    "                : 'follow-up-next-visit-banner';\n"
    "            return (\n"
    "              <div className={bannerClass} role=\"status\">\n"
    "                <div className=\"follow-up-next-visit-banner-main\">\n"
    "                  <span className=\"follow-up-next-visit-banner-label\">下次随访时间</span>\n"
    "                  <strong className=\"follow-up-next-visit-banner-time\">{formatTime(activeNextFollowUp.nextFollowUpTime)}</strong>\n"
    "                  <span className=\"follow-up-next-visit-banner-hint\">\n"
    "                    {isOverdue\n"
    "                      ? '该时间已过期，请尽快与患者确认随访或重新安排时间。'\n"
    "                      : isImminent\n"
    "                        ? '距离下次随访不足 2 天，系统已自动生成「电话随访」提醒任务。'\n"
    "                        : '距离下次随访 ≥ 2 天，到期前 2 天系统会自动生成提醒任务。'}\n"
    "                  </span>\n"
    "                  {activeNextFollowUpTask && (\n"
    "                    <span className=\"follow-up-next-visit-banner-task-badge\" title={activeNextFollowUpTask.id}>\n"
    "                      已生成任务：{activeNextFollowUpTask.title}（{activeNextFollowUpTask.status}）\n"
    "                    </span>\n"
    "                  )}\n"
    "                </div>\n"
    "                <div className=\"follow-up-next-visit-banner-actions\">\n"
    "                  {editingNextFollowUp ? (\n"
    "                    <div className=\"follow-up-next-visit-banner-edit\">\n"
    "                      <input\n"
    "                        type=\"datetime-local\"\n"
    "                        value={nextFollowUpEditDraft}\n"
    "                        onChange={(event) => setNextFollowUpEditDraft(event.target.value)}\n"
    "                        disabled={savingNextFollowUp}\n"
    "                      />\n"
    "                      <button\n"
    "                        type=\"button\"\n"
    "                        className=\"button\"\n"
    "                        onClick={saveEditedNextFollowUp}\n"
    "                        disabled={savingNextFollowUp}\n"
    "                      >\n"
    "                        {savingNextFollowUp ? '保存中…' : '保存'}\n"
    "                      </button>\n"
    "                      <button\n"
    "                        type=\"button\"\n"
    "                        className=\"secondary-button\"\n"
    "                        onClick={cancelEditNextFollowUp}\n"
    "                        disabled={savingNextFollowUp}\n"
    "                      >\n"
    "                        放弃\n"
    "                      </button>\n"
    "                    </div>\n"
    "                  ) : (\n"
    "                    <>\n"
    "                      <button\n"
    "                        type=\"button\"\n"
    "                        className=\"secondary-button\"\n"
    "                        onClick={beginEditNextFollowUp}\n"
    "                        disabled={savingNextFollowUp || activeNextFollowUpLoading}\n"
    "                      >\n"
    "                        编辑时间\n"
    "                      </button>\n"
    "                      <button\n"
    "                        type=\"button\"\n"
    "                        className=\"secondary-button\"\n"
    "                        onClick={cancelActiveNextFollowUp}\n"
    "                        disabled={savingNextFollowUp || activeNextFollowUpLoading}\n"
    "                      >\n"
    "                        取消计划\n"
    "                      </button>\n"
    "                    </>\n"
    "                  )}\n"
    "                </div>\n"
    "              </div>\n"
    "            );\n"
    "          })()}\n"
)

if not has_marker("banner"):
    if banner_anchor_full not in new_page:
        notes.append(
            "Banner anchor (follow-up header) did not match verbatim; the active "
            "next-follow-up banner was NOT inserted. The backend still generates "
            "tasks, but the UI banner is missing."
        )
    else:
        new_page = new_page.replace(
            banner_anchor_full,
            banner_anchor_full + banner_jsx,
            1,
        )


write_if_changed(page_path, page_text, new_page)


# ---------------------------------------------------------------------------
# 3) Backend sanity checks — the rsync step should have placed these.
# ---------------------------------------------------------------------------

service_path = API_SRC / "follow-ups" / "follow-ups.service.ts"
controller_path = API_SRC / "follow-ups" / "follow-ups.controller.ts"
dto_path = API_SRC / "follow-ups" / "dto" / "update-next-follow-up.dto.ts"
css_path = WEB_SRC / "follow-up-next-visit.css"

required_after_rsync = [
    (service_path, "syncPhoneFollowUpScheduledTask"),
    (controller_path, "active-next-follow-up"),
    (dto_path, "UpdateNextFollowUpDto"),
    (css_path, ".follow-up-next-visit-banner"),
]

for path, expected_token in required_after_rsync:
    if not path.exists():
        raise SystemExit(
            f"Expected file to be present after rsync but it is missing: "
            f"{path.relative_to(ROOT)}. Did the rsync step run before this script?"
        )
    if expected_token not in path.read_text(encoding="utf-8"):
        raise SystemExit(
            f"Expected marker {expected_token!r} not found in {path.relative_to(ROOT)}. "
            "The rsync step may have failed to overwrite this file."
        )


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

print("Phone follow-up next-visit patch applied.")
if changed:
    print("Files modified by this script:")
    for item in changed:
        print(f"  - {item}")
else:
    print("No additional edits were needed (idempotent re-run).")

if notes:
    print("\nNotes:")
    for note in notes:
        print(f"  ! {note}")

print(
    "\nFollow-up steps:\n"
    "  1. Restart the API so the new /patients/:patientId/follow-ups/active-next-follow-up\n"
    "     endpoints are registered.\n"
    "  2. No Prisma migration is required; this patch reuses the existing\n"
    "     FollowUpRecord.nextFollowUpTime column and the Task table.\n"
)
