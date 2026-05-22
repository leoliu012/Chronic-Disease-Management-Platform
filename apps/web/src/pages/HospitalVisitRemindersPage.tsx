import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, getApiErrorMessage } from '../api/client';
import type { CurrentUser } from './LoginPage';
import { useFeedbackMessageBridge } from '../utils/feedbackMessage';

type ReminderStatus = 'ACTIVE' | 'ARRIVED' | 'NO_SHOW' | 'REFUSED' | 'REVOKED';

type HospitalVisitReminder = {
  id: string;
  patientId: string;
  sourceRiskAlertId?: string | null;
  reason: string;
  note?: string | null;
  status: ReminderStatus;
  remindedBy?: string | null;
  remindedAt: string;
  outcomeNote?: string | null;
  relatedTaskId?: string | null;
  relatedTaskStatus?: string | null;
  relatedTaskType?: string | null;
  patient?: {
    id: string;
    name: string;
    hospitalPatientId?: string | null;
    phone?: string | null;
    address?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    responsibleDoctorId?: string | null;
    responsibleNurseId?: string | null;
  };
};

const statusText: Record<string, string> = {
  ACTIVE: '已提醒到院',
  ARRIVED: '已到院检查',
  NO_SHOW: '超过两天未到院',
  REFUSED: '患者拒绝到院',
  REVOKED: '已撤销',
};

function formatTime(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function getTaskProcessingUrl(item: HospitalVisitReminder) {
  const taskQuery = item.relatedTaskId ? `?taskPanel=1&taskId=${item.relatedTaskId}&mode=close` : '?taskPanel=1&mode=visit';
  return `/patients/${item.patientId}${taskQuery}`;
}

export function HospitalVisitRemindersPage({ user: _user }: { user: CurrentUser }) {
  const [searchParams] = useSearchParams();
  const highlightPatientId = searchParams.get('patientId') ?? '';
  const [reminders, setReminders] = useState<HospitalVisitReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedContactId, setExpandedContactId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // prominent-feedback-bridge-v1
  useFeedbackMessageBridge(undefined, error);

  async function loadReminders() {
    setLoading(true);
    setError('');

    try {
      const res = await api.get('/hospital-visit-reminders?status=ACTIVE');
      setReminders(res.data ?? []);
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '到院提醒列表加载失败，请稍后重试。'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReminders();
  }, []);

  const sortedReminders = useMemo(() => {
    if (!highlightPatientId) return reminders;
    return [...reminders].sort((a, b) => {
      if (a.patientId === highlightPatientId && b.patientId !== highlightPatientId) return -1;
      if (b.patientId === highlightPatientId && a.patientId !== highlightPatientId) return 1;
      return new Date(b.remindedAt).getTime() - new Date(a.remindedAt).getTime();
    });
  }, [highlightPatientId, reminders]);

  const reminderNames = useMemo(
    () => sortedReminders.map((item) => item.patient?.name).filter(Boolean).join('、'),
    [sortedReminders],
  );

  return (
    <div className="business-page hospital-reminders-page">
      <div className="page-header clean-page-header">
        <div>
          <div className="page-kicker">高危到院提醒</div>
          <h1>到院提醒中心</h1>
          <p className="page-subtitle">
            这里仅作为“已提醒到院患者”的总入口；具体处理请点击查看详情，进入对应患者的到院提醒任务。
          </p>
        </div>
        <button className="secondary-btn" type="button" onClick={loadReminders} disabled={loading}>
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>

      <section className="hospital-reminder-banner-page">
        <div>
          <strong>已提醒以下患者到院</strong>
          <p>{reminderNames || '暂无有效到院提醒'}</p>
        </div>
        <span>{sortedReminders.length} 人</span>
      </section>

      <section className="table-card hospital-reminder-table-card">
        {loading ? (
          <div className="loading-state">正在加载到院提醒...</div>
        ) : sortedReminders.length === 0 ? (
          <div className="empty-state">当前没有需要跟踪的到院提醒。</div>
        ) : (
          <div className="table-wrap clean-table-wrap">
            <table className="table clean-hospital-table">
              <thead>
                <tr>
                  <th>患者</th>
                  <th>提醒原因</th>
                  <th>提醒时间</th>
                  <th>联系方式</th>
                  <th>任务状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedReminders.map((item) => {
                  const contactExpanded = expandedContactId === item.id;
                  const highlighted = item.patientId === highlightPatientId;

                  return (
                    <tr key={item.id} className={highlighted ? 'hospital-reminder-row-highlight' : undefined}>
                      <td>
                        <strong>{item.patient?.name ?? '-'}</strong>
                        <div className="muted">院内号：{item.patient?.hospitalPatientId ?? '-'}</div>
                      </td>
                      <td>
                        <div>{item.reason}</div>
                        {item.note && <div className="muted">备注：{item.note}</div>}
                      </td>
                      <td>{formatTime(item.remindedAt)}</td>
                      <td>
                        <button
                          className="secondary-btn compact-link-btn"
                          type="button"
                          onClick={() => setExpandedContactId(contactExpanded ? null : item.id)}
                        >
                          {contactExpanded ? '收起联系方式' : '查看联系方式'}
                        </button>
                        {contactExpanded && (
                          <div className="hospital-contact-box">
                            <div>联系电话：{item.patient?.phone ?? '-'}</div>
                            <div>紧急联系人：{item.patient?.emergencyContactName ?? '-'}</div>
                            <div>紧急联系人电话：{item.patient?.emergencyContactPhone ?? '-'}</div>
                            <div>地址：{item.patient?.address ?? '-'}</div>
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="status-badge status-open">{statusText[item.status] ?? item.status}</span>
                        <div className="muted small">
                          {item.relatedTaskId ? '已生成到院提醒任务' : '待生成任务'}
                        </div>
                      </td>
                      <td>
                        <div className="hospital-reminder-actions">
                          <Link className="primary-btn compact-link-btn" to={getTaskProcessingUrl(item)}>
                            查看详情
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}


