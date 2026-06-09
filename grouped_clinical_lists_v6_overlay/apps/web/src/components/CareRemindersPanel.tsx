import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createDirectMessage,
  listDirectMessages,
  listOccurrencesForPatient,
  listSchedulesForPatient,
  type CareReminderOccurrence,
  type CareReminderSchedule,
  type PatientDirectMessage,
} from '../api/care-reminders';
import {
  GroupedCareReminderOccurrences,
  GroupedCareReminderSchedules,
} from './CareReminderGroupedViews';
import '../patient-engagement-admin-tab.css';

type Props = {
  patientId: string;
  canEdit: boolean;
  /**
   * Jump to the workspace that owns the bound plan. The host page maps
   * 'MEDICATION' → 用药计划 workspace, 'VITAL' → 指标监测 workspace, and
   * auto-expands the matching plan's inline edit form.
   */
  onNavigateToSource?: (sourceType: string, sourceId: string | null) => void;
};

export default function CareRemindersPanel({ patientId, canEdit, onNavigateToSource }: Props) {
  const [schedules, setSchedules] = useState<CareReminderSchedule[]>([]);
  const [occurrences, setOccurrences] = useState<CareReminderOccurrence[]>([]);
  const [messages, setMessages] = useState<PatientDirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  // 未完成 / 已升级（最近 20 条）。v3.3: 移除了「今日提醒」板块，避免与长期提醒重复。
  const missed = useMemo(
    () =>
      occurrences
        .filter((o) => o.status === 'MISSED' || o.status === 'ESCALATED')
        .sort((a, b) => +new Date(b.dueAt) - +new Date(a.dueAt))
        .slice(0, 20),
    [occurrences],
  );

  if (loading)
    return (
      <div className="pe-admin-tab">
        <p className="pe-admin-muted">载入中…</p>
      </div>
    );

  return (
    <div className="pe-admin-tab">
      {err && <div className="pe-admin-banner pe-admin-banner-error">{err}</div>}
      {notice && <div className="pe-admin-banner pe-admin-banner-ok">{notice}</div>}

      <SchedulesSection schedules={schedules} onNavigateToSource={onNavigateToSource} />

      <MissedSection items={missed} />

      <DirectMessageComposer patientId={patientId} canEdit={canEdit} onSent={refresh} setNotice={setNotice} />

      <MessagesSection items={messages} />
    </div>
  );
}

// ===========================================================================
// sub-sections
// ===========================================================================

/**
 * v3.3: long-term reminders are a READ-ONLY view of the bound MedicationRecord /
 * VitalMonitoringPlan. No add / cancel / pause here — the source plan is the only
 * place to change times, frequency, or active state. The only action is jumping
 * to the owning plan to view/edit it.
 */
function SchedulesSection({
  schedules,
  onNavigateToSource,
}: {
  schedules: CareReminderSchedule[];
  onNavigateToSource?: (sourceType: string, sourceId: string | null) => void;
}) {
  return (
    <section className="pe-admin-messages">
      <div className="pe-admin-section-head pe-admin-section-head-with-copy">
        <div>
          <h3>长期提醒计划</h3>
          <p className="pe-admin-muted">
            提醒计划由用药计划和指标监测计划自动生成。按类型和具体项目展开查看；修改频次、时间或启停状态时，请进入对应计划板块。
          </p>
        </div>
      </div>
      <GroupedCareReminderSchedules schedules={schedules} onNavigateToSource={onNavigateToSource} />
    </section>
  );
}

function MissedSection({ items }: { items: CareReminderOccurrence[] }) {
  return (
    <section className="pe-admin-messages">
      <div className="pe-admin-section-head pe-admin-section-head-with-copy">
        <div>
          <h3>未完成 / 已升级</h3>
          <p className="pe-admin-muted">最近 20 条需要关注的提醒。点击类型或子类型可展开和收起。</p>
        </div>
      </div>
      <GroupedCareReminderOccurrences rows={items} />
    </section>
  );
}

