import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cancelOccurrence,
  createDirectMessage,
  createMedicationSchedule,
  createVitalSchedule,
  listDirectMessages,
  listOccurrencesForPatient,
  listSchedulesForPatient,
  pauseSchedule,
  resumeSchedule,
  sendOccurrenceNow,
  type CareReminderOccurrence,
  type CareReminderSchedule,
  type PatientDirectMessage,
} from '../api/care-reminders';

type Props = {
  patientId: string;
  canEdit: boolean;
};

export default function CareRemindersPanel({ patientId, canEdit }: Props) {
  const [schedules, setSchedules] = useState<CareReminderSchedule[]>([]);
  const [occurrences, setOccurrences] = useState<CareReminderOccurrence[]>([]);
  const [messages, setMessages] = useState<PatientDirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [s, o, m] = await Promise.all([
        listSchedulesForPatient(patientId),
        listOccurrencesForPatient(patientId),
        listDirectMessages(patientId),
      ]);
      setSchedules(s);
      setOccurrences(o);
      setMessages(m);
    } catch (e: any) {
      setErr(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const today = useMemo(() => {
    const now = Date.now();
    const start = now - 24 * 3600 * 1000;
    const end = now + 24 * 3600 * 1000;
    return occurrences
      .filter((o) => {
        const t = new Date(o.dueAt).getTime();
        return t >= start && t <= end;
      })
      .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt));
  }, [occurrences]);

  const missed = useMemo(
    () =>
      occurrences
        .filter((o) => o.status === 'MISSED' || o.status === 'ESCALATED')
        .sort((a, b) => +new Date(b.dueAt) - +new Date(a.dueAt))
        .slice(0, 20),
    [occurrences],
  );

  if (loading) return <div style={{ padding: 16 }}>载入中…</div>;

  return (
    <div style={{ display: 'grid', gap: 24, padding: 16 }}>
      {err && (
        <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8 }}>
          {err}
        </div>
      )}

      <SchedulesSection
        schedules={schedules}
        canEdit={canEdit}
        busyId={busyId}
        setBusyId={setBusyId}
        onRefresh={refresh}
      />

      <CreateScheduleSection patientId={patientId} canEdit={canEdit} onCreated={refresh} />

      <TodaySection
        items={today}
        canEdit={canEdit}
        busyId={busyId}
        setBusyId={setBusyId}
        onRefresh={refresh}
      />

      <MissedSection items={missed} />

      <DirectMessageComposer patientId={patientId} canEdit={canEdit} onSent={refresh} />

      <MessagesSection items={messages} />
    </div>
  );
}

// ===========================================================================
// sub-sections
// ===========================================================================

