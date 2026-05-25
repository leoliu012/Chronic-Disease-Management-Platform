import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, getApiErrorMessage } from '../api/client';
import { usePolling } from '../hooks/usePolling';

type Patient = {
  id: string;
  name: string;
  hospitalPatientId?: string;
  phone?: string;
  responsibleDoctorId?: string;
  responsibleNurseId?: string;
};

type VitalRecord = {
  id: string;
  type: string;
  value: number;
  unit: string;
  measuredAt: string;
  note?: string;
  patient: Patient;
};

type Task = {
  id: string;
  title: string;
  type: string;
  status: string;
  dueAt?: string;
  patient?: Patient;
};

type NurseDashboard = {
  nurseId: string;
  summary: {
    patientCount: number;
    pendingTaskCount: number;
    todayTaskCount: number;
    overdueTaskCount: number;
    openRiskAlertCount: number;
    recentAbnormalVitalCount: number;
    completedTaskCount: number;
  };
  myPatients: Patient[];
  recentAbnormalVitals: VitalRecord[];
  completedTasks?: Task[];
};

type WorkItem = {
  id: string;
  itemType: 'FOLLOW_UP_TASK' | 'RISK_FOLLOW_UP_TASK' | 'RISK_ALERT_ONLY' | 'HOSPITAL_VISIT_TASK';
  sourceType: 'TASK' | 'RISK_ALERT';
  taskId?: string;
  alertId?: string;
  title: string;
  description?: string;
  status: string;
  riskLevel?: string;
  dueAt?: string;
  createdAt: string;
  patient?: Patient;
  triggerRule?: string;
  actionUrl: string;
  actionText: string;
};

type CreatedTask = {
  id: string;
};

type HospitalVisitReminder = {
  id: string;
  patientId: string;
  reason: string;
  remindedAt: string;
  relatedTaskId?: string | null;
  patient?: Patient;
};

type WorkItemsResponse = {
  summary: {
    totalOpen: number;
    regularTaskCount: number;
    riskTaskCount: number;
    alertOnlyCount: number;
    overdueCount: number;
  };
  items: WorkItem[];
};

type WorkbenchSectionKey = 'workItems' | 'vitals' | 'patients' | 'completed';
type WorkItemFilter = 'ALL' | 'RISK' | 'TASK' | 'OVERDUE';

type SummaryItem = {
  label: string;
  value: number;
  section: WorkbenchSectionKey;
  filter?: WorkItemFilter;
  description: string;
  tone: 'primary' | 'warning' | 'danger' | 'success' | 'neutral';
};

const nurseId = 'nurse-001';

const itemTypeLabelMap: Record<string, string> = {
  FOLLOW_UP_TASK: '随访任务',
  RISK_FOLLOW_UP_TASK: '风险随访任务',
  HOSPITAL_VISIT_TASK: '到院提醒任务',
  RISK_ALERT_ONLY: '风险预警',
};

const riskLabelMap: Record<string, string> = {
  LOW: '低危',
  MEDIUM: '中危',
  HIGH: '高危',
  VERY_HIGH: '极高危',
};

const vitalTypeLabelMap: Record<string, string> = {
  BLOOD_PRESSURE: '血压',
  SYSTOLIC_BP: '血压（收缩压）',
  DIASTOLIC_BP: '血压（舒张压）',
  BLOOD_GLUCOSE: '血糖',
  WEIGHT: '体重',
  HEART_RATE: '心率',
  SPO2: '血氧',
  LDL_C: '低密度脂蛋白胆固醇',
};

const statusLabelMap: Record<string, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '待处理',
  DONE: '已完成',
  CANCELED: '已取消',
  OPEN: '未处理',
  RESOLVED: '已处理',
  DISMISSED: '已忽略',
};

const workbenchSections: Array<{
  key: WorkbenchSectionKey;
  title: string;
  description: string;
}> = [
  { key: 'workItems', title: '待处理事项', description: '任务、预警、风险随访合并处理' },
  { key: 'vitals', title: '异常指标', description: '患者上传或院内同步异常值' },
  { key: 'patients', title: '我的患者', description: '责任患者清单' },
  { key: 'completed', title: '完成记录', description: '最近完成的随访与任务' },
];

