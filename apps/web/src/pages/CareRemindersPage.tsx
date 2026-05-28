import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listMissedOccurrences,
  listTodayOccurrences,
  type CareReminderOccurrence,
} from '../api/care-reminders';

export default function CareRemindersPage() {
  const [today, setToday] = useState<CareReminderOccurrence[]>([]);
  const [missed, setMissed] = useState<CareReminderOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [t, m] = await Promise.all([listTodayOccurrences(), listMissedOccurrences()]);
      setToday(t);
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

  return (
    <div style={{ padding: 24 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>慢病提醒中心</h2>
        <button onClick={refresh}>刷新</button>
        {loading && <span style={{ color: '#6b7280' }}>载入中…</span>}
      </header>

      {err && (
        <div
          style={{
            padding: 12,
            background: '#fef2f2',
            color: '#991b1b',
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          {err}
        </div>
      )}

      <Section title={`今日提醒 (±24h) · ${today.length} 条`}>
        {today.length === 0 ? (
          <div style={{ color: '#6b7280' }}>今天没有计划中的提醒。</div>
        ) : (
          <OccurrenceTable rows={today} />
        )}
      </Section>

      <Section title={`未完成 / 已升级 · 最近 30 天 ${missed.length} 条`}>
        {missed.length === 0 ? (
          <div style={{ color: '#6b7280' }}>近期没有遗漏。</div>
        ) : (
          <OccurrenceTable rows={missed} showEscalation />
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h3 style={{ marginBottom: 8 }}>{title}</h3>
      {children}
    </section>
  );
}

function OccurrenceTable({
  rows,
  showEscalation,
}: {
  rows: CareReminderOccurrence[];
  showEscalation?: boolean;
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead style={{ background: '#f3f4f6' }}>
        <tr>
          <th style={th}>计划时间</th>
          <th style={th}>患者</th>
          <th style={th}>提醒</th>
          <th style={th}>类型</th>
          <th style={th}>状态</th>
          {showEscalation && <th style={th}>护士 Task</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.id}>
            <td style={td}>{fmtDateTime(o.dueAt)}</td>
            <td style={td}>
              {o.patient ? (
                <Link to={`/patients/${o.patientId}`}>{o.patient.name}</Link>
              ) : (
                o.patientId
              )}
            </td>
            <td style={td}>{o.title}</td>
            <td style={td}>{labelOfReminderType(o.occurrenceType)}</td>
            <td style={td}>
              <StatusBadge status={o.status} />
            </td>
            {showEscalation && <td style={td}>{o.escalatedTaskId || '—'}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #e5e7eb' };

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, [string, string]> = {
    PENDING: ['#dbeafe', '#1e40af'],
    SENDING: ['#fef3c7', '#92400e'],
    SENT: ['#bfdbfe', '#1e3a8a'],
    CLICKED: ['#bae6fd', '#075985'],
    COMPLETED: ['#dcfce7', '#166534'],
    MISSED: ['#fee2e2', '#991b1b'],
    ESCALATED: ['#fecaca', '#7f1d1d'],
    CANCELED: ['#e5e7eb', '#374151'],
  };
  const [bg, fg] = colorMap[status] || ['#e5e7eb', '#374151'];
  return (
    <span style={{ background: bg, color: fg, padding: '2px 8px', borderRadius: 999, fontSize: 12 }}>
      {status}
    </span>
  );
}

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString();
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
