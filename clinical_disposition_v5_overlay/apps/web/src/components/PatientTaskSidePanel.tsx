


import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { api, getApiErrorMessage } from '../api/client';
import {
  showFeedbackError,
  showFeedbackSuccess,
  showRequiredFieldMissing,
} from '../utils/feedbackMessage';
import {
  clearActiveTaskProcessingSession,
  setActiveTaskProcessingSession,
} from '../utils/taskProcessingContext';
// entity-name-chip-v1: render `⟦name⟧` markers carried by audit-log
// descriptions and titles as styled pill chips instead of leaking the
// Unicode brackets through to the DOM as raw text.
import { renderWithNameChips } from './EntityName';
import { usePolling } from '../hooks/usePolling';

type Patient = {
  id: string;
  hospitalPatientId?: string;
  name: string;
  gender?: string;
  birthDate?: string;
  phone?: string;
  responsibleDoctorId?: string;
  responsibleNurseId?: string;
};

type TimelineEvent = {
  type: string;
  time: string;
  title: string;
  description?: string;
  data: any;
};


type TaskProcessingEvent = {
  id: string;
  taskId: string;
  patientId: string;
  eventType: string;
  title: string;
  description?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  operatorId?: string | null;
  electronicSignature?: string | null;
  createdAt: string;
};

type TaskPanelProps = {
  patientId: string;
  patient: Patient;
  tasks: TimelineEvent[];
  timeline: TimelineEvent[];
  selectedTaskId?: string;
  requestedMode?: string | null;
  onSelectTask: (taskId: string, mode?: string) => void;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  formatTime: (value?: string) => string;
  localizeBackendText: (value?: string | null) => string;
};

type PanelMode = 'CLOSE';

/**
 * 任务不再绑定/设定固定的处理方式 tag（例如旧的“到院提醒任务”）。
 * 一个待办任务可以有电话随访、用药调整、复测计划、到院提醒等多种处理动作。
 * 这里只根据“是否由风险预警触发”给出一个中性描述，不代表唯一处理方式。
 */
function getTaskKindLabel(task: TimelineEvent | null | undefined, timeline: TimelineEvent[]) {
  if (!task) return '护理待办任务';
  return getRelatedAlertForTask(task, timeline) ? '风险预警处理' : '护理待办任务';
}

const statusLabelMap: Record<string, string> = {
  PENDING: '待开始',
  IN_PROGRESS: '处理中',
  DONE: '已完成',
  CANCELED: '已取消',
  OPEN: '未处理',
  IN_REVIEW: '复核中',
  RESOLVED: '已处理',
  DISMISSED: '已忽略',
};

const riskLabelMap: Record<string, string> = {
  LOW: '低危',
  MEDIUM: '中危',
  HIGH: '高危',
  VERY_HIGH: '极高危',
};

const modeMeta: Record<PanelMode, { title: string; hint: string }> = {
  CLOSE: {
    title: '处理完成',
    hint: '提交处理总结和电子签名；提交前请复核流程图中的处理节点。',
  },
};

const eventTypeLabelMap: Record<string, string> = {
  TASK_CREATED: '任务生成',
  START_PROCESSING: '开始处理',
  VISIT_REMINDER_SENT: '建议到院',
  VISIT_REMIND_AGAIN: '再次提醒',
  VISIT_ARRIVED: '已到院',
  VISIT_NO_SHOW: '未到院',
  VISIT_REFUSED: '拒绝到院',
  AUTO_PATIENT_ACTION: '档案操作',
  COMPLETE_PROCESSING: '处理完成',
  CANCEL_PROCESSING: '取消/误报',
};

function normalizeMode(value?: string | null): PanelMode | null {
  const upper = String(value ?? '').toUpperCase();
  if (upper === 'CLOSE' || upper === 'COMPLETE' || upper === 'PHONE' || upper.startsWith('VISIT')) return 'CLOSE';
  return null;
}

