#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path


def read(path: Path) -> str:
    return path.read_text(encoding='utf-8')


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        print(f'[skip] {label}: pattern not found or already applied')
        return text
    return text.replace(old, new, 1)


def regex_replace(text: str, pattern: str, repl: str, label: str, flags: int = re.S) -> str:
    next_text, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count == 0:
        print(f'[skip] {label}: regex not found or already applied')
    return next_text


def patch_patient_detail(root: Path) -> None:
    path = root / 'apps/web/src/pages/PatientDetailPage.tsx'
    text = read(path)

    text = replace_once(
        text,
        "import { PatientTaskSidePanel } from '../components/PatientTaskSidePanel';\n",
        "import { PatientTaskSidePanel } from '../components/PatientTaskSidePanel';\nimport { PatientHospitalVisitTab } from '../components/PatientHospitalVisitTab';\n",
        'import PatientHospitalVisitTab',
    )

    text = replace_once(
        text,
        "type PatientDetailWorkspace = 'overview' | 'hospital-records' | 'actions' | 'disease' | 'monitoring' | 'medication' | 'follow-up' | 'handling-history' | 'care' | 'timeline';",
        "type PatientDetailWorkspace = 'overview' | 'hospital-records' | 'actions' | 'disease' | 'monitoring' | 'medication' | 'follow-up' | 'hospital-visit' | 'handling-history' | 'care' | 'timeline';",
        'workspace union add hospital-visit',
    )

    text = replace_once(
        text,
        "  { key: 'follow-up', title: '电话随访', description: '沟通记录与随访闭环' },\n  { key: 'handling-history', title: '处置记录', description: '最近处理历史与签名' },",
        "  { key: 'follow-up', title: '电话随访', description: '沟通记录与随访闭环' },\n  { key: 'hospital-visit', title: '到院提醒', description: '生成提醒与到院结果' },\n  { key: 'handling-history', title: '处置记录', description: '最近处理历史与签名' },",
        'workspace tab add hospital-visit',
    )

    text = replace_once(
        text,
        "    value === 'follow-up' ||\n    value === 'handling-history' ||",
        "    value === 'follow-up' ||\n    value === 'hospital-visit' ||\n    value === 'handling-history' ||",
        'workspace guard add hospital-visit',
    )

    text = replace_once(
        text,
        "    if (key === 'follow-up') return phoneFollowUpTimeline.length;\n    if (key === 'handling-history') return handlingHistoryTimeline.length;",
        "    if (key === 'follow-up') return phoneFollowUpTimeline.length;\n    if (key === 'hospital-visit') return activeHospitalVisitReminders.length;\n    if (key === 'handling-history') return handlingHistoryTimeline.length;",
        'workspace count add hospital-visit',
    )

    text = text.replace(
        '风险预警只作为任务依据展示。电话随访在“电话随访”tab记录，到院提醒和结案在右侧处置面板完成。',
        '风险预警只作为任务依据展示。电话随访在“电话随访”tab记录，到院提醒在“到院提醒”tab处理，结案在右侧处置面板完成。',
    )
    text = text.replace(
        '提交后患者端将显示醒目的到院提醒；系统会自动生成“到院提醒任务”，护士在患者档案右侧处置面板内完成再次提醒、已到院、未到院或拒绝到院登记。',
        '提交后患者端将显示醒目的到院提醒；系统会自动生成到院提醒记录，护士在患者详情的“到院提醒”tab内完成再次提醒、已到院、未到院或拒绝到院登记。',
    )
    text = text.replace(
        '普通待办任务在患者详情页内闭环；电话随访进入独立 tab，结案/到院处理进入右侧面板。',
        '普通待办任务在患者详情页内闭环；电话随访进入独立 tab，到院提醒进入“到院提醒”tab，结案进入右侧面板。',
    )

    insertion = """
      {activeWorkspace === 'hospital-visit' && (
        <PatientHospitalVisitTab
          patientId={patient.id}
          patient={patient}
          timeline={data.timeline}
          activeHospitalVisitReminders={activeHospitalVisitReminders}
          onChanged={loadTimeline}
          formatTime={formatTime}
          localizeBackendText={localizeBackendText}
        />
      )}

"""
    if "activeWorkspace === 'hospital-visit'" not in text:
        marker = "      {activeWorkspace === 'handling-history' && (\n"
        text = replace_once(text, marker, insertion + marker, 'render hospital-visit tab')
    else:
        print('[skip] render hospital-visit tab: already present')

    text = text.replace(
        "              activeHospitalVisitReminders={activeHospitalVisitReminders}\n",
        '',
    )

    write(path, text)


