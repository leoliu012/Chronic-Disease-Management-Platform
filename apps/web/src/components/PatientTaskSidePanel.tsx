import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { api, getApiErrorMessage } from '../api/client';
import {
  clearActiveTaskProcessingSession,
  setActiveTaskProcessingSession,
} from '../utils/taskProcessingContext';

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

const taskTypeLabelMap: Record<string, string> = {
  FOLLOW_UP: '随访任务',
  RISK_ALERT_FOLLOW_UP: '风险预警处理',
  RECHECK_REMINDER: '复查提醒',
  MEDICATION_REMINDER: '用药提醒',
  MEDICATION_ADHERENCE_FOLLOW_UP: '用药依从性随访',
  VITAL_MEASUREMENT_MISSED: '指标漏测复核',
  QUESTIONNAIRE_REVIEW: '问卷复核',
  LAB_TEST_REMINDER: '检查提醒',
  HOSPITAL_VISIT_FOLLOW_UP: '到院提醒任务',
};

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

function getTaskType(task?: TimelineEvent | null) {
  return String(task?.data?.type ?? '');
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

// isActionableTask-orphan-fix-v1: a PENDING/IN_PROGRESS task is always actionable, even
// if its related alert has already been resolved/dismissed. Hiding such
// tasks was the root cause of the "sidebar 空 but 全部记录 still shows
// 待办任务" inconsistency reported by clinical users.
function isActionableTask(task: TimelineEvent, _timeline: TimelineEvent[]) {
  return isOpenTask(task);
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

  if (!parsed) return <p>{localized}</p>;

  return (
    <div className="task-flow-node-description">
      <p className="task-flow-node-summary">
        <strong>{parsed.summary}</strong>
      </p>
      <dl className="task-flow-node-detail-list">
        {parsed.rows.map((row) => (
          <div key={row.id} className="task-flow-node-detail-row">
            {row.raw ? (
              <dd className="task-flow-node-detail-value task-flow-node-detail-raw">{row.raw}</dd>
            ) : (
              <>
                <dt className="task-flow-node-detail-label">{row.label}</dt>
                <dd className="task-flow-node-detail-value">
                  {row.before !== undefined && row.after !== undefined ? (
                    <span className="task-flow-node-change">
                      <span className="task-flow-node-before">{row.before || '未填写'}</span>
                      <span className="task-flow-node-arrow">→</span>
                      <strong className="task-flow-node-after">{row.after || '未填写'}</strong>
                    </span>
                  ) : (
                    <strong>{row.value}</strong>
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
                <strong>{eventTypeLabelMap[node.eventType] ?? node.title}</strong>
                <span>{formatTime(node.createdAt)}</span>
              </div>
              <h4>{localizeBackendText(node.title)}</h4>
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

  const [activeMode, setActiveMode] = useState<PanelMode>('CLOSE');
  const [closeStatus, setCloseStatus] = useState<'DONE' | 'CANCELED'>('DONE');
  const [closeNote, setCloseNote] = useState('');
  const [syncRelatedAlert, setSyncRelatedAlert] = useState(true);
  const [closeSignature, setCloseSignature] = useState('');
  const [submittingMode, setSubmittingMode] = useState<PanelMode | 'START' | null>(null);
  const [panelMessage, setPanelMessage] = useState('');
  const [panelError, setPanelError] = useState('');
  const [processingEvents, setProcessingEvents] = useState<TaskProcessingEvent[]>([]);
  const [processingEventsLoading, setProcessingEventsLoading] = useState(false);

  const availableModes = useMemo<PanelMode[]>(() => ['CLOSE'], []);

  const flowHasStarted = processingEvents.some((item) => item.eventType === 'START_PROCESSING') || taskIsProcessing;
  const shouldShowPreStartOnly = taskCanStart && !flowHasStarted && !taskIsClosed;

  async function loadProcessingEvents() {
    if (!selectedTaskStableId) return;
    setProcessingEventsLoading(true);
    try {
      const response = await api.get<TaskProcessingEvent[]>(`/tasks/${selectedTaskStableId}/processing-events`);
      setProcessingEvents(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      console.warn('Processing events failed to load', err);
      setProcessingEvents([]);
    } finally {
      setProcessingEventsLoading(false);
    }
  }

  useEffect(() => {
    const requested = normalizeMode(requestedMode);
    if (requested && availableModes.includes(requested)) setActiveMode(requested);
  }, [availableModes, requestedMode]);

  useEffect(() => {
    function handleTaskProcessingEventsUpdated(event: Event) {
      const detail = (event as CustomEvent<{ taskId?: string }>).detail;
      if (detail?.taskId === selectedTaskStableId) void loadProcessingEvents();
    }

    window.addEventListener('task-processing-events-updated', handleTaskProcessingEventsUpdated);
    return () => window.removeEventListener('task-processing-events-updated', handleTaskProcessingEventsUpdated);
  }, [selectedTaskStableId]);

  useEffect(() => {
    if (!selectedTask) return;
    setPanelMessage('');
    setPanelError('');
    setProcessingEvents([]);
    void loadProcessingEvents();

    if (getTaskStatus(selectedTask) === 'IN_PROGRESS') {
      setActiveTaskProcessingSession({
        patientId,
        taskId: getTaskId(selectedTask),
        taskTitle: localizeBackendText(selectedTask.title),
        startedAt: new Date().toISOString(),
      });
    }
  }, [patientId, localizeBackendText, relatedAlert, selectedTask, selectedTaskRelatedAlertId, selectedTaskStableId]);

  async function refreshPanelState() {
    await loadProcessingEvents();
    await onChanged();
  }

  function requireStarted() {
    if (taskIsProcessing || flowHasStarted) return true;
    setPanelError('请先点击“开始处理”，系统才会把后续动作自动归入该任务流程。');
    return false;
  }

  async function recordProcessingEvent(event: Omit<TaskProcessingEvent, 'id' | 'taskId' | 'patientId' | 'createdAt'>) {
    if (!selectedTaskStableId) return;
    await api.post(
      `/tasks/${selectedTaskStableId}/processing-events`,
      event,
      {
        headers: {
          'X-Suppress-Operation-Notice': '1',
          'X-Suppress-Task-Processing-Event': '1',
        },
      },
    );
  }

  async function startProcessing() {
    if (!selectedTask || !selectedTaskStableId || taskIsClosed || submittingMode) return;
    setSubmittingMode('START');
    setPanelError('');
    setPanelMessage('');

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
      setPanelMessage('已开始处理。后续患者档案内保存的操作会自动进入该任务流程。');
      await refreshPanelState();
    } catch (err) {
      console.error(err);
      setPanelError(getApiErrorMessage(err, '开始处理失败，请稍后重试。'));
    } finally {
      setSubmittingMode(null);
    }
  }

  async function submitCloseTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTask || submittingMode || taskIsClosed || !requireStarted()) return;
    if (!closeNote.trim()) {
      setPanelError('请填写本次任务处理总结。');
      return;
    }
    if (!closeSignature.trim()) {
      setPanelError('请填写电子签名后再提交处理完成。');
      return;
    }

    setSubmittingMode('CLOSE');
    setPanelError('');
    setPanelMessage('');

    try {
      await api.patch(
        `/tasks/${selectedTaskStableId}/complete-processing`,
        {
          status: closeStatus,
          summary: closeNote.trim(),
          electronicSignature: closeSignature.trim(),
          syncRelatedAlert: syncRelatedAlert && Boolean(selectedTaskRelatedAlertId),
        },
        {
          headers: {
            'X-Suppress-Operation-Notice': '1',
            'X-Suppress-Task-Processing-Event': '1',
          },
        },
      );
      clearActiveTaskProcessingSession(patientId, selectedTaskStableId);
      setPanelMessage(closeStatus === 'DONE' ? '任务已处理完成，并写入流程总结。' : '任务已取消/误报结案，并写入流程总结。');
      await refreshPanelState();
    } catch (err) {
      console.error(err);
      setPanelError(getApiErrorMessage(err, '任务处理完成提交失败，请稍后重试。'));
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
      <strong>{localizeBackendText(relatedAlert.title)}</strong>
      <p>{localizeBackendText(relatedAlert.description)}</p>
      {relatedAlert.data?.triggerRule && <small>触发规则：{localizeBackendText(relatedAlert.data.triggerRule)}</small>}
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

  const renderPanelNotices = () => (
    <>
      {panelMessage && <div className="notice-success task-panel-notice" role="status">{panelMessage}</div>}
      {panelError && <div className="notice-error task-panel-notice" role="alert">{panelError}</div>}
    </>
  );

  if (shouldShowPreStartOnly) {
    // prestart-task-list-v1: before the task is started, show task selection + related risk alert + start button only.
    return (
      <aside className="patient-task-side-panel" aria-label="患者任务处置面板">
        {renderPanelHeader()}
        {renderPanelNotices()}

        <section className="task-panel-section task-panel-queue-section task-panel-prestart-task-list">
          <div className="task-panel-section-title task-panel-prestart-task-list-title">
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
                  <span>{taskTypeLabelMap[getTaskType(task)] ?? getTaskType(task)}</span>
                  <strong>{localizeBackendText(task.title)}</strong>
                  <small>截止：{formatTime(getTaskDueAt(task))}</small>
                  <em className={getStatusClass(status)}>{statusLabelMap[status] ?? status}</em>
                </button>
              );
            })}
          </div>
        </section>

        <section className="task-panel-section task-panel-prestart-gate">
          {relatedAlert ? (
            renderRelatedAlertCard('prestart-related-alert')
          ) : (
            <div className="task-panel-current-task prestart-current-task">
              <div className="task-panel-current-task-topline">
                <span className="badge">{taskTypeLabelMap[getTaskType(selectedTask)] ?? getTaskType(selectedTask)}</span>
                <em className={getStatusClass(selectedTaskStatus)}>{statusLabelMap[selectedTaskStatus] ?? selectedTaskStatus}</em>
              </div>
              <h3>{localizeBackendText(selectedTask.title)}</h3>
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
      </aside>
    );
  }

  return (
    <aside className="patient-task-side-panel" aria-label="患者任务处置面板">
      {renderPanelHeader()}
      {renderPanelNotices()}

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
                <span>{taskTypeLabelMap[getTaskType(task)] ?? getTaskType(task)}</span>
                <strong>{localizeBackendText(task.title)}</strong>
                <small>截止：{formatTime(getTaskDueAt(task))}</small>
                <em className={getStatusClass(status)}>{statusLabelMap[status] ?? status}</em>
              </button>
            );
          })}
        </div>
      </section>

      <section className="task-panel-section task-panel-summary-section">
        <div className="task-panel-current-task">
          <div className="task-panel-current-task-topline">
            <span className="badge">{taskTypeLabelMap[getTaskType(selectedTask)] ?? getTaskType(selectedTask)}</span>
            <em className={getStatusClass(selectedTaskStatus)}>{statusLabelMap[selectedTaskStatus] ?? selectedTaskStatus}</em>
          </div>
          <h3>{localizeBackendText(selectedTask.title)}</h3>
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

      {!flowHasStarted && !taskIsClosed && (
        <section className="task-panel-section task-start-guidance-card">
          <strong>先开始，再处理</strong>
          <p>点击“开始处理”后，系统会把该任务切换为“处理中”。之后在患者档案内新增用药、修改复测计划、保存随访记录、发送到院提醒等动作，都会自动进入上方流程图。</p>
        </section>
      )}


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
    </aside>
  );
}




