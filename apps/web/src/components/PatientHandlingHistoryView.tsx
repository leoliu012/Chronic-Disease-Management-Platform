import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';

/**
 * 处置记录 (handling history) view.
 *
 * Lists past task-processing records for one patient, embedding the same
 * "动态处理流程" chart shown in PatientTaskSidePanel. Supports:
 *   - Time-range filter (start/end date, inclusive).
 *   - Lazy loading: tasks are fetched in one shot but only `pageSize` rows are
 *     rendered until the nurse clicks "加载更多". Each task's processing
 *     events are loaded on-demand the first time the task card is expanded.
 *
 * Backend contract used (already exists):
 *   GET /patients/:patientId/tasks          (returns full task list)
 *   GET /tasks/:id/processing-events        (returns ordered TaskProcessingEvent[])
 */

type Patient = {
  id: string;
  hospitalPatientId?: string;
  name: string;
};

type Task = {
  id: string;
  patientId: string;
  title: string;
  type: string;
  status: string;
  dueAt?: string | null;
  createdAt: string;
  relatedAlertId?: string | null;
  assigneeId?: string | null;
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

type Props = {
  patientId: string;
  patient: Patient;
  formatTime: (value?: string) => string;
  localizeBackendText: (value?: string | null) => string;
  /**
   * When provided (e.g. navigated from the nurse workbench "查看处置记录"
   * action), the matching task card is forced into the visible window,
   * auto-expanded, and scrolled into view.
   */
  focusTaskId?: string;
};

const TASK_TYPE_LABEL: Record<string, string> = {
  FOLLOW_UP: '随访任务',
  RISK_ALERT_FOLLOW_UP: '风险预警处理',
  RECHECK_REMINDER: '复查提醒',
  MEDICATION_REMINDER: '用药提醒',
  MEDICATION_ADHERENCE_FOLLOW_UP: '用药依从性随访',
  VITAL_MEASUREMENT_MISSED: '指标漏测复核',
  QUESTIONNAIRE_REVIEW: '问卷复核',
  LAB_TEST_REMINDER: '检查提醒',
  HOSPITAL_VISIT_FOLLOW_UP: '到院提醒任务',
  PHONE_FOLLOW_UP_SCHEDULED: '电话随访（计划提醒）',
};

const TASK_STATUS_LABEL: Record<string, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '处理中',
  DONE: '已完成',
  CANCELED: '已取消',
};