function getTaskId(task: TimelineEvent) {
  return String(task.data?.id ?? '');
}

function getTaskStatus(task?: TimelineEvent | null) {
  return String(task?.data?.status ?? '');
}

function getTaskDueAt(task?: TimelineEvent | null) {
  return task?.data?.dueAt ?? task?.data?.dueDate ?? undefined;
}

function getStatusClass(status?: string) {
  return `status-badge status-${String(status || '').toLowerCase().replace(/_/g, '-')}`;
}

function getRiskClass(riskLevel?: string) {
  return `risk-badge risk-${String(riskLevel || '').toLowerCase().replace(/_/g, '-')}`;
}

function isOpenTask(task: TimelineEvent) {
  return ['PENDING', 'IN_PROGRESS'].includes(getTaskStatus(task));
}

function isClosedTask(task?: TimelineEvent | null) {
  return ['DONE', 'CANCELED'].includes(getTaskStatus(task));
}

function getTaskRelatedAlertId(task?: TimelineEvent | null) {
  return String(task?.data?.relatedAlertId ?? '');
}

function isClosedAlertStatus(status?: string | null) {
  return ['RESOLVED', 'DISMISSED'].includes(String(status ?? '').toUpperCase());
}

function getRelatedAlertForTask(task: TimelineEvent | null | undefined, timeline: TimelineEvent[]) {
  const relatedAlertId = getTaskRelatedAlertId(task);
  if (!relatedAlertId) return null;
  return timeline.find((item) => item.type === 'RISK_ALERT' && item.data?.id === relatedAlertId) ?? null;
}

function isActionableTask(task: TimelineEvent, timeline: TimelineEvent[]) {
  if (!isOpenTask(task)) return false;

  const relatedAlert = getRelatedAlertForTask(task, timeline);
  if (!relatedAlert) return true;

  return !isClosedAlertStatus(relatedAlert.data?.status);
}



function eventClass(eventType: string) {
  return `task-flow-node-${String(eventType || 'other').toLowerCase().replace(/_/g, '-')}`;
}

function sourceTypeLabel(sourceType?: string | null) {
  if (!sourceType) return '';
  const labels: Record<string, string> = {
    FRONTEND_AUTO_ASSOCIATION: '患者档案自动关联',
    HOSPITAL_VISIT_REMINDER: '到院提醒',
    TASK_PROCESSING: '任务处理',
  };
  return labels[sourceType] ?? sourceType;
}

type ParsedDescriptionRow = {
  id: string;
  label?: string;
  value?: string;
  before?: string;
  after?: string;
  raw?: string;
};

type ParsedDescription = {
  summary: string;
  rows: ParsedDescriptionRow[];
};

function trimEndingPunctuation(value: string) {
  return value.replace(/[。；;\s]+$/g, '').trim();
}

function parseStructuredDescription(description?: string | null): ParsedDescription | null {
  const text = trimEndingPunctuation(String(description ?? ''));
  if (!text) return null;

  const firstColonIndex = text.indexOf('：');
  if (firstColonIndex < 0) return null;

  const summary = text.slice(0, firstColonIndex).trim();
  const detailsText = text.slice(firstColonIndex + 1).trim();
  if (!summary || !detailsText) return null;

  const rows = detailsText
    .split('；')
    .map((part) => trimEndingPunctuation(part))
    .filter(Boolean)
    .map((part, index) => {
      const colonIndex = part.indexOf('：');
      if (colonIndex < 0) return { id: `${index}-${part}`, raw: part };

      const label = part.slice(0, colonIndex).trim();
      const value = part.slice(colonIndex + 1).trim();
      const arrowIndex = value.indexOf(' → ');

      if (arrowIndex >= 0) {
        return {
          id: `${index}-${label}`,
          label,
          before: value.slice(0, arrowIndex).trim(),
          after: value.slice(arrowIndex + 3).trim(),
        };
      }

      return { id: `${index}-${label}`, label, value };
    });

  if (!rows.length) return null;
  return { summary, rows };
}

