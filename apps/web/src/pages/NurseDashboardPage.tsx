import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, getApiErrorMessage } from '../api/client';
import { usePolling } from '../hooks/usePolling';

type Patient = {
  id: string;
  name: string;
  hospitalPatientId?: string | null;
  phone?: string | null;
};

type WorkItemBucket =
  | 'ALL'
  | 'CRITICAL_RISK'
  | 'OVERDUE'
  | 'PHONE_DUE_TODAY'
  | 'FAILED_CONTACT_RETRY'
  | 'REFERRAL_CONFIRMATION'
  | 'SUBMISSION_REVIEW'
  | 'GATEWAY_CONFLICT';

type WorkItem = {
  id: string;
  itemType:
    | 'FOLLOW_UP_TASK'
    | 'RISK_FOLLOW_UP_TASK'
    | 'HOSPITAL_VISIT_TASK'
    | 'RISK_ALERT_ONLY'
    | 'GATEWAY_CONFLICT'
    | 'CARE_REMINDER_ESCALATION'
    | 'CARE_PLAN_RECOMMENDATION'
    | 'PATIENT_SUBMISSION_REVIEW';
  sourceType: 'TASK' | 'RISK_ALERT' | 'GATEWAY_CONFLICT' | 'CARE_REMINDER_OCCURRENCE' | 'NEXT_BEST_ACTION' | 'PATIENT_FORM_LINK';
  sourceId?: string;
  taskId?: string;
  alertId?: string;
  nextBestActionId?: string;
  title: string;
  description?: string | null;
  status: string;
  priority: number;
  riskLevel?: string;
  dueAt?: string | null;
  createdAt: string;
  patient?: Patient | null;
  riskReason: string;
  mostRecentEvidence: string;
  waitingSeconds: number;
  slaRemainingSeconds: number | null;
  assignedStaff: string;
  recommendedAction: string;
  bucketKeys: WorkItemBucket[];
  triggerCount?: number;
  triggerRule?: string | null;
  actionUrl: string;
  actionText: string;
};

type WorkItemsSummary = {
  totalOpen: number;
  criticalRiskPendingActionCount: number;
  overdueTaskCount: number;
  telephoneFollowUpsDueTodayCount: number;
  failedContactRetryCount: number;
  referralAwaitingConfirmationCount: number;
  patientSubmissionsAwaitingReviewCount: number;
  gatewayConflictCount: number;
  carePlanRecommendationCount: number;
  careReminderEscalationCount: number;
};

type WorkItemsResponse = {
  summary: WorkItemsSummary;
  activeBucket: WorkItemBucket;
  items: WorkItem[];
};

type Card = {
  bucket: WorkItemBucket;
  label: string;
  description: string;
  value: number;
  tone: 'danger' | 'warning' | 'primary' | 'neutral';
};

const bucketLabels: Record<WorkItemBucket, string> = {
  ALL: '全部待处理事项',
  CRITICAL_RISK: '极高危待处置',
  OVERDUE: '逾期任务',
  PHONE_DUE_TODAY: '今日电话随访',
  FAILED_CONTACT_RETRY: '触达失败待重试',
  REFERRAL_CONFIRMATION: '转诊待确认',
  SUBMISSION_REVIEW: '患者提交待复核',
  GATEWAY_CONFLICT: '接口冲突待处理',
};

const itemTypeLabels: Record<string, string> = {
  FOLLOW_UP_TASK: '随访任务',
  RISK_FOLLOW_UP_TASK: '风险处置任务',
  HOSPITAL_VISIT_TASK: '到院确认任务',
  RISK_ALERT_ONLY: '未转任务风险预警',
  GATEWAY_CONFLICT: '接口冲突',
  CARE_REMINDER_ESCALATION: '遗漏提醒升级',
  CARE_PLAN_RECOMMENDATION: '患者级建议',
  PATIENT_SUBMISSION_REVIEW: '患者提交待复核',
};

const statusLabels: Record<string, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '处理中',
  OPEN: '未处理',
  MISSED: '已遗漏',
  CONFLICT: '待核验',
  PROPOSED: '待护士确认',
  PENDING_REVIEW: '待人工复核',
  REVIEWED: '已复核',
};

function formatTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatDuration(seconds?: number | null) {
  if (seconds == null) return '-';
  const abs = Math.abs(seconds);
  if (abs < 60) return `${abs} 秒`;
  if (abs < 3600) return `${Math.floor(abs / 60)} 分钟`;
  if (abs < 86400) return `${Math.floor(abs / 3600)} 小时`;
  return `${Math.floor(abs / 86400)} 天 ${Math.floor((abs % 86400) / 3600)} 小时`;
}

function slaLabel(seconds?: number | null) {
  if (seconds == null) return '-';
  return seconds < 0 ? `已超时 ${formatDuration(seconds)}` : `剩余 ${formatDuration(seconds)}`;
}