function DirectMessageComposer({
  patientId,
  canEdit,
  onSent,
  setNotice,
}: {
  patientId: string;
  canEdit: boolean;
  onSent: () => void;
  setNotice: (s: string | null) => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<'NORMAL' | 'IMPORTANT' | 'URGENT'>('NORMAL');
  const [requiresAck, setRequiresAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!canEdit) return null;

  function reset() {
    setTitle('');
    setContent('');
    setRequiresAck(false);
    setPriority('NORMAL');
    setErr(null);
  }

  async function submit() {
    setErr(null);
    if (!title.trim() || !content.trim()) {
      setErr('标题和内容不能为空');
      return;
    }
    try {
      setBusy(true);
      await createDirectMessage(patientId, { title, content, priority, requiresAck });
      reset();
      setNotice('已发送消息。');
      onSent();
    } catch (e: any) {
      setErr(e?.message || '发送失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pe-admin-messages">
      <h3>给患者发送一条消息</h3>
      <div className="pe-admin-compose-grid">
        <label className="pe-admin-field">
          <span>标题</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：复诊提醒" />
        </label>
        <label className="pe-admin-field">
          <span>正文（患者会看到）</span>
          <textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder="请输入要发送给患者的内容" />
        </label>
        <div className="pe-admin-field-row">
          <label className="pe-admin-field">
            <span>优先级</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value as any)}>
              <option value="NORMAL">普通</option>
              <option value="IMPORTANT">重要</option>
              <option value="URGENT">紧急</option>
            </select>
          </label>
          <label className="pe-admin-checkbox">
            <input type="checkbox" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} />
            <span>要求患者确认收到</span>
          </label>
        </div>
        {err && <p className="pe-admin-error">{err}</p>}
        <div className="pe-admin-button-row">
          <button type="button" className="pe-admin-secondary" disabled={busy} onClick={reset}>
            重置
          </button>
          <button type="button" className="pe-admin-primary" disabled={busy} onClick={submit}>
            {busy ? '发送中…' : '发送消息'}
          </button>
        </div>
      </div>
    </section>
  );
}

function MessagesSection({ items }: { items: PatientDirectMessage[] }) {
  return (
    <section className="pe-admin-messages">
      <h3>历史触达消息</h3>
      {items.length === 0 ? (
        <p className="pe-admin-muted">暂无。</p>
      ) : (
        <table className="pe-admin-messages-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>标题</th>
              <th>优先级</th>
              <th>渠道</th>
              <th>状态</th>
              <th>要确认</th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id}>
                <td>{fmtDateTime(m.createdAt)}</td>
                <td>{m.title}</td>
                <td>{priorityLabel(m.priority)}</td>
                <td>{channelLabel(m.channel)}</td>
                <td>{directStatusLabel(m.status)}</td>
                <td>{m.requiresAck ? '是' : '否'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ===========================================================================
// helpers
// ===========================================================================

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString('zh-CN', { hour12: false });
}

function priorityLabel(p?: string): string {
  switch (p) {
    case 'NORMAL':
      return '普通';
    case 'IMPORTANT':
      return '重要';
    case 'URGENT':
      return '紧急';
    default:
      return p || '—';
  }
}

function channelLabel(c?: string): string {
  switch (c) {
    case 'WECHAT_OFFICIAL_ACCOUNT':
      return '本院服务号';
    case 'SMS':
      return '短信';
    case 'MANUAL_COPY':
      return '手动复制';
    default:
      return c || '—';
  }
}

function directStatusLabel(s?: string): string {
  switch (s) {
    case 'PENDING':
      return '待发送';
    case 'SENT':
      return '已发送';
    case 'CLICKED':
      return '已打开';
    case 'ACKNOWLEDGED':
      return '已确认';
    case 'FAILED':
      return '发送失败';
    default:
      return s || '—';
  }
}