function renderFlowDescription(description: string, localizeBackendText: (value?: string | null) => string) {
  const localized = localizeBackendText(description);
  const parsed = parseStructuredDescription(localized);

  // entity-name-chip-v1: descriptions emitted by taskProcessingContext.ts
  // (e.g. `更新用药计划⟦二甲双胍片⟧：剂量：100mg → 200mg`) carry chip
  // markers in the summary AND inside `before/after/raw/value`. Wrap every
  // text slot with renderWithNameChips so the brackets become styled pills.
  if (!parsed) return <p>{renderWithNameChips(localized)}</p>;

  return (
    <div className="task-flow-node-description">
      <p className="task-flow-node-summary">
        <strong>{renderWithNameChips(parsed.summary)}</strong>
      </p>
      <dl className="task-flow-node-detail-list">
        {parsed.rows.map((row) => (
          <div key={row.id} className="task-flow-node-detail-row">
            {row.raw ? (
              <dd className="task-flow-node-detail-value task-flow-node-detail-raw">{renderWithNameChips(row.raw)}</dd>
            ) : (
              <>
                <dt className="task-flow-node-detail-label">{renderWithNameChips(row.label)}</dt>
                <dd className="task-flow-node-detail-value">
                  {row.before !== undefined && row.after !== undefined ? (
                    <span className="task-flow-node-change">
                      <span className="task-flow-node-before">{row.before ? renderWithNameChips(row.before) : '未填写'}</span>
                      <span className="task-flow-node-arrow">→</span>
                      <strong className="task-flow-node-after">{row.after ? renderWithNameChips(row.after) : '未填写'}</strong>
                    </span>
                  ) : (
                    <strong>{renderWithNameChips(row.value)}</strong>
                  )}
                </dd>
              </>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}

function ProcessingFlowChart({
  selectedTask,
  events,
  loading,
  formatTime,
  localizeBackendText,
}: {
  selectedTask: TimelineEvent;
  events: TaskProcessingEvent[];
  loading: boolean;
  formatTime: (value?: string) => string;
  localizeBackendText: (value?: string | null) => string;
}) {
  const nodes = useMemo(() => {
    const selectedTaskId = getTaskId(selectedTask);

    return [...events]
      .filter((node) => node.eventType !== 'TASK_CREATED' && node.id !== `task-created-${selectedTaskId}`)
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  }, [events, selectedTask]);

  return (
    <div className="task-processing-flow-card">
      <div className="task-processing-flow-header">
        <div>
          <span>动态处理流程</span>
          <strong>{nodes.length} 个节点</strong>
        </div>
        {loading && <em>加载中...</em>}
      </div>
      <ol className="task-processing-flow-rail">
        {nodes.map((node, index) => (
          <li key={node.id} className={eventClass(node.eventType)}>
            <div className="task-flow-node-index">{index + 1}</div>
            <div className="task-flow-node-body">
              <div className="task-flow-node-topline">
                <strong>{eventTypeLabelMap[node.eventType] ?? renderWithNameChips(node.title)}</strong>
                <span>{formatTime(node.createdAt)}</span>
              </div>
              <h4>{renderWithNameChips(localizeBackendText(node.title))}</h4>
              {node.description && renderFlowDescription(node.description, localizeBackendText)}
              {(node.sourceType || node.electronicSignature) && (
                <div className="task-flow-node-meta">
                  {node.sourceType && <span>{sourceTypeLabel(node.sourceType)}</span>}
                  {node.electronicSignature && <span>签名：{node.electronicSignature}</span>}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PatientTaskSidePanel({
  patientId,
  patient,
  tasks,
  timeline,
  selectedTaskId,
  requestedMode,
  onSelectTask,
  onClose,
  onChanged,
  formatTime,
  localizeBackendText,
}: TaskPanelProps) {
  const openTasks = useMemo(() => tasks.filter((task) => isActionableTask(task, timeline)), [tasks, timeline]);
  const sortedTasks = useMemo(() => {
    return [...openTasks].sort((left, right) => {
      const leftDue = getTaskDueAt(left) ? new Date(getTaskDueAt(left)).getTime() : Number.MAX_SAFE_INTEGER;
      const rightDue = getTaskDueAt(right) ? new Date(getTaskDueAt(right)).getTime() : Number.MAX_SAFE_INTEGER;
      if (leftDue !== rightDue) return leftDue - rightDue;
      return new Date(right.time).getTime() - new Date(left.time).getTime();
    });
  }, [openTasks]);

  const selectedTask = useMemo(() => {
    return sortedTasks.find((task) => getTaskId(task) === selectedTaskId) ?? sortedTasks[0] ?? null;
  }, [selectedTaskId, sortedTasks]);

  const selectedTaskStableId = selectedTask ? getTaskId(selectedTask) : '';
  const selectedTaskRelatedAlertId = getTaskRelatedAlertId(selectedTask);
  const relatedAlert = useMemo(() => getRelatedAlertForTask(selectedTask, timeline), [selectedTask, timeline]);

  const selectedTaskStatus = getTaskStatus(selectedTask);
  const taskIsClosed = isClosedTask(selectedTask);
  const taskIsProcessing = selectedTaskStatus === 'IN_PROGRESS';
  const taskCanStart = selectedTaskStatus === 'PENDING';

  const [closeFormOpen, setCloseFormOpen] = useState(false);
  const [closeStatus, setCloseStatus] = useState<'DONE' | 'CANCELED'>('DONE');
  const [closeNote, setCloseNote] = useState('');
  const [closeSignature, setCloseSignature] = useState('');
  const [submittingMode, setSubmittingMode] = useState<PanelMode | 'START' | null>(null);
  const [processingEvents, setProcessingEvents] = useState<TaskProcessingEvent[]>([]);
  const [processingEventsLoading, setProcessingEventsLoading] = useState(false);

  const flowHasStarted = processingEvents.some((item) => item.eventType === 'START_PROCESSING') || taskIsProcessing;
  // 选中任务尚未开始：工作区只展示「相关预警 + 醒目开始按钮」，让护士清楚下一步该做什么。
  const showPreStartWorkspace = taskCanStart && !flowHasStarted && !taskIsClosed;

  async function loadProcessingEvents(opts?: { silent?: boolean }) {
    if (!selectedTaskStableId) return;
    if (!opts?.silent) setProcessingEventsLoading(true);
    try {
      const response = await api.get<TaskProcessingEvent[]>(`/tasks/${selectedTaskStableId}/processing-events`);
      setProcessingEvents(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      console.warn('Processing events failed to load', err);
      setProcessingEvents([]);
    } finally {
      if (!opts?.silent) setProcessingEventsLoading(false);
    }
  }

  useEffect(() => {
    // 带 ?mode=close 等参数进入时，自动展开任务总结表。
    if (normalizeMode(requestedMode)) setCloseFormOpen(true);
  }, [requestedMode]);

  useEffect(() => {
    function handleTaskProcessingEventsUpdated(event: Event) {
      const detail = (event as CustomEvent<{ taskId?: string }>).detail;
      if (detail?.taskId === selectedTaskStableId) void loadProcessingEvents();
    }

    window.addEventListener('task-processing-events-updated', handleTaskProcessingEventsUpdated);
    return () => window.removeEventListener('task-processing-events-updated', handleTaskProcessingEventsUpdated);
  }, [selectedTaskStableId]);

  useEffect(() => {
    if (!selectedTaskStableId) return;
    setProcessingEvents([]);
    void loadProcessingEvents();

    if (selectedTaskStatus === 'IN_PROGRESS' && selectedTask) {
      setActiveTaskProcessingSession({
        patientId,
        taskId: selectedTaskStableId,
        taskTitle: localizeBackendText(selectedTask.title),
        startedAt: new Date().toISOString(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, selectedTaskStableId]);

  // 选中任务的处理流程每 15 秒静默刷新，其它医护新增的处理节点会自动出现。
  usePolling(
    () => loadProcessingEvents({ silent: true }),
    15000,
    Boolean(selectedTaskStableId) && !taskIsClosed,
  );

  async function refreshPanelState() {
    await loadProcessingEvents();
    await onChanged();
  }

  function requireStarted() {
    if (taskIsProcessing || flowHasStarted) return true;
    showFeedbackError(
      '请先点击“开始处理”，系统才会把后续动作自动归入该任务流程。',
      '任务尚未开始',
    );
    return false;
  }

  async function startProcessing() {
    if (!selectedTask || !selectedTaskStableId || taskIsClosed || submittingMode) return;
    setSubmittingMode('START');

    try {
      await api.patch(
        `/tasks/${selectedTaskStableId}/start-processing`,
        {
          note: '医护已进入患者详情页开始处理，后续到院提醒、用药调整、复测计划、随访记录等操作将自动归入该任务流程。',
        },
        {
          headers: {
            'X-Suppress-Operation-Notice': '1',
            'X-Suppress-Task-Processing-Event': '1',
          },
        },
      );
      setActiveTaskProcessingSession({
        patientId,
        taskId: selectedTaskStableId,
        taskTitle: localizeBackendText(selectedTask.title),
        startedAt: new Date().toISOString(),
      });
      showFeedbackSuccess(
        '已开始处理。后续患者档案内保存的操作会自动进入该任务流程。',
        '任务已开始',
      );
      await refreshPanelState();
    } catch (err) {
      console.error(err);
      showFeedbackError(getApiErrorMessage(err, '开始处理失败，请稍后重试。'));
    } finally {
      setSubmittingMode(null);
    }
  }

  async function submitCloseTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTask || submittingMode || taskIsClosed || !requireStarted()) return;
    if (!closeNote.trim()) {
      showRequiredFieldMissing('请填写本次任务处理总结后再提交。', '处理总结未填写');
      return;
    }
    if (!closeSignature.trim()) {
      showRequiredFieldMissing('请填写电子签名后再提交处理完成。', '电子签名未填写');
      return;
    }

    setSubmittingMode('CLOSE');

    try {
      await api.patch(
        `/tasks/${selectedTaskStableId}/complete-processing`,
        {
          status: closeStatus,
          summary: closeNote.trim(),
          electronicSignature: closeSignature.trim(),
        },
        {
          headers: {
            'X-Suppress-Operation-Notice': '1',
            'X-Suppress-Task-Processing-Event': '1',
          },
        },
      );
      clearActiveTaskProcessingSession(patientId, selectedTaskStableId);
      showFeedbackSuccess(
        closeStatus === 'DONE'
          ? '任务已处理完成，并写入流程总结。'
          : '任务已取消/误报结案，并写入流程总结。',
        closeStatus === 'DONE' ? '处理完成' : '已结案',
      );
      await refreshPanelState();
    } catch (err) {
      console.error(err);
      showFeedbackError(getApiErrorMessage(err, '任务处理完成提交失败，请稍后重试。'));
    } finally {
      setSubmittingMode(null);
    }
  }

  if (!selectedTask) {
    return (
      <aside className="patient-task-side-panel empty" aria-label="患者任务处置面板">
        <header className="patient-task-panel-header">
          <div>
            <span>患者内处置</span>
            <h2>暂无待处理任务</h2>
          </div>
          <button className="ghost-button compact-link-btn" type="button" onClick={onClose}>收起</button>
        </header>
        <div className="empty-state compact-empty">当前患者没有待处理任务。已完成任务或已处理/已忽略预警不会再显示在处置面板中。</div>
      </aside>
    );
  }

  const renderRelatedAlertCard = (extraClassName = '') => relatedAlert ? (
    <div className={`task-panel-related-alert ${extraClassName}`.trim()}>
      <span className={getRiskClass(relatedAlert.data?.riskLevel)}>{riskLabelMap[relatedAlert.data?.riskLevel] ?? relatedAlert.data?.riskLevel}</span>
      <strong>{renderWithNameChips(localizeBackendText(relatedAlert.title))}</strong>
      <p>{renderWithNameChips(localizeBackendText(relatedAlert.description))}</p>
      {relatedAlert.data?.triggerRule && <small>触发规则：{renderWithNameChips(localizeBackendText(relatedAlert.data.triggerRule))}</small>}
    </div>
  ) : null;

  const renderPanelHeader = () => (
    <header className="patient-task-panel-header">
      <div>
        <span>患者内处理会话</span>
        <h2>统一任务处理中心</h2>
        <p>{patient.name} · {patient.hospitalPatientId ?? '院内号未录入'} · 电话 {patient.phone ?? '-'}</p>
      </div>
      <button className="ghost-button compact-link-btn" type="button" onClick={onClose}>收起</button>
    </header>
  );

  // 不再为「任务未开始」单独渲染只有「开始处理」按钮的精简视图——那会隐藏
  // 「选择任务」列表，护士在任务开始前无法切换/选择其它待办任务。现在统一走
  // 下方完整面板：始终展示任务选择列表 + 当前任务处理区。

  return (
    <aside className="patient-task-side-panel" aria-label="患者任务处置面板">
      {renderPanelHeader()}

      <section className="task-panel-section task-panel-queue-section">
        <div className="task-panel-section-title">
          <span>选择任务</span>
          <strong>{openTasks.length} 条待处理</strong>
        </div>
        <div className="task-panel-task-list">
          {sortedTasks.map((task) => {
            const taskId = getTaskId(task);
            const selected = taskId === selectedTaskStableId;
            const status = getTaskStatus(task);
            return (
              <button
                key={taskId || `${task.time}-${task.title}`}
                type="button"
                className={selected ? 'task-panel-task-card active' : 'task-panel-task-card'}
                onClick={() => onSelectTask(taskId, 'close')}
              >
                <span>{getTaskKindLabel(task, timeline)}</span>
                <strong>{renderWithNameChips(localizeBackendText(task.title))}</strong>
                <small>截止：{formatTime(getTaskDueAt(task))}</small>
                <em className={getStatusClass(status)}>{statusLabelMap[status] ?? status}</em>
              </button>
            );
          })}
        </div>
      </section>

      {/* 任务处理工作区：与上方“选择任务”区域明确分隔，承载当前任务的信息与操作。 */}
      <div className="task-panel-workspace">
        <div className="task-panel-workspace-label">
          <span className="task-panel-workspace-label-text">当前任务处理区</span>
        </div>

      {showPreStartWorkspace ? (
        <section className="task-panel-section task-panel-prestart-gate">
          {relatedAlert ? (
            renderRelatedAlertCard('prestart-related-alert')
          ) : (
            <div className="task-panel-current-task prestart-current-task">
              <h3>{renderWithNameChips(localizeBackendText(selectedTask.title))}</h3>
              <p>截止：{formatTime(getTaskDueAt(selectedTask))}</p>
            </div>
          )}
          <button
            className="button task-panel-start-primary-button"
            type="button"
            onClick={startProcessing}
            disabled={submittingMode === 'START'}
          >
            {submittingMode === 'START' ? '正在开始处理...' : '开始处理'}
          </button>
        </section>
      ) : (
        <>
      <section className="task-panel-section task-panel-summary-section">
        <div className="task-panel-current-task">
          <div className="task-panel-current-task-topline">
            <span className="badge">{getTaskKindLabel(selectedTask, timeline)}</span>
            <em className={getStatusClass(selectedTaskStatus)}>{statusLabelMap[selectedTaskStatus] ?? selectedTaskStatus}</em>
          </div>
          <h3>{renderWithNameChips(localizeBackendText(selectedTask.title))}</h3>
          <p>截止：{formatTime(getTaskDueAt(selectedTask))}</p>
          <div className="task-processing-session-actions">
            {taskCanStart && (
              <button className="button start-processing-button" type="button" onClick={startProcessing} disabled={submittingMode === 'START'}>
                {submittingMode === 'START' ? '开始中...' : '开始处理'}
              </button>
            )}
            {taskIsProcessing && (
              <div className="processing-session-active-chip">
                <strong>处理中</strong>
                <span>左侧患者档案内保存的操作将自动归入该任务流程</span>
              </div>
            )}
            {taskIsClosed && <div className="processing-session-closed-chip">该任务已结案，流程只读。</div>}
          </div>
        </div>
        {renderRelatedAlertCard()}
      </section>

      <section className="task-panel-section task-panel-processing-flow-section">
        <ProcessingFlowChart
          selectedTask={selectedTask}
          events={processingEvents}
          loading={processingEventsLoading}
          formatTime={formatTime}
          localizeBackendText={localizeBackendText}
        />
      </section>

      <section className="task-panel-section task-panel-mode-section">
        {/*
          “处理完成”是一个可展开/折叠的按钮：
          点击展开任务总结表，再次点击折叠。任务未开始或已结案时按钮禁用。
        */}
        <button
          type="button"
          className={`task-complete-toggle${closeFormOpen ? ' open' : ''}`}
          onClick={() => setCloseFormOpen((open) => !open)}
          disabled={!flowHasStarted || taskIsClosed}
          aria-expanded={closeFormOpen}
          aria-controls="task-complete-collapsible"
        >
          <span className="task-complete-toggle-label">
            <strong>{modeMeta.CLOSE.title}</strong>
            <em>
              {taskIsClosed
                ? '任务已结案，处理流程只读'
                : !flowHasStarted
                  ? '请先开始处理，再填写任务总结'
                  : closeFormOpen
                    ? '点击折叠任务总结表'
                    : '点击展开任务总结表'}
            </em>
          </span>
          <span className="task-complete-toggle-caret" aria-hidden="true">
            {closeFormOpen ? '收起 ▲' : '展开 ▼'}
          </span>
        </button>

        {taskIsClosed && (
          <div className="task-complete-locked-card completed">
            <strong>当前任务已经结案</strong>
            <p>该任务的处理流程只读展示，不能重复提交处理完成。</p>
          </div>
        )}

        {closeFormOpen && flowHasStarted && !taskIsClosed && (
          <div className="task-panel-mode-body" id="task-complete-collapsible">
            <div className="task-panel-mode-hint">
              <strong>{modeMeta.CLOSE.title}</strong>
              <p>{modeMeta.CLOSE.hint}</p>
            </div>

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
                <div className="task-complete-check relation-sync-check">
                  该任务已关联临床风险。结案后，系统会自动同步关闭关联预警和仍有效的到院提醒。
                </div>
              )}
              <div className="form-row">
                <label>电子签名</label>
                <input value={closeSignature} onChange={(event) => setCloseSignature(event.target.value)} placeholder="请输入护士姓名 / 工号" disabled={submittingMode === 'CLOSE'} />
              </div>
              <div className="form-actions sticky-form-actions pro-form-actions">
                <button className="button" type="submit" disabled={submittingMode === 'CLOSE'}>{submittingMode === 'CLOSE' ? '提交中...' : '确认处理完成'}</button>
              </div>
            </form>
          </div>
        )}
      </section>
        </>
      )}
      </div>
    </aside>
  );
}
