import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

type BindingStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

type PatientBindingRequest = {
  id: string;
  demoOpenId: string;
  patientId: string;
  hospitalPatientId?: string | null;
  phone: string;
  idCardLast4?: string | null;
  status: BindingStatus;
  rejectReason?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
};

const statusLabelMap: Record<BindingStatus, string> = {
  PENDING: '待审核',
  APPROVED: '已通过',
  REJECTED: '已拒绝',
};

function formatTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function getStatusClass(status: BindingStatus) {
  if (status === 'APPROVED') return 'status-badge status-done';
  if (status === 'REJECTED') return 'status-badge status-canceled';
  return 'status-badge status-pending';
}

function maskPhone(phone: string) {
  if (!phone || phone.length < 7) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export function PatientBindingReviewPage() {
  const [requests, setRequests] = useState<PatientBindingRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<'ALL' | BindingStatus>('PENDING');
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const filteredRequests = useMemo(() => {
    if (statusFilter === 'ALL') return requests;
    return requests.filter((item) => item.status === statusFilter);
  }, [requests, statusFilter]);

  async function loadRequests(nextStatus = statusFilter) {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<PatientBindingRequest[]>('/patient-binding-requests', {
        params: nextStatus === 'ALL' ? undefined : { status: nextStatus },
      });
      setRequests(res.data || []);
    } catch {
      setError('加载患者绑定申请失败，请确认已登录护士或管理员账号。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function approve(id: string) {
    setUpdatingId(id);
    setMessage('');
    setError('');
    try {
      await api.patch(`/patient-binding-requests/${id}/approve`);
      setMessage('已通过绑定申请。患者端重新进入小程序后即可获得患者 token。');
      await loadRequests();
    } catch {
      setError('审核通过失败，请检查当前角色权限或后端服务。');
    } finally {
      setUpdatingId(null);
    }
  }

  async function reject(id: string) {
    setUpdatingId(id);
    setMessage('');
    setError('');
    try {
      await api.patch(`/patient-binding-requests/${id}/reject`, {
        rejectReason: '信息不匹配或需重新核验身份',
      });
      setMessage('已拒绝绑定申请。患者端可重新提交。');
      await loadRequests();
    } catch {
      setError('拒绝申请失败，请检查当前角色权限或后端服务。');
    } finally {
      setUpdatingId(null);
    }
  }

  function changeStatus(nextStatus: 'ALL' | BindingStatus) {
    setStatusFilter(nextStatus);
    loadRequests(nextStatus);
  }

  return (
    <div className="patient-binding-page">
      <section className="page-header-card binding-hero-card">
        <div>
          <div className="eyebrow">患者端可信入口</div>
          <h1>患者绑定审核</h1>
          <p>
            患者小程序提交手机号 + 院内号 / 身份证后四位后，护士在这里审核。通过后患者端会签发 patient token，后续只能访问本人慢病档案。
          </p>
        </div>
        <button className="secondary-btn" onClick={() => loadRequests()} disabled={loading}>
          {loading ? '刷新中...' : '刷新申请'}
        </button>
      </section>

      <section className="toolbar-card binding-toolbar-card">
        <div className="filter-group">
          {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((item) => (
            <button
              key={item}
              className={statusFilter === item ? 'filter-chip active' : 'filter-chip'}
              onClick={() => changeStatus(item)}
            >
              {item === 'ALL' ? '全部' : statusLabelMap[item]}
            </button>
          ))}
        </div>
        <div className="muted">当前显示 {filteredRequests.length} 条绑定申请</div>
      </section>

      {message && <div className="status-success">{message}</div>}
      {error && <div className="status-error">{error}</div>}

      <section className="table-card binding-review-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>申请时间</th>
              <th>患者匹配信息</th>
              <th>小程序身份</th>
              <th>状态</th>
              <th>审核信息</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredRequests.map((item) => (
              <tr key={item.id}>
                <td>{formatTime(item.createdAt)}</td>
                <td>
                  <div className="primary-cell">院内号：{item.hospitalPatientId || '-'}</div>
                  <div className="muted">手机号：{maskPhone(item.phone)}</div>
                  <div className="muted">患者ID：{item.patientId}</div>
                </td>
                <td>
                  <code className="openid-code">{item.demoOpenId}</code>
                </td>
                <td>
                  <span className={getStatusClass(item.status)}>{statusLabelMap[item.status]}</span>
                </td>
                <td>
                  <div className="muted">审核人：{item.reviewedBy || '-'}</div>
                  <div className="muted">审核时间：{formatTime(item.reviewedAt)}</div>
                  {item.rejectReason && <div className="status-small-warn">{item.rejectReason}</div>}
                </td>
                <td>
                  {item.status === 'PENDING' ? (
                    <div className="action-row compact-actions">
                      <button
                        className="primary-btn"
                        disabled={updatingId === item.id}
                        onClick={() => approve(item.id)}
                      >
                        通过
                      </button>
                      <button
                        className="ghost-btn"
                        disabled={updatingId === item.id}
                        onClick={() => reject(item.id)}
                      >
                        拒绝
                      </button>
                    </div>
                  ) : (
                    <span className="muted">已处理</span>
                  )}
                </td>
              </tr>
            ))}

            {!filteredRequests.length && (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">暂无对应状态的绑定申请。</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