function riskClass(riskLevel?: string) {
  return `risk-badge risk-${String(riskLevel ?? 'LOW').toLowerCase().replace(/_/g, '-')}`;
}

function PatientLink({ patient }: { patient?: Patient | null }) {
  if (!patient) return <span className="muted">-</span>;
  return <Link to={`/patients/${patient.id}`}>{patient.name}</Link>;
}

export function NurseDashboardPage() {
  const navigate = useNavigate();
  const [activeBucket, setActiveBucket] = useState<WorkItemBucket>('ALL');
  const [summary, setSummary] = useState<WorkItemsSummary | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyItemId, setBusyItemId] = useState('');
  const [error, setError] = useState('');

  async function loadQueue(opts?: { silent?: boolean; bucket?: WorkItemBucket }) {
    if (!opts?.silent) setLoading(true);
    setError('');
    const bucket = opts?.bucket ?? activeBucket;
    try {
      const [summaryRes, queueRes] = await Promise.all([
        api.get<WorkItemsSummary>('/work-items/summary'),
        api.get<WorkItemsResponse>('/work-items', { params: { bucket } }),
      ]);
      setSummary(summaryRes.data);
      setItems(queueRes.data.items ?? []);
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '护士今日行动队列加载失败，请确认后端和数据库迁移已完成。'));
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }

  async function selectBucket(bucket: WorkItemBucket) {
    setActiveBucket(bucket);
    await loadQueue({ bucket });
  }

  async function startAlertDisposition(item: WorkItem) {
    if (!item.patient?.id || !item.alertId) return;
    setBusyItemId(item.id);
    setError('');
    try {
      const dueAt = new Date();
      dueAt.setHours(dueAt.getHours() + (item.riskLevel === 'VERY_HIGH' ? 4 : item.riskLevel === 'HIGH' ? 24 : 72));
      const response = await api.post(`/patients/${item.patient.id}/tasks`, {
        title: item.title.replace(/^风险预警：/, '风险处置：'),
        type: 'RISK_ALERT_FOLLOW_UP',
        dueAt: dueAt.toISOString(),
        relatedAlertId: item.alertId,
      });
      await api.patch(`/risk-alerts/${item.alertId}/in-progress`, {
        handlingNote: '护士已从今日行动队列创建处置任务。',
      });
      navigate(`/patients/${item.patient.id}/task-processing?taskId=${response.data.id}`);
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '风险预警转处置任务失败。'));
      await loadQueue({ silent: true });
    } finally {
      setBusyItemId('');
    }
  }

  async function acceptRecommendation(item: WorkItem) {
    if (!item.nextBestActionId || !item.patient?.id) return;
    setBusyItemId(item.id);
    setError('');
    try {
      const response = await api.post(`/care-plans/next-best-actions/${item.nextBestActionId}/create-task`);
      navigate(`/patients/${item.patient.id}/task-processing?taskId=${response.data.id}`);
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '患者级建议转处置任务失败。'));
      await loadQueue({ silent: true });
    } finally {
      setBusyItemId('');
    }
  }

  async function reviewPatientSubmission(item: WorkItem) {
    if (!item.sourceId) return;
    const confirmed = window.confirm('确认已查看该患者提交内容并完成人工复核？');
    if (!confirmed) return;
    setBusyItemId(item.id);
    setError('');
    try {
      await api.post(`/work-items/submissions/${item.sourceId}/review`, {
        note: '护士已在今日行动队列确认复核。',
      });
      await loadQueue({ silent: true });
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '患者提交复核状态更新失败。'));
      await loadQueue({ silent: true });
    } finally {
      setBusyItemId('');
    }
  }

  function runPrimaryAction(item: WorkItem) {
    if (item.itemType === 'PATIENT_SUBMISSION_REVIEW') {
      void reviewPatientSubmission(item);
      return;
    }
    if (item.itemType === 'RISK_ALERT_ONLY') {
      void startAlertDisposition(item);
      return;
    }
    if (item.itemType === 'CARE_PLAN_RECOMMENDATION') {
      void acceptRecommendation(item);
      return;
    }
    navigate(item.actionUrl);
  }

  useEffect(() => {
    void loadQueue();
  }, []);

  usePolling(() => loadQueue({ silent: true }), 15000);

  const cards: Card[] = summary ? [
    { bucket: 'CRITICAL_RISK', label: '极高危待处置', description: '优先联系并升级', value: summary.criticalRiskPendingActionCount, tone: 'danger' },
    { bucket: 'OVERDUE', label: '逾期任务', description: '已超过 SLA', value: summary.overdueTaskCount, tone: 'danger' },
    { bucket: 'PHONE_DUE_TODAY', label: '今日电话随访', description: '今日需要联系', value: summary.telephoneFollowUpsDueTodayCount, tone: 'primary' },
    { bucket: 'FAILED_CONTACT_RETRY', label: '触达失败待重试', description: '微信或短信失败', value: summary.failedContactRetryCount, tone: 'warning' },
    { bucket: 'REFERRAL_CONFIRMATION', label: '转诊待确认', description: '追踪闭环状态', value: summary.referralAwaitingConfirmationCount, tone: 'warning' },
    { bucket: 'SUBMISSION_REVIEW', label: '患者提交待复核', description: '需要人工审核', value: summary.patientSubmissionsAwaitingReviewCount, tone: 'primary' },
    { bucket: 'GATEWAY_CONFLICT', label: '接口冲突待处理', description: '管理员核验', value: summary.gatewayConflictCount, tone: 'neutral' },
  ] : [];

  if (loading && !summary) return <div className="loading-state">正在加载护士今日行动队列...</div>;

  return (
    <div className="page nurse-action-queue-v9-page">
      <header className="page-header nurse-action-queue-v9-header">
        <div>
          <p className="eyebrow">Patient-level stratified management</p>
          <h1>护士今日行动队列</h1>
          <p>先处理高风险、逾期、触达失败、转诊闭环和人工复核事项。患者级建议只有在护士确认后才会生成正式任务。</p>
        </div>
        <button className="secondary-btn" type="button" onClick={() => void loadQueue()}>刷新队列</button>
      </header>

      <section className="nurse-action-queue-v9-summary" aria-label="今日行动队列摘要">
        {cards.map((card) => (
          <button
            key={card.bucket}
            type="button"
            className={`nurse-action-queue-v9-card tone-${card.tone} ${activeBucket === card.bucket ? 'active' : ''}`}
            onClick={() => void selectBucket(card.bucket)}
          >
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.description}</small>
          </button>
        ))}
      </section>

      <section className="nurse-action-queue-v9-panel">
        <div className="nurse-action-queue-v9-panel-heading">
          <div>
            <h2>{bucketLabels[activeBucket]}</h2>
            <p>{summary?.totalOpen ?? 0} 条开放事项；当前筛选显示 {items.length} 条。</p>
          </div>
          {activeBucket !== 'ALL' && (
            <button className="secondary-btn compact-link-btn" type="button" onClick={() => void selectBucket('ALL')}>查看全部</button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="empty-state compact-empty">当前筛选下没有待处理事项</div>
        ) : (
          <div className="table-wrap nurse-action-queue-v9-table-wrap">
            <table className="table nurse-action-queue-v9-table">
              <thead>
                <tr>
                  <th>患者</th>
                  <th>风险原因</th>
                  <th>最近证据</th>
                  <th>等待时间</th>
                  <th>剩余 SLA</th>
                  <th>责任人</th>
                  <th>建议动作</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={item.priority === 0 ? 'critical-row' : ''}>
                    <td>
                      <PatientLink patient={item.patient} />
                      <div className="muted small">{item.patient?.hospitalPatientId ?? itemTypeLabels[item.itemType] ?? item.itemType}</div>
                    </td>
                    <td>
                      <span className={riskClass(item.riskLevel)}>{item.riskLevel ?? 'ROUTINE'}</span>
                      <strong className="queue-cell-title">{item.riskReason}</strong>
                      <div className="muted small">{statusLabels[item.status] ?? item.status} · {formatTime(item.dueAt)}</div>
                    </td>
                    <td><span className="queue-evidence">{item.mostRecentEvidence}</span></td>
                    <td>{formatDuration(item.waitingSeconds)}</td>
                    <td className={item.slaRemainingSeconds != null && item.slaRemainingSeconds < 0 ? 'sla-overdue' : ''}>{slaLabel(item.slaRemainingSeconds)}</td>
                    <td>{item.assignedStaff}</td>
                    <td><code>{item.recommendedAction}</code></td>
                    <td>
                      {item.itemType === 'PATIENT_SUBMISSION_REVIEW' && item.patient?.id && (
                        <button
                          className="secondary-btn compact-link-btn"
                          type="button"
                          onClick={() => navigate(item.actionUrl)}
                        >
                          查看详情
                        </button>
                      )}
                      <button
                        className="primary-btn compact-link-btn"
                        type="button"
                        disabled={busyItemId === item.id}
                        onClick={() => runPrimaryAction(item)}
                      >
                        {busyItemId === item.id ? '处理中...' : item.actionText}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {error && (
        <div className="task-feedback-modal-backdrop" role="dialog" aria-modal="true">
          <div className="task-feedback-modal task-feedback-modal-error">
            <div className="task-feedback-modal-icon">!</div>
            <div>
              <span>操作失败</span>
              <h2>护士今日行动队列操作未完成</h2>
              <p>{error}</p>
              <div className="task-feedback-modal-actions">
                <button className="primary-btn compact-link-btn" type="button" onClick={() => setError('')}>我知道了</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
