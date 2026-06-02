import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createDirectMessage,
  listDirectMessages,
  listOccurrencesForPatient,
  listSchedulesForPatient,
  type CareReminderOccurrence,
  type CareReminderSchedule,
  type PatientDirectMessage,
} from '../api/care-reminders';
import { EntityName } from './EntityName';
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
  // Only show plan-bound reminders (MEDICATION / VITAL); other kinds, if any,
  // are not part of the source-bound view.
  const bound = schedules.filter((s) => s.sourceType === 'MEDICATION' || s.sourceType === 'VITAL');
  return (
    <section className="pe-admin-messages">
      <h3>长期提醒计划</h3>
      <p className="pe-admin-muted" style={{ lineHeight: 1.6 }}>
        提醒计划由用药计划和指标监测计划自动生成。本页只展示提醒触达配置；如需修改频次、时间或停用，请进入对应计划板块。
      </p>
      {bound.length === 0 ? (
        <p className="pe-admin-muted">暂无长期提醒。请先在用药计划或指标监测板块创建启用计划。</p>
      ) : (
        <table className="pe-admin-messages-table">
          <thead>
            <tr>
              <th>类型</th>
              <th>绑定来源</th>
              <th>来源名称</th>
              <th>频率</th>
              <th>提醒时间</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {bound.map((s) => (
              <tr key={s.id}>
                <td>{labelOfReminderType(s.reminderType)}</td>
                <td>{labelOfSourceType(s.sourceType)}</td>
                <td>{sourceNameNode(s)}</td>
                <td>{frequencyText(s)}</td>
                <td>{scheduledTimesText(s)}</td>
                <td>
                  <span className={`pe-admin-status pe-admin-status-${s.isActive ? 'sent' : 'pending'}`}>
                    {s.isActive ? '跟随来源计划启用' : '跟随来源计划停用'}
                  </span>
                </td>
                <td className="pe-admin-actions-cell">
                  <button
                    type="button"
                    className="pe-admin-secondary"
                    onClick={() => onNavigateToSource?.(s.sourceType, s.sourceId)}
                    title="跳转到对应计划板块，并自动展开该计划的修改表单"
                  >
                    {s.sourceType === 'MEDICATION' ? '查看 / 修改用药计划' : '查看 / 修改指标监测'}
                  </button>
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
    <section className="pe-admin-messages">
      <h3>未完成 / 已升级</h3>
      {items.length === 0 ? (
        <p className="pe-admin-muted">没有遗漏。</p>
      ) : (
        <table className="pe-admin-messages-table">
          <thead>
            <tr>
              <th>计划时间</th>
              <th>提醒</th>
              <th>状态</th>
              <th>护士 Task</th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id}>
                <td>{fmtDateTime(o.dueAt)}</td>
                <td>{o.title}</td>
                <td>
                  <StatusBadge status={o.status} />
                </td>
                <td>{o.escalatedTaskId || '—'}</td>
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

function StatusBadge({ status }: { status: string }) {
  // Map care-reminder occurrence states onto the shared pe-admin status chips.
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

/** Reminder times for a schedule — prefer the reconciled source-plan times. */
function scheduledTimesText(s: CareReminderSchedule): string {
  const times =
    (s.sourceSummary?.scheduledTimes && s.sourceSummary.scheduledTimes.length
      ? s.sourceSummary.scheduledTimes
      : s.scheduledTimes) || [];
  return times.length ? times.join('、') : '—';
}

/** Frequency text e.g. 每日 2 次 / 每周 3 次, from the source plan when available. */
function frequencyText(s: CareReminderSchedule): string {
  const unit = s.sourceSummary?.frequencyUnit || s.frequencyUnit || 'DAY';
  const times = s.sourceSummary?.timesPerUnit ?? s.timesPerUnit ?? 1;
  const unitLabel = unit === 'WEEK' ? '每周' : unit === 'MONTH' ? '每月' : '每日';
  return `${unitLabel} ${times} 次`;
}

function labelOfReminderType(t: string): string {
  switch (t) {
    case 'MEDICATION_CHECKIN':
      return '用药提醒';
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

function labelOfSourceType(t: string): string {
  switch (t) {
    case 'MEDICATION':
      return '用药计划';
    case 'VITAL':
      return '指标监测计划';
    case 'QUESTIONNAIRE':
      return '问卷计划';
    case 'FOLLOW_UP':
      return '随访计划';
    case 'MANUAL_MESSAGE':
      return '手动消息';
    default:
      return t;
  }
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

/**
 * Render the proper-name part (药品名 / 指标名) as a colored EntityName chip to
 * match the medication / monitoring tabs, always localizing a raw vitalType enum
 * (e.g. BLOOD_PRESSURE -> 血压（收缩压/舒张压）) so it never leaks.
 */
function sourceNameNode(s: CareReminderSchedule): ReactNode {
  const payload = (s.payload || {}) as Record<string, unknown>;

  if (s.sourceType === 'MEDICATION') {
    const summaryTitle = s.sourceSummary?.title;
    const name = summaryTitle || (payload.medicationName as string) || '用药计划';
    const subtitle =
      s.sourceSummary?.subtitle ?? ((payload.dosage as string | undefined) || null);
    return (
      <span className="pe-admin-source-name">
        <EntityName kind="medication">{name}</EntityName>
        {subtitle ? <span className="pe-admin-muted"> · {subtitle}</span> : null}
      </span>
    );
  }

  if (s.sourceType === 'VITAL') {
    // Localize whether the title came from the summary or the payload enum.
    const rawTitle = s.sourceSummary?.title || (payload.vitalType as string | undefined);
    const name = localizeVital(rawTitle);
    const subtitle = s.sourceSummary?.subtitle ?? null;
    return (
      <span className="pe-admin-source-name">
        <EntityName kind="vital">{name}</EntityName>
        {subtitle ? <span className="pe-admin-muted"> · {subtitle}</span> : null}
      </span>
    );
  }

  return <span>{s.title || '—'}</span>;
}

/** Map a vital indicator name OR raw enum to a friendly Chinese label. */
function localizeVital(value?: string): string {
  if (!value) return '指标';
  const map: Record<string, string> = {
    BLOOD_PRESSURE: '血压（收缩压/舒张压）',
    BLOOD_GLUCOSE: '血糖',
    WEIGHT: '体重',
    HEART_RATE: '心率',
    SPO2: '血氧',
    TEMPERATURE: '体温',
  };
  return map[value] || value;
}