const EVENT_TYPE_LABEL: Record<string, string> = {
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

const SOURCE_TYPE_LABEL: Record<string, string> = {
  FRONTEND_AUTO_ASSOCIATION: '患者档案自动关联',
  HOSPITAL_VISIT_REMINDER: '到院提醒',
  TASK_PROCESSING: '任务处理',
};

const STATUS_CLASS: Record<string, string> = {
  PENDING: 'status-badge status-pending',
  IN_PROGRESS: 'status-badge status-in-progress',
  DONE: 'status-badge status-done',
  CANCELED: 'status-badge status-canceled',
};

const DEFAULT_PAGE_SIZE = 5;

function eventClass(eventType: string) {
  return `task-flow-node-${String(eventType || 'other').toLowerCase().replace(/_/g, '-')}`;
}

type ParsedDescriptionRow = {
  id: string;
  label?: string;
  value?: string;
  before?: string;
  after?: string;
  raw?: string;
};

function parseStructuredDescription(description?: string | null) {
  const text = String(description ?? '').replace(/[。；;\s]+$/g, '').trim();
  if (!text) return null;
  const firstColon = text.indexOf('：');
  if (firstColon < 0) return null;
  const summary = text.slice(0, firstColon).trim();
  const detailsText = text.slice(firstColon + 1).trim();
  if (!summary || !detailsText) return null;

  const rows: ParsedDescriptionRow[] = detailsText
    .split('；')
    .map((p) => p.replace(/[。；;\s]+$/g, '').trim())
    .filter(Boolean)
    .map((part, index) => {
      const ci = part.indexOf('：');
      if (ci < 0) return { id: `${index}-${part}`, raw: part };
      const label = part.slice(0, ci).trim();
      const value = part.slice(ci + 1).trim();
      const arrowIdx = value.indexOf(' → ');
      if (arrowIdx >= 0) {
        return {
          id: `${index}-${label}`,
          label,
          before: value.slice(0, arrowIdx).trim(),
          after: value.slice(arrowIdx + 3).trim(),
        };
      }
      return { id: `${index}-${label}`, label, value };
    });
  if (rows.length === 0) return null;
  return { summary, rows };
}

function renderFlowDescription(description: string, localizeBackendText: (v?: string | null) => string) {
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

function FlowChart({
  events,
  loading,
  formatTime,
  localizeBackendText,
}: {
  events: TaskProcessingEvent[];
  loading: boolean;
  formatTime: (v?: string) => string;
  localizeBackendText: (v?: string | null) => string;
}) {
  const nodes = useMemo(
    () =>
      [...events]
        .filter((node) => node.eventType !== 'TASK_CREATED')
        .sort((l, r) => new Date(l.createdAt).getTime() - new Date(r.createdAt).getTime()),
    [events],
  );

  if (loading) {
    return <div className="handling-history-flow-loading">正在加载处理流程...</div>;
  }
  if (nodes.length === 0) {
    return <div className="handling-history-flow-empty">该任务暂无处置流程节点。</div>;
  }
  return (
    <div className="task-processing-flow-card handling-history-flow-card">
      <div className="task-processing-flow-header">
        <div>
          <span>动态处理流程</span>
          <strong>{nodes.length} 个节点</strong>
        </div>
      </div>
      <ol className="task-processing-flow-rail">
        {nodes.map((node, index) => (
          <li key={node.id} className={eventClass(node.eventType)}>
            <div className="task-flow-node-index">{index + 1}</div>
            <div className="task-flow-node-body">
              <div className="task-flow-node-topline">
                <strong>{EVENT_TYPE_LABEL[node.eventType] ?? node.title}</strong>
                <span>{formatTime(node.createdAt)}</span>
              </div>
              <h4>{localizeBackendText(node.title)}</h4>
              {node.description && renderFlowDescription(node.description, localizeBackendText)}
              {(node.sourceType || node.electronicSignature) && (
                <div className="task-flow-node-meta">
                  {node.sourceType && <span>{SOURCE_TYPE_LABEL[node.sourceType] ?? node.sourceType}</span>}
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

export function PatientHandlingHistoryView({
  patientId,
  patient,
  formatTime,
  localizeBackendText,
  focusTaskId,
}: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState('');

  // Time filter mirrors the "历史电话沟通记录" filter: a simple start/end date
  // range with 查询 / 重置, no quick presets. Empty range = show all records.
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const focusedCardRef = useRef<HTMLElement | null>(null);
  const focusHandledRef = useRef<string | null>(null);

  const [visibleCount, setVisibleCount] = useState(DEFAULT_PAGE_SIZE);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [eventsByTaskId, setEventsByTaskId] = useState<Record<string, TaskProcessingEvent[]>>({});
  const [eventsLoadingByTaskId, setEventsLoadingByTaskId] = useState<Record<string, boolean>>({});

  async function loadTasks() {
    if (!patientId) return;
    setTasksLoading(true);
    setTasksError('');
    try {
      const response = await api.get<Task[]>(`/patients/${patientId}/tasks`);
      const list = Array.isArray(response.data) ? response.data : [];
      setTasks(list);
    } catch (err) {
      console.warn('Failed to load tasks for handling history.', err);
      setTasksError('处置记录加载失败，请稍后重试。');
    } finally {
      setTasksLoading(false);
    }
  }

  useEffect(() => {
    void loadTasks();
    setExpandedTaskIds(new Set());
    setEventsByTaskId({});
    setEventsLoadingByTaskId({});
    setVisibleCount(DEFAULT_PAGE_SIZE);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  // Filter tasks by the user-selected time range. We use task.createdAt as the
  // canonical timestamp; this matches "when the task was created and started
  // the closed loop". An inclusive end-of-day boundary is applied to endDate.
  const filteredTasks = useMemo(() => {
    const startMs = startDate ? new Date(startDate).getTime() : Number.NEGATIVE_INFINITY;
    const endMs = endDate
      ? new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1
      : Number.POSITIVE_INFINITY;
    return tasks
      .filter((task) => {
        const created = new Date(task.createdAt).getTime();
        if (!Number.isFinite(created)) return false;
        return created >= startMs && created <= endMs;
      })
      .sort((l, r) => new Date(r.createdAt).getTime() - new Date(l.createdAt).getTime());
  }, [tasks, startDate, endDate]);

  // When the user changes the time range, snap visibleCount back to the page
  // size so the list re-paginates from the top.
  useEffect(() => {
    setVisibleCount(DEFAULT_PAGE_SIZE);
  }, [startDate, endDate]);

  const visibleTasks = useMemo(() => filteredTasks.slice(0, visibleCount), [filteredTasks, visibleCount]);
  const hasMore = filteredTasks.length > visibleCount;

  async function loadEventsForTask(taskId: string) {
    if (eventsByTaskId[taskId] || eventsLoadingByTaskId[taskId]) return;
    setEventsLoadingByTaskId((prev) => ({ ...prev, [taskId]: true }));
    try {
      const response = await api.get<TaskProcessingEvent[]>(`/tasks/${taskId}/processing-events`);
      setEventsByTaskId((prev) => ({ ...prev, [taskId]: Array.isArray(response.data) ? response.data : [] }));
    } catch (err) {
      console.warn(`Failed to load processing events for task ${taskId}`, err);
      setEventsByTaskId((prev) => ({ ...prev, [taskId]: [] }));
    } finally {
      setEventsLoadingByTaskId((prev) => ({ ...prev, [taskId]: false }));
    }
  }

  function toggleExpanded(taskId: string) {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
        void loadEventsForTask(taskId);
      }
      return next;
    });
  }

  function expandAll() {
    const ids = new Set(visibleTasks.map((task) => task.id));
    setExpandedTaskIds(ids);
    visibleTasks.forEach((task) => {
      if (!eventsByTaskId[task.id]) {
        void loadEventsForTask(task.id);
      }
    });
  }

  function collapseAll() {
    setExpandedTaskIds(new Set());
  }

  function resetRange() {
    setStartDate('');
    setEndDate('');
  }

  // When arriving with a focusTaskId (e.g. from the nurse workbench), make sure
  // the target task is within the rendered window, auto-expand it, and scroll
  // it into view once. Guarded by focusHandledRef so manual collapse afterwards
  // is respected.
  useEffect(() => {
    if (!focusTaskId) return;
    if (focusHandledRef.current === focusTaskId) return;
    const index = filteredTasks.findIndex((task) => task.id === focusTaskId);
    if (index < 0) return; // not loaded yet (or filtered out) — wait for tasks to load

    focusHandledRef.current = focusTaskId;
    if (index >= visibleCount) {
      setVisibleCount(index + 1);
    }
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      next.add(focusTaskId);
      return next;
    });
    void loadEventsForTask(focusTaskId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTaskId, filteredTasks]);

  useEffect(() => {
    if (!focusTaskId || focusHandledRef.current !== focusTaskId) return;
    const node = focusedCardRef.current;
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusTaskId, visibleCount, expandedTaskIds]);

  return (
    <section className="panel patient-handling-history-panel collapsible-workspace-panel handling-history-v2-panel">
      <div className="hospital-section-header handling-history-v2-header">
        <div>
          <span>处置记录</span>
          <h2>过去处置记录</h2>
        </div>
        <div className="handling-history-v2-actions">
          <button
            type="button"
            className="secondary-button compact-link-btn"
            onClick={() => loadTasks()}
            disabled={tasksLoading}
          >
            {tasksLoading ? '加载中…' : '刷新'}
          </button>
          {visibleTasks.length > 0 && (
            expandedTaskIds.size === visibleTasks.length ? (
              <button type="button" className="secondary-button compact-link-btn" onClick={collapseAll}>
                收起全部
              </button>
            ) : (
              <button type="button" className="secondary-button compact-link-btn" onClick={expandAll}>
                展开全部
              </button>
            )
          )}
        </div>
      </div>

      <form
        className="follow-up-history-filter"
        aria-label="按时间筛选处置记录"
        onSubmit={(event) => {
          event.preventDefault();
          setVisibleCount(DEFAULT_PAGE_SIZE);
        }}
      >
        <label>
          <span>创建时间从</span>
          <input
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label>
          <span>创建时间至</span>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
        <div className="follow-up-filter-actions">
          <button className="secondary-button" type="submit" disabled={tasksLoading}>查询</button>
          <button
            className="secondary-button subtle"
            type="button"
            disabled={tasksLoading}
            onClick={resetRange}
          >
            重置
          </button>
        </div>
      </form>

      <div className="handling-history-v2-filter-meta">
        {patient.name} · 共匹配 {filteredTasks.length} 条 · 已展示 {visibleTasks.length}
      </div>

      {tasksError && (
        <div className="notice-error handling-history-v2-error" role="alert">
          {tasksError}
        </div>
      )}

      {tasksLoading && tasks.length === 0 ? (
        <div className="loading-state handling-history-v2-loading">正在加载处置记录...</div>
      ) : filteredTasks.length === 0 ? (
        <div className="empty-state handling-history-v2-empty">
          {tasks.length === 0
            ? '当前患者暂无任务处置记录。'
            : '所选时间范围内没有处置记录，请调整时间范围。'}
        </div>
      ) : (
        <div className="handling-history-v2-list">
          {visibleTasks.map((task) => {
            const isExpanded = expandedTaskIds.has(task.id);
            const events = eventsByTaskId[task.id] ?? [];
            const isEventsLoading = Boolean(eventsLoadingByTaskId[task.id]);
            const statusClass = STATUS_CLASS[task.status] ?? 'status-badge';
            const isFocused = Boolean(focusTaskId) && task.id === focusTaskId;
            return (
              <article
                key={task.id}
                ref={isFocused ? focusedCardRef : undefined}
                className={
                  `handling-history-v2-card${isExpanded ? ' is-expanded' : ''}${isFocused ? ' is-focused' : ''}`
                }
              >
                <header
                  className="handling-history-v2-card-header"
                  onClick={() => toggleExpanded(task.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleExpanded(task.id);
                    }
                  }}
                >
                  <div className="handling-history-v2-card-topline">
                    <span className="badge">{TASK_TYPE_LABEL[task.type] ?? task.type}</span>
                    <em className={statusClass}>{TASK_STATUS_LABEL[task.status] ?? task.status}</em>
                    {task.relatedAlertId && (
                      <span className="handling-history-v2-card-pill">已关联风险预警</span>
                    )}
                  </div>
                  <h3>{localizeBackendText(task.title)}</h3>
                  <div className="handling-history-v2-card-meta">
                    <span>创建：{formatTime(task.createdAt)}</span>
                    <span>截止：{formatTime(task.dueAt ?? undefined)}</span>
                    <span aria-hidden className="handling-history-v2-toggle-icon">
                      {isExpanded ? '−' : '+'}
                    </span>
                  </div>
                </header>
                {isExpanded && (
                  <div className="handling-history-v2-card-body">
                    <FlowChart
                      events={events}
                      loading={isEventsLoading}
                      formatTime={formatTime}
                      localizeBackendText={localizeBackendText}
                    />
                  </div>
                )}
              </article>
            );
          })}
          {hasMore && (
            <div className="handling-history-v2-load-more">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setVisibleCount((current) => current + DEFAULT_PAGE_SIZE)}
              >
                加载更多（还有 {filteredTasks.length - visibleCount} 条）
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