function SchedulesSection({
  schedules,
  canEdit,
  busyId,
  setBusyId,
  onRefresh,
}: {
  schedules: CareReminderSchedule[];
  canEdit: boolean;
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  onRefresh: () => void;
}) {
  return (
    <section>
      <h3 style={{ marginBottom: 8 }}>长期提醒计划</h3>
      {schedules.length === 0 ? (
        <div style={{ color: '#6b7280' }}>暂无长期提醒计划。</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f3f4f6' }}>
            <tr>
              <th style={th}>标题</th>
              <th style={th}>类型</th>
              <th style={th}>时间</th>
              <th style={th}>状态</th>
              <th style={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id}>
                <td style={td}>{s.title}</td>
                <td style={td}>{labelOfReminderType(s.reminderType)}</td>
                <td style={td}>{(s.scheduledTimes || []).join(', ')}</td>
                <td style={td}>
                  {s.isActive ? (
                    <span style={tagActive}>启用</span>
                  ) : (
                    <span style={tagPaused}>已暂停</span>
                  )}
                </td>
                <td style={td}>
                  {canEdit && (
                    <button
                      disabled={busyId === s.id}
                      onClick={async () => {
                        try {
                          setBusyId(s.id);
                          if (s.isActive) await pauseSchedule(s.id);
                          else await resumeSchedule(s.id);
                          onRefresh();
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      {s.isActive ? '暂停' : '恢复'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function CreateScheduleSection({
  patientId,
  canEdit,
  onCreated,
}: {
  patientId: string;
  canEdit: boolean;
  onCreated: () => void;
}) {
  const [kind, setKind] = useState<'MEDICATION' | 'VITAL'>('MEDICATION');
  const [medicationId, setMedicationId] = useState('');
  const [vitalType, setVitalType] = useState('BLOOD_PRESSURE');
  const [times, setTimes] = useState('08:00');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!canEdit) return null;

  async function submit() {
    setErr(null);
    const arr = times.split(',').map((t) => t.trim()).filter(Boolean);
    if (arr.length === 0) {
      setErr('请填写至少一个时间点');
      return;
    }
    try {
      setBusy(true);
      if (kind === 'MEDICATION') {
        if (!medicationId.trim()) {
          setErr('请填写药品 ID (例如 demo-med-001)');
          return;
        }
        await createMedicationSchedule(patientId, { medicationId, scheduledTimes: arr });
      } else {
        await createVitalSchedule(patientId, { vitalType, scheduledTimes: arr });
      }
      setMedicationId('');
      setTimes('08:00');
      onCreated();
    } catch (e: any) {
      setErr(e?.message || '创建失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ background: '#f9fafb', borderRadius: 8, padding: 12 }}>
      <h4 style={{ marginTop: 0 }}>新增长期提醒</h4>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={kind} onChange={(e) => setKind(e.target.value as any)}>
          <option value="MEDICATION">用药提醒</option>
          <option value="VITAL">指标打卡</option>
        </select>
        {kind === 'MEDICATION' ? (
          <input
            placeholder="药品 ID (如 demo-med-001)"
            value={medicationId}
            onChange={(e) => setMedicationId(e.target.value)}
            style={{ minWidth: 220 }}
          />
        ) : (
          <select value={vitalType} onChange={(e) => setVitalType(e.target.value)}>
            <option value="BLOOD_PRESSURE">血压</option>
            <option value="BLOOD_GLUCOSE">血糖</option>
            <option value="WEIGHT">体重</option>
            <option value="HEART_RATE">心率</option>
            <option value="SPO2">血氧</option>
          </select>
        )}
        <input
          placeholder="时间 (例如 08:00,20:00)"
          value={times}
          onChange={(e) => setTimes(e.target.value)}
          style={{ minWidth: 180 }}
        />
        <button disabled={busy} onClick={submit}>
          {busy ? '保存中…' : '保存'}
        </button>
        {err && <span style={{ color: '#991b1b' }}>{err}</span>}
      </div>
    </section>
  );
}

function TodaySection({
  items,
  canEdit,
  busyId,
  setBusyId,
  onRefresh,
}: {
  items: CareReminderOccurrence[];
  canEdit: boolean;
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  onRefresh: () => void;
}) {
  return (
    <section>
      <h3 style={{ marginBottom: 8 }}>今日提醒 (±24h)</h3>
      {items.length === 0 ? (
        <div style={{ color: '#6b7280' }}>暂无。</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f3f4f6' }}>
            <tr>
              <th style={th}>时间</th>
              <th style={th}>提醒</th>
              <th style={th}>状态</th>
              <th style={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id}>
                <td style={td}>{fmtDateTime(o.dueAt)}</td>
                <td style={td}>{o.title}</td>
                <td style={td}>
                  <StatusBadge status={o.status} />
                </td>
                <td style={td}>
                  {canEdit && o.status === 'PENDING' && (
                    <>
                      <button
                        disabled={busyId === o.id}
                        onClick={async () => {
                          try {
                            setBusyId(o.id);
                            await sendOccurrenceNow(o.id);
                            onRefresh();
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        立即发送
                      </button>{' '}
                      <button
                        disabled={busyId === o.id}
                        onClick={async () => {
                          try {
                            setBusyId(o.id);
                            await cancelOccurrence(o.id);
                            onRefresh();
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        取消
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function MissedSection({ items }: { items: CareReminderOccurrence[] }) {
  return (
    <section>
      <h3 style={{ marginBottom: 8 }}>未完成 / 已升级</h3>
      {items.length === 0 ? (
        <div style={{ color: '#6b7280' }}>没有遗漏。</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f3f4f6' }}>
            <tr>
              <th style={th}>计划时间</th>
              <th style={th}>提醒</th>
              <th style={th}>状态</th>
              <th style={th}>护士 Task</th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id}>
                <td style={td}>{fmtDateTime(o.dueAt)}</td>
                <td style={td}>{o.title}</td>
                <td style={td}>
                  <StatusBadge status={o.status} />
                </td>
                <td style={td}>{o.escalatedTaskId || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function DirectMessageComposer({
  patientId,
  canEdit,
  onSent,
}: {
  patientId: string;
  canEdit: boolean;
  onSent: () => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<'NORMAL' | 'IMPORTANT' | 'URGENT'>('NORMAL');
  const [requiresAck, setRequiresAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!canEdit) return null;

  async function submit() {
    setErr(null);
    if (!title.trim() || !content.trim()) {
      setErr('标题和内容不能为空');
      return;
    }
    try {
      setBusy(true);
      await createDirectMessage(patientId, { title, content, priority, requiresAck });
      setTitle('');
      setContent('');
      setRequiresAck(false);
      setPriority('NORMAL');
      onSent();
    } catch (e: any) {
      setErr(e?.message || '发送失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ background: '#f9fafb', borderRadius: 8, padding: 12 }}>
      <h4 style={{ marginTop: 0 }}>给患者发送一条消息</h4>
      <div style={{ display: 'grid', gap: 8 }}>
        <input
          placeholder="标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          placeholder="正文"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={priority} onChange={(e) => setPriority(e.target.value as any)}>
            <option value="NORMAL">普通</option>
            <option value="IMPORTANT">重要</option>
            <option value="URGENT">紧急</option>
          </select>
          <label>
            <input
              type="checkbox"
              checked={requiresAck}
              onChange={(e) => setRequiresAck(e.target.checked)}
            />{' '}
            要求确认收到
          </label>
          <button disabled={busy} onClick={submit}>
            {busy ? '发送中…' : '发送'}
          </button>
          {err && <span style={{ color: '#991b1b' }}>{err}</span>}
        </div>
      </div>
    </section>
  );
}

function MessagesSection({ items }: { items: PatientDirectMessage[] }) {
  return (
    <section>
      <h3 style={{ marginBottom: 8 }}>历史触达消息</h3>
      {items.length === 0 ? (
        <div style={{ color: '#6b7280' }}>暂无。</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f3f4f6' }}>
            <tr>
              <th style={th}>时间</th>
              <th style={th}>标题</th>
              <th style={th}>优先级</th>
              <th style={th}>渠道</th>
              <th style={th}>状态</th>
              <th style={th}>要确认</th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id}>
                <td style={td}>{fmtDateTime(m.createdAt)}</td>
                <td style={td}>{m.title}</td>
                <td style={td}>{m.priority}</td>
                <td style={td}>{m.channel}</td>
                <td style={td}>{m.status}</td>
                <td style={td}>{m.requiresAck ? '是' : '否'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ===========================================================================
// styles + small helpers
// ===========================================================================

const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #e5e7eb' };
const tagActive: React.CSSProperties = {
  padding: '2px 8px',
  background: '#dcfce7',
  color: '#166534',
  borderRadius: 999,
  fontSize: 12,
};
const tagPaused: React.CSSProperties = {
  padding: '2px 8px',
  background: '#fef9c3',
  color: '#854d0e',
  borderRadius: 999,
  fontSize: 12,
};

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
  const d = new Date(s);
  return d.toLocaleString();
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