def patch_task_side_panel(root: Path) -> None:
    path = root / 'apps/web/src/components/PatientTaskSidePanel.tsx'
    text = read(path)

    text = regex_replace(
        text,
        r"\ntype HospitalVisitReminder = \{.*?\};\n",
        "\n",
        'remove HospitalVisitReminder type',
    )
    text = text.replace('  activeHospitalVisitReminders: HospitalVisitReminder[];\n', '')
    text = text.replace('  activeHospitalVisitReminders,\n', '')

    text = regex_replace(
        text,
        r"type PanelMode =\n(?:  \| '[^']+';?\n)+",
        "type PanelMode = 'CLOSE';",
        'collapse PanelMode to CLOSE',
        flags=0,
    )

    text = re.sub(r"\nconst HOSPITAL_VISIT_TASK_TYPE = 'HOSPITAL_VISIT_FOLLOW_UP';\n", "\n", text, count=1)

    text = regex_replace(
        text,
        r"const modeMeta: Record<PanelMode, \{ title: string; hint: string \}> = \{.*?\n\};\n\nconst eventTypeLabelMap",
        "const modeMeta: Record<PanelMode, { title: string; hint: string }> = {\n  CLOSE: {\n    title: '处理完成',\n    hint: '提交处理总结和电子签名；提交前请复核流程图中的处理节点。',\n  },\n};\n\nconst eventTypeLabelMap",
        'replace modeMeta with CLOSE only',
    )

    text = regex_replace(
        text,
        r"function normalizeMode\(value\?: string \| null\): PanelMode \| null \{.*?\n\}",
        "function normalizeMode(value?: string | null): PanelMode | null {\n  const upper = String(value ?? '').toUpperCase();\n  if (upper === 'CLOSE' || upper === 'COMPLETE' || upper === 'PHONE' || upper.startsWith('VISIT')) return 'CLOSE';\n  return null;\n}",
        'replace normalizeMode',
    )

    text = regex_replace(
        text,
        r"\nfunction isOlderThanTwoDays\(value\?: string\) \{.*?\n\}\n\nfunction shortTime\(value\?: string\) \{.*?\n\}\n\nfunction getFirstReminderTime\(reminder\?: HospitalVisitReminder \| null\) \{.*?\n\}\n",
        "\n",
        'remove visit helper functions',
    )

    text = regex_replace(
        text,
        r"\n  const isHospitalVisitTask = getTaskType\(selectedTask\) === HOSPITAL_VISIT_TASK_TYPE;.*?\n  const selectedTaskStatus = getTaskStatus\(selectedTask\);",
        "\n  const selectedTaskStatus = getTaskStatus(selectedTask);",
        'remove current hospital visit reminder logic',
    )

    for old in [
        "  const [activeMode, setActiveMode] = useState<PanelMode>('VISIT');\n",
        "  const [visitReason, setVisitReason] = useState('');\n",
        "  const [visitNote, setVisitNote] = useState('');\n",
        "  const [visitSignature, setVisitSignature] = useState('');\n",
        "  const [visitActionNote, setVisitActionNote] = useState('');\n",
        "  const [visitActionSignature, setVisitActionSignature] = useState('');\n",
    ]:
        text = text.replace(old, '' if 'activeMode' not in old else "  const [activeMode, setActiveMode] = useState<PanelMode>('CLOSE');\n")

    text = regex_replace(
        text,
        r"\n  const availableModes = useMemo<PanelMode\[\]>\(\(\) => \{.*?\n  \}, \[currentHospitalVisitReminder, hospitalVisitOverdue\]\);",
        "\n  const availableModes = useMemo<PanelMode[]>(() => ['CLOSE'], []);",
        'replace availableModes',
    )

    text = regex_replace(
        text,
        r"\n    setVisitReason\(.*?\n    setVisitActionNote\(''\);",
        "",
        'remove visit state initialization in selected task effect',
    )

    text = regex_replace(
        text,
        r"\n  async function submitVisitReminder\(event: FormEvent<HTMLFormElement>\).*?\n  async function submitCloseTask",
        "\n  async function submitCloseTask",
        'remove visit submit handlers',
    )

    text = regex_replace(
        text,
        r"\n        \{currentHospitalVisitReminder && \(\n          <div className=\"task-panel-visit-reminder-summary\">.*?\n          </div>\n        \)}",
        "",
        'remove current visit reminder summary from side panel',
    )

    mode_section = """
      <section className="task-panel-section task-panel-mode-section">
        <div className="task-panel-mode-tabs" role="tablist" aria-label="任务处置动作">
          {availableModes.map((mode) => (
            <button
              key={mode}
              type="button"
              className={activeMode === mode ? 'active' : ''}
              onClick={() => setActiveMode(mode)}
              disabled={!flowHasStarted || taskIsClosed}
            >
              {modeMeta[mode].title}
            </button>
          ))}
        </div>

        <div className="task-panel-mode-body">
          <div className="task-panel-mode-hint">
            <strong>{modeMeta[activeMode].title}</strong>
            <p>{modeMeta[activeMode].hint}</p>
          </div>

          {activeMode === 'CLOSE' && !flowHasStarted && !taskIsClosed && (
            <div className="task-complete-locked-card">
              <strong>请先开始处理</strong>
              <p>任务开始后，左侧患者档案中的到院提醒、用药调整、复测计划、随访记录等操作会自动进入上方流程图。完成表格会在开始处理后显示。</p>
              <button className="button" type="button" disabled>确认处理完成</button>
            </div>
          )}

          {activeMode === 'CLOSE' && taskIsClosed && (
            <div className="task-complete-locked-card completed">
              <strong>当前任务已经结案</strong>
              <p>该任务的处理流程只读展示，不能重复提交处理完成。</p>
            </div>
          )}

          {activeMode === 'CLOSE' && flowHasStarted && !taskIsClosed && (
            <form className="hospital-form task-panel-form task-complete-form" onSubmit={submitCloseTask}>
              <div className="task-complete-flow-reminder">
                <strong>结案前请复核上方流程图</strong>
                <p>流程图会保留本次处理中的到院提醒、患者档案操作、用药/复测调整等节点。处理总结应概括主要动作、患者反馈和后续安排。</p>
              </div>
              <div className="form-row">
                <label>结案状态</label>
                <select value={closeStatus} onChange={(event) => setCloseStatus(event.target.value as 'DONE' | 'CANCELED')} disabled={submittingMode === 'CLOSE'}>
                  <option value="DONE">已完成</option>
                  <option value="CANCELED">取消/误报</option>
                </select>
              </div>
              <div className="form-row">
                <label>任务处理总结</label>
                <textarea value={closeNote} onChange={(event) => setCloseNote(event.target.value)} rows={5} disabled={submittingMode === 'CLOSE'} />
              </div>
              {selectedTaskRelatedAlertId && (
                <label className="task-complete-check relation-sync-check">
                  <input type="checkbox" checked={syncRelatedAlert} onChange={(event) => setSyncRelatedAlert(event.target.checked)} disabled={submittingMode === 'CLOSE'} />
                  处理完成时同步处置关联风险预警
                </label>
              )}
              <div className="form-row">
                <label>电子签名</label>
                <input value={closeSignature} onChange={(event) => setCloseSignature(event.target.value)} placeholder="请输入护士姓名 / 工号" disabled={submittingMode === 'CLOSE'} />
              </div>
              <div className="form-actions sticky-form-actions pro-form-actions">
                <button className="button" type="submit" disabled={submittingMode === 'CLOSE'}>{submittingMode === 'CLOSE' ? '提交中...' : '确认处理完成'}</button>
              </div>
            </form>
          )}
        </div>
      </section>
"""
    text = regex_replace(
        text,
        r"\n      <section className=\"task-panel-section task-panel-mode-section\">.*?\n      </section>\n    </aside>",
        "\n" + mode_section + "    </aside>",
        'replace task mode section with completion-only flow',
    )

    write(path, text)