function formatTime(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function getStatusClass(status: string) {
  const normalized = status === 'IN_PROGRESS' ? 'pending' : status.toLowerCase().replace(/_/g, '-');
  return `status-badge status-${normalized}`;
}

function getRiskClass(riskLevel?: string) {
  return `risk-badge risk-${String(riskLevel || '').toLowerCase().replace(/_/g, '-')}`;
}

function isOverdue(item: WorkItem) {
  return Boolean(item.dueAt && new Date(item.dueAt).getTime() < Date.now());
}

function PatientLink({ patient }: { patient?: Patient }) {
  if (!patient) return <span className="muted">-</span>;
  return <Link to={`/patients/${patient.id}`}>{patient.name}</Link>;
}

function WorkItemsTable({
  items,
  busyItemId,
  onStartAlertFollowUp,
}: {
  items: WorkItem[];
  busyItemId: string;
  onStartAlertFollowUp: (item: WorkItem) => void;
}) {
  if (items.length === 0) {
    return <div className="empty-state compact-empty">当前没有待处理事项</div>;
  }

  return (
    <div className="unified-work-item-list">
      {items.map((item) => (
        <article
          key={item.id}
          className={`unified-work-item-card ${item.itemType === 'RISK_ALERT_ONLY' ? 'alert-only' : ''} ${item.itemType === 'RISK_FOLLOW_UP_TASK' ? 'risk-task' : ''}`}
        >
          <div className="unified-work-item-topline">
            <span className="badge">{itemTypeLabelMap[item.itemType] ?? item.itemType}</span>
            <span className={getStatusClass(item.status)}>{statusLabelMap[item.status] ?? item.status}</span>
            {item.riskLevel && <span className={getRiskClass(item.riskLevel)}>{riskLabelMap[item.riskLevel] ?? item.riskLevel}</span>}
            {isOverdue(item) && <span className="work-item-overdue-pill">已逾期</span>}
          </div>

          <div className="unified-work-item-body">
            <div>
              <h3>{item.title}</h3>
              <p>{item.description || item.triggerRule || '暂无补充说明'}</p>
              {item.triggerRule && <p className="muted small">触发依据：{item.triggerRule}</p>}
            </div>
            <dl className="work-item-meta-grid">
              <div><dt>患者</dt><dd><PatientLink patient={item.patient} /></dd></div>
              <div><dt>院内号</dt><dd>{item.patient?.hospitalPatientId ?? '-'}</dd></div>
              <div><dt>截止时间</dt><dd>{formatTime(item.dueAt)}</dd></div>
              <div><dt>来源</dt><dd>{item.sourceType === 'TASK' ? '待办任务' : '风险预警'}</dd></div>
            </dl>
          </div>

          <div className="unified-work-item-actions">
            {item.itemType === 'RISK_ALERT_ONLY' ? (
              <button
                className="primary-btn nurse-primary-detail-link"
                type="button"
                disabled={busyItemId === item.id}
                onClick={() => onStartAlertFollowUp(item)}
              >
                {busyItemId === item.id ? '正在生成随访任务...' : item.actionText}
              </button>
            ) : (
              <Link className="primary-btn nurse-primary-detail-link" to={item.actionUrl}>
                {item.actionText}
              </Link>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function VitalsTable({ records }: { records: VitalRecord[] }) {
  if (records.length === 0) return <div className="empty-state compact-empty">暂无异常指标</div>;

  return (
    <div className="table-wrap clean-table-wrap">
      <table className="table clean-hospital-table">
        <thead>
          <tr><th>患者</th><th>指标</th><th>数值</th><th>时间</th><th>备注</th><th>操作</th></tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td><PatientLink patient={record.patient} /></td>
              <td>{vitalTypeLabelMap[record.type] ?? record.type}</td>
              <td><strong>{record.value} {record.unit}</strong></td>
              <td>{formatTime(record.measuredAt)}</td>
              <td>{record.note ?? '-'}</td>
              <td><Link className="secondary-btn compact-link-btn" to={`/patients/${record.patient.id}?workspace=monitoring&vitalId=${record.id}`}>查看指标</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PatientsTable({ patients }: { patients: Patient[] }) {
  if (patients.length === 0) return <div className="empty-state compact-empty">暂无负责患者</div>;

  return (
    <div className="table-wrap clean-table-wrap">
      <table className="table clean-hospital-table">
        <thead>
          <tr><th>姓名</th><th>院内 ID</th><th>电话</th><th>责任医生</th><th>操作</th></tr>
        </thead>
        <tbody>
          {patients.map((patient) => (
            <tr key={patient.id}>
              <td><strong>{patient.name}</strong></td>
              <td>{patient.hospitalPatientId ?? '-'}</td>
              <td>{patient.phone ?? '-'}</td>
              <td>{patient.responsibleDoctorId ?? '-'}</td>
              <td><Link className="secondary-btn compact-link-btn" to={`/patients/${patient.id}`}>进入档案</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompletedTasksTable({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return <div className="empty-state compact-empty">暂无已完成任务记录</div>;

  return (
    <div className="table-wrap clean-table-wrap">
      <table className="table clean-hospital-table">
        <thead>
          <tr><th>任务</th><th>患者</th><th>截止时间</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td><strong>{task.title}</strong></td>
              <td><PatientLink patient={task.patient} /></td>
              <td>{formatTime(task.dueAt)}</td>
              <td><span className={getStatusClass(task.status)}>{statusLabelMap[task.status] ?? task.status}</span></td>
              <td>{task.patient && <Link className="secondary-btn compact-link-btn" to={`/patients/${task.patient.id}?workspace=handling-history&historyTask=${task.id}`}>查看处置记录</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function NurseDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<NurseDashboard | null>(null);
  const [workItemsData, setWorkItemsData] = useState<WorkItemsResponse | null>(null);
  const [activeVisitReminders, setActiveVisitReminders] = useState<HospitalVisitReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<WorkbenchSectionKey>('workItems');
  const [workItemFilter, setWorkItemFilter] = useState<WorkItemFilter>('ALL');
  const [busyItemId, setBusyItemId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function loadDashboard(opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true);
    setError('');

    try {
      const [dashboardRes, workItemsRes, visitRemindersRes] = await Promise.all([
        api.get(`/nurse-dashboard?nurseId=${nurseId}`),
        api.get(`/work-items?nurseId=${nurseId}`),
        api.get('/hospital-visit-reminders?status=ACTIVE'),
      ]);
      setData(dashboardRes.data);
      setWorkItemsData(workItemsRes.data);
      setActiveVisitReminders(visitRemindersRes.data ?? []);
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '护士工作台加载失败，请确认后端服务已启动。'));
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }

  async function startAlertFollowUp(item: WorkItem) {
    if (!item.patient?.id || !item.alertId || busyItemId) return;

    setBusyItemId(item.id);
    setMessage('');
    setError('');

    try {
      const dueAt = new Date();
      if (item.riskLevel === 'VERY_HIGH') dueAt.setHours(dueAt.getHours() + 4);
      else if (item.riskLevel === 'HIGH') dueAt.setHours(dueAt.getHours() + 24);
      else dueAt.setHours(dueAt.getHours() + 72);

      const taskRes = await api.post(`/patients/${item.patient.id}/tasks`, {
        title: item.title.replace(/^风险预警：/, '风险随访：'),
        type: 'RISK_ALERT_FOLLOW_UP',
        dueAt: dueAt.toISOString(),
        assigneeId: nurseId,
        relatedAlertId: item.alertId,
      });

      await api.patch(`/risk-alerts/${item.alertId}/in-progress`, {
        handledBy: nurseId,
        handlingNote: '护士已从“待处理事项”将该风险预警转为电话随访任务。',
      });

      const createdTask = taskRes.data as CreatedTask;
      setMessage('已生成风险随访任务，即将进入患者详情页的电话随访 tab。');
      navigate(`/patients/${item.patient.id}?workspace=follow-up`);
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '风险预警转随访任务失败，请稍后重试。'));
      await loadDashboard();
    } finally {
      setBusyItemId('');
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  // 护士工作台：预警 / 待办任务每 15 秒自动刷新，无需手动 reload。
  usePolling(() => loadDashboard({ silent: true }), 15000);

  const workItems = workItemsData?.items ?? [];
  const filteredWorkItems = useMemo(() => {
    if (workItemFilter === 'RISK') {
      return workItems.filter((item) => item.itemType === 'RISK_FOLLOW_UP_TASK' || item.itemType === 'RISK_ALERT_ONLY' || item.itemType === 'HOSPITAL_VISIT_TASK');
    }
    if (workItemFilter === 'TASK') {
      return workItems.filter((item) => item.itemType === 'FOLLOW_UP_TASK');
    }
    if (workItemFilter === 'OVERDUE') {
      return workItems.filter((item) => isOverdue(item));
    }
    return workItems;
  }, [workItems, workItemFilter]);

  if (loading && !data) return <div className="loading-state">正在加载护士工作台...</div>;
  if (!data) return <div className="empty-state">护士工作台加载失败</div>;

  const completedTasks = data.completedTasks ?? [];
  const summary = workItemsData?.summary;

  const summaryItems: SummaryItem[] = [
    { label: '待处理事项', value: summary?.totalOpen ?? data.summary.pendingTaskCount + data.summary.openRiskAlertCount, section: 'workItems', filter: 'ALL', description: '任务与预警合并', tone: 'primary' },
    { label: '风险随访', value: (summary?.riskTaskCount ?? 0) + (summary?.alertOnlyCount ?? 0), section: 'workItems', filter: 'RISK', description: '风险/到院闭环', tone: 'danger' },
    { label: '普通随访', value: summary?.regularTaskCount ?? data.summary.pendingTaskCount, section: 'workItems', filter: 'TASK', description: '无关联预警', tone: 'warning' },
    { label: '逾期事项', value: summary?.overdueCount ?? data.summary.overdueTaskCount, section: 'workItems', filter: 'OVERDUE', description: '优先联系', tone: 'danger' },
    { label: '异常指标', value: data.summary.recentAbnormalVitalCount, section: 'vitals', description: '近期异常值', tone: 'warning' },
    { label: '我的患者', value: data.summary.patientCount, section: 'patients', description: '责任患者清单', tone: 'neutral' },
    { label: '完成记录', value: data.summary.completedTaskCount, section: 'completed', description: '最近完成', tone: 'success' },
  ];

  function openSummaryTarget(item: SummaryItem) {
    setActiveSection(item.section);
    if (item.filter) setWorkItemFilter(item.filter);
  }

  function getWorkbenchCount(sectionKey: WorkbenchSectionKey) {
    if (sectionKey === 'workItems') return summary?.totalOpen ?? data.summary.pendingTaskCount + data.summary.openRiskAlertCount;
    if (sectionKey === 'vitals') return data.summary.recentAbnormalVitalCount;
    if (sectionKey === 'patients') return data.summary.patientCount;
    if (sectionKey === 'completed') return data.summary.completedTaskCount;
    return 0;
  }

  return (
    <div className="business-page nurse-workbench-clean unified-workbench-page">
      {activeVisitReminders.length > 0 && (
        <section className="hospital-visit-workbench-banner" role="status">
          <div>
            <strong>已提醒以下患者到院：{activeVisitReminders.map((item) => item.patient?.name).filter(Boolean).join('、')}</strong>
            <p>请从到院提醒中心进入患者详情右侧处置面板，完成再次提醒、已到院、未到院或拒绝到院记录。</p>
          </div>
          <Link className="primary-btn compact-link-btn" to="/hospital-visit-reminders">
            查看详情
          </Link>
        </section>
      )}

      <section className="workbench-overview-strip" aria-label="护士工作台指标入口">
        {summaryItems.map((item) => (
          <button
            type="button"
            key={item.label}
            className={`workbench-metric-card workbench-metric-${item.tone} ${activeSection === item.section ? 'is-active' : ''}`}
            onClick={() => openSummaryTarget(item)}
          >
            <span className="metric-card-label">{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.description}</small>
          </button>
        ))}
      </section>

      <section className="workbench-layout-card nurse-workspace-layout-card">
        <aside className="patient-detail-side-nav nurse-workspace-side-nav" aria-label="护士工作台区域导航">
          <div className="patient-detail-side-nav-title">护士工作台工作区</div>
          <div className="patient-detail-side-nav-list">
            {workbenchSections.map((section) => (
              <button
                key={section.key}
                type="button"
                className={
                  activeSection === section.key
                    ? 'patient-detail-side-nav-item active'
                    : 'patient-detail-side-nav-item'
                }
                onClick={() => setActiveSection(section.key)}
              >
                <span>
                  <strong>{section.title}</strong>
                  <small>{section.description}</small>
                </span>
                <em>{getWorkbenchCount(section.key)}</em>
              </button>
            ))}
          </div>
        </aside>

        <main className="workbench-main-panel">
          {activeSection === 'workItems' && (
            <div className="workbench-section-stack">
              <div className="clean-section-heading">
                <div>
                  <h2>待处理事项</h2>
                </div>
              </div>

              <div className="segmented-tabs unified-work-item-tabs">
                <button className={workItemFilter === 'ALL' ? 'active' : ''} onClick={() => setWorkItemFilter('ALL')} type="button">全部 <span>{workItems.length}</span></button>
                <button className={workItemFilter === 'RISK' ? 'active' : ''} onClick={() => setWorkItemFilter('RISK')} type="button">风险/到院 <span>{workItems.filter((item) => item.itemType !== 'FOLLOW_UP_TASK').length}</span></button>
                <button className={workItemFilter === 'TASK' ? 'active' : ''} onClick={() => setWorkItemFilter('TASK')} type="button">普通随访 <span>{workItems.filter((item) => item.itemType === 'FOLLOW_UP_TASK').length}</span></button>
                <button className={workItemFilter === 'OVERDUE' ? 'active' : ''} onClick={() => setWorkItemFilter('OVERDUE')} type="button">逾期 <span>{workItems.filter((item) => isOverdue(item)).length}</span></button>
              </div>

              <section className="clean-subpanel">
                <WorkItemsTable items={filteredWorkItems} busyItemId={busyItemId} onStartAlertFollowUp={startAlertFollowUp} />
              </section>
            </div>
          )}

          {activeSection === 'vitals' && (
            <div className="workbench-section-stack">
              <div className="clean-section-heading"><div><h2>最近异常指标</h2></div></div>
              <section className="clean-subpanel"><VitalsTable records={data.recentAbnormalVitals} /></section>
            </div>
          )}

          {activeSection === 'patients' && (
            <div className="workbench-section-stack">
              <div className="clean-section-heading"><div><h2>我的患者</h2></div></div>
              <section className="clean-subpanel"><PatientsTable patients={data.myPatients} /></section>
            </div>
          )}

          {activeSection === 'completed' && (
            <div className="workbench-section-stack">
              <div className="clean-section-heading"><div><h2>完成记录</h2></div></div>
              <section className="clean-subpanel"><CompletedTasksTable tasks={completedTasks} /></section>
            </div>
          )}
        </main>
      </section>

      {error && (
        <div className="task-feedback-modal-backdrop" role="dialog" aria-modal="true">
          <div className="task-feedback-modal task-feedback-modal-error">
            <div className="task-feedback-modal-icon">!</div>
            <div>
              <span>操作失败</span>
              <h2>护士工作台操作未完成</h2>
              <p>{error}</p>
              <div className="task-feedback-modal-actions">
                <button className="primary-btn compact-link-btn" type="button" onClick={() => setError('')}>
                  我知道了
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className="task-feedback-modal-backdrop" role="dialog" aria-modal="true">
          <div className="task-feedback-modal task-feedback-modal-success">
            <div className="task-feedback-modal-icon">✓</div>
            <div>
              <span>操作成功</span>
              <h2>处理入口已准备好</h2>
              <p>{message}</p>
              <div className="task-feedback-modal-actions">
                <button className="primary-btn compact-link-btn" type="button" onClick={() => setMessage('')}>
                  知道了
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}







