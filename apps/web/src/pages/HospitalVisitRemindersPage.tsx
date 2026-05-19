import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getApiErrorMessage } from '../api/client';
import type { CurrentUser } from './LoginPage';

type ReminderStatus = 'ACTIVE' | 'ARRIVED' | 'NO_SHOW' | 'REFUSED' | 'REVOKED';

type HospitalVisitReminder = {
  id: string;
  patientId: string;
  sourceRiskAlertId?: string;
  reason: string;
  note?: string;
  status: ReminderStatus;
  remindedBy?: string;
  remindedAt: string;
  outcomeNote?: string;
  patient?: {
    id: string;
    name: string;
    hospitalPatientId?: string;
    phone?: string;
    address?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    responsibleDoctorId?: string;
    responsibleNurseId?: string;
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

function isOlderThanTwoDays(value?: string) {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() >= 48 * 60 * 60 * 1000;
}

export function HospitalVisitRemindersPage({ user }: { user: CurrentUser }) {
  const [reminders, setReminders] = useState<HospitalVisitReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [expandedContactId, setExpandedContactId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const canWrite = user.role === 'ADMIN' || user.role === 'DOCTOR' || user.role === 'NURSE';

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

  const reminderNames = useMemo(
    () => reminders.map((item) => item.patient?.name).filter(Boolean).join('、'),
    [reminders],
  );

  async function updateReminder(id: string, action: 'arrived' | 'no-show' | 'refused' | 'revoke') {
    if (!canWrite || processingId) return;

    const actionLabelMap = {
      arrived: '标记已到院检查',
      'no-show': '标记超过两天未到院',
      refused: '标记患者拒绝到院',
      revoke: '撤销到院提醒',
    } as const;

    const note = window.prompt(`请输入“${actionLabelMap[action]}”的处理说明，将写入后台日志：`);
    if (note === null) return;

    setProcessingId(id);
    setMessage('');
    setError('');

    try {
      await api.patch(`/hospital-visit-reminders/${id}/${action}`, {
        note: note.trim() || actionLabelMap[action],
      });
      setMessage(`${actionLabelMap[action]}已提交，后台已留痕。`);
      await loadReminders();
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '到院提醒状态更新失败，请稍后重试。'));
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <div className="business-page hospital-reminders-page">
      <div className="page-header clean-page-header">
        <div>
          <div className="page-kicker">高危到院提醒</div>
          <h1>到院提醒中心</h1>
          <p className="page-subtitle">显示当前仍处于“已提醒到院”的患者。护士可查看联系方式，并记录到院、未到院或拒绝到院结果。</p>
        </div>
        <button className="secondary-btn" type="button" onClick={loadReminders} disabled={loading || processingId !== null}>
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>

      {message && <div className="notice-success operation-inline-success" role="status">{message}</div>}
      {error && <div className="notice-error operation-inline-error" role="alert">{error}</div>}

      <section className="hospital-reminder-banner-page">
        <div>
          <strong>已提醒以下患者到院</strong>
          <p>{reminderNames || '暂无有效到院提醒'}</p>
        </div>
        <span>{reminders.length} 人</span>
      </section>

      <section className="table-card hospital-reminder-table-card">
        {loading ? (
          <div className="loading-state">正在加载到院提醒...</div>
        ) : reminders.length === 0 ? (
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
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {reminders.map((item) => {
                  const showOverdueActions = isOlderThanTwoDays(item.remindedAt);
                  const contactExpanded = expandedContactId === item.id;

                  return (
                    <tr key={item.id}>
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
                      <td><span className="status-badge status-open">{statusText[item.status] ?? item.status}</span></td>
                      <td>
                        <div className="hospital-reminder-actions">
                          <Link className="secondary-btn compact-link-btn" to={`/patients/${item.patientId}?workspace=risk`}>
                            进入患者详情
                          </Link>
                          {canWrite && (
                            <>
                              <button
                                className="primary-btn compact-link-btn"
                                type="button"
                                disabled={processingId !== null}
                                onClick={() => updateReminder(item.id, 'arrived')}
                              >
                                已到院检查
                              </button>
                              {showOverdueActions && (
                                <>
                                  <button
                                    className="secondary-btn compact-link-btn"
                                    type="button"
                                    disabled={processingId !== null}
                                    onClick={() => updateReminder(item.id, 'no-show')}
                                  >
                                    超过两天未到院
                                  </button>
                                  <button
                                    className="secondary-btn compact-link-btn"
                                    type="button"
                                    disabled={processingId !== null}
                                    onClick={() => updateReminder(item.id, 'refused')}
                                  >
                                    患者拒绝到院
                                  </button>
                                </>
                              )}
                            </>
                          )}
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