def patch_css(root: Path) -> None:
    path = root / 'apps/web/src/patient-task-side-panel.css'
    text = read(path)
    addition = r'''

/* Patient detail hospital-visit tab: keep visit workflow separate from task processing panel. */
.patient-hospital-visit-tab-panel {
  display: grid;
  gap: 16px;
}

.patient-hospital-visit-header {
  align-items: center;
}

.patient-hospital-visit-contact-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.patient-hospital-visit-contact-grid > div {
  padding: 12px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #f8fafc;
}

.patient-hospital-visit-contact-grid span,
.patient-hospital-visit-contact-grid small,
.patient-hospital-visit-risk-card p,
.patient-hospital-visit-reminder-card header p,
.patient-hospital-visit-note {
  color: #64748b;
  font-size: 12px;
  line-height: 1.55;
}

.patient-hospital-visit-contact-grid strong,
.patient-hospital-visit-risk-card strong,
.patient-hospital-visit-reminder-card h3 {
  display: block;
  margin: 3px 0;
  color: #0f172a;
}

.patient-hospital-visit-create-form,
.patient-hospital-visit-list-card,
.patient-hospital-visit-reminder-card {
  padding: 15px;
  border: 1px solid #e5e7eb;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
}

.patient-hospital-visit-risk-card {
  padding: 12px;
  border: 1px solid #fed7aa;
  border-radius: 14px;
  background: #fff7ed;
}

.patient-hospital-visit-risk-card.compact {
  margin-top: 10px;
  padding: 10px 12px;
}

.patient-hospital-visit-reminder-list {
  display: grid;
  gap: 12px;
  margin-top: 12px;
}

.patient-hospital-visit-reminder-card header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.patient-hospital-visit-reminder-card header span {
  color: #0f766e;
  font-size: 12px;
  font-weight: 800;
}

.patient-hospital-visit-reminder-card header em {
  flex: 0 0 auto;
  align-self: flex-start;
  padding: 3px 9px;
  border-radius: 999px;
  background: #ecfdf5;
  color: #047857;
  font-size: 12px;
  font-style: normal;
  font-weight: 800;
}

.patient-hospital-visit-action-form {
  display: grid;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #dbe3ea;
}

.patient-hospital-visit-action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.task-complete-locked-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px dashed #cbd5e1;
  border-radius: 14px;
  background: #f8fafc;
}

.task-complete-locked-card strong {
  color: #0f172a;
}

.task-complete-locked-card p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

.task-complete-locked-card .button:disabled {
  background: #e2e8f0;
  color: #94a3b8;
  border-color: #cbd5e1;
  cursor: not-allowed;
  box-shadow: none;
}

.task-complete-locked-card.completed {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

@media (max-width: 1180px) {
  .patient-hospital-visit-contact-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .patient-hospital-visit-contact-grid {
    grid-template-columns: 1fr;
  }

  .patient-hospital-visit-reminder-card header {
    display: block;
  }
}
'''
    if 'Patient detail hospital-visit tab' not in text:
        text += addition
    write(path, text)


def main() -> None:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd().resolve()
    required = [
        root / 'apps/web/src/pages/PatientDetailPage.tsx',
        root / 'apps/web/src/components/PatientTaskSidePanel.tsx',
        root / 'apps/web/src/patient-task-side-panel.css',
        root / 'apps/web/src/components/PatientHospitalVisitTab.tsx',
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise SystemExit('Missing expected file(s):\n' + '\n'.join(missing))

    patch_patient_detail(root)
    patch_task_side_panel(root)
    patch_css(root)
    print('Applied hospital visit tab split patch.')


if __name__ == '__main__':
    main()
