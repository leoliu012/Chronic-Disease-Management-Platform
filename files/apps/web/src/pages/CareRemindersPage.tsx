import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listMissedOccurrences,
  resendOccurrence,
  sendOccurrenceNow,
  type CareReminderOccurrence,
} from '../api/care-reminders';
import '../patient-engagement-admin-tab.css';

export default function CareRemindersPage() {
  const [missed, setMissed] = useState<CareReminderOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      // v3.3.3: the cross-patient center no longer shows a same-day board
      // (it duplicated the long-term reminders view). It now focuses on
      // outstanding / escalated reminders that need a nurse to follow up.
      const m = await listMissedOccurrences();
      setMissed(m);
    } catch (e: any) {
      setErr(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const send = useCallback(
    async (id: string) => {
      setBusyId(id);
      setErr(null);
      setNotice(null);
      try {
        await sendOccurrenceNow(id);
        setNotice('已尝试立即发送。');
        await refresh();
      } catch (e: any) {
        setErr(e?.message || '发送失败');
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const resend = useCallback(
    async (id: string) => {
      setBusyId(id);
      setErr(null);
      setNotice(null);
      try {
        const r = await resendOccurrence(id);
        setNotice(r.reusedLink ? '已再次发送（复用原链接）。' : '已再次发送（已生成新链接）。');
        await refresh();
      } catch (e: any) {
        setErr(e?.message || '再次发送失败');
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  return (
    <div className="pe-admin-tab" style={{ padding: 24 }}>
      <div className="pe-admin-page-header">
        <h2>慢病提醒中心</h2>
        <div className="pe-admin-page-header-actions">
          {loading && <span className="pe-admin-muted">载入中…</span>}
          <button type="button" className="pe-admin-link-button" onClick={refresh}>
            刷新
          </button>
        </div>
      </div>

      {err && <div className="pe-admin-banner pe-admin-banner-error">{err}</div>}
      {notice && <div className="pe-admin-banner pe-admin-banner-ok">{notice}</div>}

      <section className="pe-admin-messages">
        <h3>{`未完成 / 已升级 · 最近 30 天 ${missed.length} 条`}</h3>
        {missed.length === 0 ? (
          <p className="pe-admin-muted">近期没有遗漏。</p>
        ) : (
          <OccurrenceTable
            rows={missed}
            busyId={busyId}
            onSend={send}
            onResend={resend}
            showPatient
            showEscalation
            showActions
          />
        )}
      </section>
    </div>
  );
}

function OccurrenceTable({
  rows,
  showEscalation,
  showActions,
  showPatient,
  busyId,
  onSend,
  onResend,
}: {
  rows: CareReminderOccurrence[];
  showEscalation?: boolean;
  showActions?: boolean;
  showPatient?: boolean;
  busyId?: string | null;
  onSend?: (id: string) => void;
  onResend?: (id: string) => void;
}) {
  return (
    <table className="pe-admin-messages-table">
      <thead>
        <tr>
          <th>计划时间</th>
          {showPatient && <th>患者</th>}
          <th>提醒</th>
          <th>类型</th>
          <th>状态</th>
          {showEscalation && <th>护士 Task</th>}
          {showActions && <th>操作</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.id}>
            <td>{fmtDateTime(o.dueAt)}</td>
            {showPatient && (
              <td>{o.patient ? <Link to={`/patients/${o.patientId}`}>{o.patient.name}</Link> : o.patientId}</td>
            )}
            <td>{o.title}</td>
            <td>{labelOfReminderType(o.occurrenceType)}</td>
            <td>
              <StatusBadge status={o.status} />
            </td>
            {showEscalation && <td>{o.escalatedTaskId || '—'}</td>}
            {showActions && (
              <td className="pe-admin-actions-cell">
                {o.status === 'PENDING' && (
                  <button type="button" className="pe-admin-primary" disabled={busyId === o.id} onClick={() => onSend?.(o.id)}>
                    立即发送
                  </button>
                )}
                {(o.status === 'SENT' || o.status === 'CLICKED') && !o.completedAt && (
                  <button type="button" className="pe-admin-secondary" disabled={busyId === o.id} onClick={() => onResend?.(o.id)}>
                    再次发送
                  </button>
                )}
                {o.status === 'COMPLETED' && <span className="pe-admin-pos">已完成</span>}
                {o.status === 'ESCALATED' && <span className="pe-admin-neg">已升级跟进</span>}
                {o.status === 'MISSED' && <span className="pe-admin-neg">已错过</span>}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    PENDING: 'pending',
    SENDING: 'pending',
    SENT: 'sent',
    CLICKED: 'clicked',
    COMPLETED: 'submitted',
    MISSED: 'failed',
    ESCALATED: 'failed',
    CANCELED: 'canceled',
  };
  const label: Record<string, string> = {
    PENDING: '待发送',
    SENDING: '发送中',
    SENT: '已发送',
    CLICKED: '已打开',
    COMPLETED: '已完成',
    MISSED: '已错过',
    ESCALATED: '已升级',
    CANCELED: '已取消',
  };
  return (
    <span className={`pe-admin-status pe-admin-status-${cls[status] || 'pending'}`}>
      {label[status] || status}
    </span>
  );
}

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString('zh-CN', { hour12: false });
}

function labelOfReminderType(t: string): string {
  switch (t) {
    case 'MEDICATION_CHECKIN':
      return '用药打卡';
    case 'VITAL_RECHECK':
      return '指标打卡';
    case 'QUESTIONNAIRE':
      return '问卷';
    case 'GENERAL_MESSAGE':
      return '通知消息';
    default:
      return t;
  }
}
