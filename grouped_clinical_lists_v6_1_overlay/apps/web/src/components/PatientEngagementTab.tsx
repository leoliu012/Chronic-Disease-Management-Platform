/**
 * PatientEngagementTab (v3.2)
 * ---------------------------
 * 患者档案 → 微信随访 tab.
 *   1) 触达概览卡
 *   2) 快捷发送 (问卷 / 复测 / 用药打卡 / 发送到院随访)
 *   3) 发送弹窗
 *   4) 历史随访案件: 每行是一个"案件"(PatientOutboundMessage), 不是每次发送尝试.
 *      - 可按状态 / 类型 / 创建时间范围筛选, 分页
 *      - 发送方式 summary (本院服务号 / 短信 / 两者), 失败有显眼提示
 *      - 操作: 查看详情 / 复制链接 / 再次发送 / 使链接失效
 *   5) 详情抽屉: 基本信息 + 发送尝试 timeline + 患者填写内容 + 链接状态 + 操作
 *
 * v3.2 去掉了按渠道改发、人工标记发送等工程化操作（仅保留再次发送）; 原“撤销”改为“使链接失效”.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  type ContactSummary,
  type OutboundMessage,
  type MessageDetail,
  type MessageSubmission,
  type CreateLinkResponse,
  type PreferredChannel,
  type MessageListFilters,
  createHospitalVisitLink,
  createMedicationCheckinLink,
  createQuestionnaireLink,
  createVitalRecheckLink,
  fetchContactSummary,
  fetchMessages,
  fetchMessageDetail,
  invalidateFormLink,
  resendMessage,
} from '../api/patient-engagement';
import { getApiErrorMessage } from '../api/client';
import { EntityName } from './EntityName';
import '../patient-engagement-admin-tab.css';

type LinkType = 'QUESTIONNAIRE' | 'VITAL_RECHECK' | 'MEDICATION_CHECKIN' | 'HOSPITAL_VISIT_CONFIRM';

type ComposeState =
  | { kind: 'closed' }
  | {
      kind: 'open';
      linkType: LinkType;
      title: string;
      description: string;
      expiresInHours: number;
      preferredChannel: PreferredChannel;
      requiresIdentityCheck: boolean;
      questionnaireType?: string;
      vitalType?: string;
      medicationId?: string;
      reason?: string;
      taskId?: string;
      riskAlertId?: string;
    };

type Toast = { kind: 'success' | 'error'; message: string } | null;

const CHANNEL_LABEL: Record<string, string> = {
  WECHAT_OFFICIAL_ACCOUNT: '本院服务号',
  SMS: '短信',
  MANUAL_COPY: '手动复制',
  AUTO: '自动选择',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: '待发送',
  SENT: '已发送',
  CLICKED: '已打开',
  SUBMITTED: '已提交',
  FAILED: '发送失败',
  CANCELED: '已失效',
};

const MSGTYPE_LABEL: Record<string, string> = {
  QUESTIONNAIRE_REMINDER: '随访问卷',
  VITAL_RECHECK_REMINDER: '指标打卡',
  MEDICATION_REMINDER: '服药提醒',
  HOSPITAL_VISIT_REMINDER: '到院随访',
};

const FORMLINK_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '生效中',
  USED: '已提交',
  EXPIRED: '已过期',
  REVOKED: '已失效',
};

// status / type filter options (value '' = 全部)
const STATUS_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部' },
  { value: 'PENDING', label: '待发送' },
  { value: 'SENT', label: '已发送' },
  { value: 'CLICKED', label: '已打开' },
  { value: 'SUBMITTED', label: '已提交' },
  { value: 'FAILED', label: '发送失败' },
  { value: 'CANCELED', label: '已失效' },
];

const TYPE_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部' },
  { value: 'QUESTIONNAIRE_REMINDER', label: '随访问卷' },
  { value: 'VITAL_RECHECK_REMINDER', label: '指标打卡' },
  { value: 'MEDICATION_REMINDER', label: '服药提醒' },
  { value: 'HOSPITAL_VISIT_REMINDER', label: '到院随访' },
];

const PAGE_SIZE = 20;

type PatientEngagementTabProps = {
  patientId: string;
  medications?: Array<{ id: string; medicationName: string; dosage?: string; frequency?: string }>;
  hospitalVisitReminders?: Array<{ id: string; title?: string; reason?: string }>;
};

type Filters = {
  status: string;
  messageType: string;
  from: string; // yyyy-mm-dd (input[type=date])
  to: string;
};

const EMPTY_FILTERS: Filters = { status: '', messageType: '', from: '', to: '' };

export function PatientEngagementTab(props: PatientEngagementTabProps) {
  const { patientId } = props;
  const [summary, setSummary] = useState<ContactSummary | null>(null);
  const [messages, setMessages] = useState<OutboundMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeState>({ kind: 'closed' });
  const [lastCreated, setLastCreated] = useState<CreateLinkResponse | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // active (applied) filters vs the draft in the filter bar
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);

  // detail drawer
  const [detailId, setDetailId] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      const s = await fetchContactSummary(patientId);
      setSummary(s);
    } catch (err) {
      setError(getApiErrorMessage(err, '加载患者触达信息失败'));
    }
  }, [patientId]);

  const loadMessages = useCallback(
    async (nextPage: number, applied: Filters) => {
      setLoading(true);
      setError(null);
      try {
        const query: MessageListFilters = {
          patientId,
          page: nextPage,
          pageSize: PAGE_SIZE,
          status: applied.status || undefined,
          messageType: applied.messageType || undefined,
          from: applied.from || undefined,
          to: applied.to || undefined,
        };
        const res = await fetchMessages(query);
        setMessages(res.items);
        setTotal(res.total);
        setPage(res.page);
      } catch (err) {
        setError(getApiErrorMessage(err, '加载随访记录失败'));
      } finally {
        setLoading(false);
      }
    },
    [patientId],
  );

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadMessages(1, EMPTY_FILTERS);
  }, [loadMessages]);

  function flashSuccess(message: string) {
    setToast({ kind: 'success', message });
    window.setTimeout(() => setToast(null), 3000);
  }
  function flashError(message: string) {
    setToast({ kind: 'error', message });
    window.setTimeout(() => setToast(null), 4000);
  }

  const reloadCurrent = useCallback(async () => {
    await Promise.all([loadSummary(), loadMessages(page, filters)]);
  }, [loadSummary, loadMessages, page, filters]);

  function openCompose(linkType: LinkType, prefill?: Partial<Extract<ComposeState, { kind: 'open' }>>) {
    const defaults: ComposeState = {
      kind: 'open',
      linkType,
      title: defaultTitleFor(linkType),
      description: '',
      expiresInHours: 72,
      preferredChannel: 'AUTO',
      requiresIdentityCheck: linkType !== 'QUESTIONNAIRE',
      questionnaireType: linkType === 'QUESTIONNAIRE' ? (prefill?.questionnaireType || 'HYPERTENSION_FOLLOWUP') : undefined,
      vitalType: linkType === 'VITAL_RECHECK' ? (prefill?.vitalType || 'BLOOD_PRESSURE') : undefined,
      medicationId: linkType === 'MEDICATION_CHECKIN' ? (prefill?.medicationId || props.medications?.[0]?.id) : undefined,
      reason: linkType === 'HOSPITAL_VISIT_CONFIRM' ? (prefill?.reason || '') : undefined,
      ...prefill,
    };
    setCompose(defaults);
    setLastCreated(null);
  }

  async function handleSubmit(send: boolean) {
    if (compose.kind !== 'open') return;
    const c = compose;
    const baseInput = {
      title: c.title || undefined,
      description: c.description || undefined,
      expiresInHours: c.expiresInHours,
      preferredChannel: c.preferredChannel,
      requiresIdentityCheck: c.requiresIdentityCheck,
      send,
      taskId: c.taskId || undefined,
      riskAlertId: c.riskAlertId || undefined,
    };
    try {
      let res: CreateLinkResponse;
      if (c.linkType === 'QUESTIONNAIRE') {
        res = await createQuestionnaireLink(patientId, { ...baseInput, questionnaireType: c.questionnaireType || 'GENERIC' });
      } else if (c.linkType === 'VITAL_RECHECK') {
        res = await createVitalRecheckLink(patientId, { ...baseInput, vitalType: c.vitalType || 'BLOOD_PRESSURE' });
      } else if (c.linkType === 'MEDICATION_CHECKIN') {
        if (!c.medicationId) {
          flashError('请选择用药计划');
          return;
        }
        res = await createMedicationCheckinLink(patientId, { ...baseInput, medicationId: c.medicationId });
      } else {
        res = await createHospitalVisitLink(patientId, { ...baseInput, reason: c.reason || '请到医院随访' });
      }
      setLastCreated(res);
      setCompose({ kind: 'closed' });
      flashSuccess(send ? '链接已创建并触发发送（可在下方记录查看发送状态）' : '链接已创建，可复制后再发送');
      // jump back to first page so the new case is visible
      await loadMessages(1, filters);
    } catch (err) {
      flashError(getApiErrorMessage(err, '创建链接失败'));
    }
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      flashSuccess('链接已复制到剪贴板');
    } catch {
      window.prompt('请手动复制以下链接', url);
    }
  }

  async function handleResend(message: OutboundMessage) {
    setBusyId(message.id);
    try {
      // AUTO: backend re-picks 本院服务号, 自动短信兜底.
      const res: any = await resendMessage(message.id, 'AUTO');
      const fellBack = res?.fallbackUsed || res?.message?.deliverySummary?.wechat === 'FAILED';
      flashSuccess(fellBack ? '已再次发送（本院服务号失败，已通过短信发送）' : '已再次发送');
      await reloadCurrent();
    } catch (err) {
      flashError(getApiErrorMessage(err, '再次发送失败'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleInvalidate(message: OutboundMessage) {
    if (!message.formLink) return;
    const reason = window.prompt('请填写使链接失效的原因（患者打开链接时会看到）');
    if (reason === null) return;
    if (!reason.trim()) {
      flashError('请填写失效原因');
      return;
    }
    setBusyId(message.id);
    try {
      await invalidateFormLink(message.formLink.id, reason.trim());
      flashSuccess('已使该链接失效');
      await reloadCurrent();
    } catch (err) {
      flashError(getApiErrorMessage(err, '操作失败'));
    } finally {
      setBusyId(null);
    }
  }

  function applyFilters() {
    setFilters(draft);
    void loadMessages(1, draft);
  }
  function resetFilters() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    void loadMessages(1, EMPTY_FILTERS);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="pe-admin-tab">
      <ContactSummaryCard summary={summary} loading={loading && !summary} error={error} />

      <QuickActions
        onSelect={(t) => openCompose(t)}
        hasMedications={Boolean(props.medications && props.medications.length)}
        hasHospitalVisitReminders={Boolean(props.hospitalVisitReminders && props.hospitalVisitReminders.length)}
      />

      {lastCreated && (
        <LastCreatedPanel
          response={lastCreated}
          onCopy={() => handleCopy(lastCreated.linkUrl)}
          onClose={() => setLastCreated(null)}
        />
      )}

      <MessagesSection
        messages={messages}
        loading={loading}
        total={total}
        page={page}
        totalPages={totalPages}
        busyId={busyId}
        draft={draft}
        onDraftChange={(patch) => setDraft({ ...draft, ...patch })}
        onApply={applyFilters}
        onReset={resetFilters}
        onPage={(p) => void loadMessages(p, filters)}
        onCopy={(url) => void handleCopy(url)}
        onResend={(m) => void handleResend(m)}
        onInvalidate={(m) => void handleInvalidate(m)}
        onViewDetail={(m) => setDetailId(m.id)}
      />

      {compose.kind === 'open' && (
        <ComposeModal
          state={compose}
          medications={props.medications || []}
          hospitalVisitReminders={props.hospitalVisitReminders || []}
          recommendedChannel={summary?.recommendedChannel}
          onChange={(next) => setCompose({ ...compose, ...next })}
          onCancel={() => setCompose({ kind: 'closed' })}
          onSaveOnly={() => void handleSubmit(false)}
          onSaveAndSend={() => void handleSubmit(true)}
        />
      )}

      {detailId && (
        <MessageDetailDrawer
          messageId={detailId}
          onClose={() => setDetailId(null)}
          onCopy={(url) => void handleCopy(url)}
          onResend={async (m) => {
            await handleResend(m);
          }}
          onInvalidate={async (m) => {
            await handleInvalidate(m);
            setDetailId(null);
          }}
        />
      )}

      {toast && (
        <div className={toast.kind === 'success' ? 'pe-admin-toast success' : 'pe-admin-toast error'}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// summary card
// ============================================================================

function ContactSummaryCard({
  summary,
  loading,
  error,
}: {
  summary: ContactSummary | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="pe-admin-summary-card">
      <h3>触达概览</h3>
      {loading && !summary && <p className="pe-admin-muted">加载中…</p>}
      {error && <p className="pe-admin-error">{error}</p>}
      {summary && (
        <div className="pe-admin-summary-grid">
          <div>
            <label>手机号</label>
            <strong>{summary.maskedPhone || '未登记'}</strong>
          </div>
          <div>
            <label>本院服务号关注</label>
            <strong className={summary.hasOpenId ? 'pe-admin-pos' : 'pe-admin-neg'}>
              {summary.hasOpenId ? '已关注' : summary.hospitalServiceAccountConfigured ? '未关注' : '本院未配置'}
            </strong>
            {summary.hospitalDisplayName && <small className="pe-admin-muted">{summary.hospitalDisplayName}</small>}
          </div>
          <div>
            <label>推荐通道</label>
            <strong>{CHANNEL_LABEL[summary.recommendedChannel] || summary.recommendedChannel}</strong>
          </div>
          <div>
            <label>最近一次发送</label>
            <strong>
              {summary.lastMessage
                ? `${MSGTYPE_LABEL[summary.lastMessage.messageType] || summary.lastMessage.messageType} · ${STATUS_LABEL[summary.lastMessage.status] || summary.lastMessage.status}`
                : '暂无'}
            </strong>
            {summary.lastMessage?.sentAt && (
              <small>{new Date(summary.lastMessage.sentAt).toLocaleString('zh-CN', { hour12: false })}</small>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ============================================================================
// quick actions
// ============================================================================

function QuickActions({
  onSelect,
  hasMedications,
  hasHospitalVisitReminders,
}: {
  onSelect: (t: LinkType) => void;
  hasMedications: boolean;
  hasHospitalVisitReminders: boolean;
}) {
  return (
    <section className="pe-admin-actions">
      <h3>快捷发送</h3>
      <div className="pe-admin-actions-grid">
        <ActionButton title="发送随访问卷" hint="问卷类任务，可选身份校验" onClick={() => onSelect('QUESTIONNAIRE')} />
        <ActionButton title="发送指标打卡提醒" hint="自动触发风险评估" onClick={() => onSelect('VITAL_RECHECK')} />
        <ActionButton title="发送服药提醒" hint={hasMedications ? '从已有用药计划中选择' : '该患者暂无用药计划'} disabled={!hasMedications} onClick={() => onSelect('MEDICATION_CHECKIN')} />
        <ActionButton title="发送到院随访" hint={hasHospitalVisitReminders ? '可关联已有到院提醒' : '可独立发送'} onClick={() => onSelect('HOSPITAL_VISIT_CONFIRM')} />
      </div>
    </section>
  );
}

function ActionButton({ title, hint, onClick, disabled }: { title: string; hint: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="pe-admin-action-button" disabled={disabled} onClick={onClick}>
      <strong>{title}</strong>
      <small>{hint}</small>
    </button>
  );
}

// ============================================================================
// last created panel
// ============================================================================

function LastCreatedPanel({
  response,
  onCopy,
  onClose,
}: {
  response: CreateLinkResponse;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <section className="pe-admin-last-created">
      <h3>最近创建的链接</h3>
      <p className="pe-admin-muted">{response.formLink.title}</p>
      <div className="pe-admin-link-row">
        <input readOnly value={response.linkUrl} onClick={(e) => e.currentTarget.select()} />
        <button type="button" className="pe-admin-secondary" onClick={onCopy}>复制链接</button>
      </div>
      {response.sendResult && (
        <p className={response.sendResult.status === 'SENT' ? 'pe-admin-pos' : 'pe-admin-neg'}>
          自动发送 ({CHANNEL_LABEL[response.sendResult.channel] || response.sendResult.channel})：{STATUS_LABEL[response.sendResult.status] || response.sendResult.status}
          {response.sendResult.errorMessage ? ` — ${response.sendResult.errorMessage}` : ''}
        </p>
      )}
      <button type="button" className="pe-admin-link-button" onClick={onClose}>收起</button>
    </section>
  );
}

// ============================================================================
// delivery summary chip(s)
// ============================================================================

function DeliveryCell({ message }: { message: OutboundMessage }) {
  const ds = message.deliverySummary || null;
  // Build per-channel status from deliverySummary; fall back to the message channel.
  const entries: Array<{ channel: string; status: string | null }> = [];
  if (ds && ds.channels && ds.channels.length) {
    for (const ch of ds.channels) {
      entries.push({ channel: ch, status: ch === 'WECHAT_OFFICIAL_ACCOUNT' ? ds.wechat ?? null : ch === 'SMS' ? ds.sms ?? null : null });
    }
  } else if (message.channel && message.channel !== 'MANUAL_COPY') {
    entries.push({ channel: message.channel, status: message.status === 'FAILED' ? 'FAILED' : 'SENT' });
  }

  if (!entries.length) return <span className="pe-admin-muted">仅生成链接</span>;

  return (
    <div className="pe-admin-delivery">
      {entries.map((e) => (
        <span
          key={e.channel}
          className={`pe-admin-chip ${e.status === 'FAILED' ? 'pe-admin-chip-fail' : 'pe-admin-chip-ok'}`}
          title={e.status === 'FAILED' ? `${CHANNEL_LABEL[e.channel] || e.channel}失败` : `${CHANNEL_LABEL[e.channel] || e.channel}已发送`}
        >
          {CHANNEL_LABEL[e.channel] || e.channel}
          {e.status === 'FAILED' ? ' · 失败' : ''}
        </span>
      ))}
    </div>
  );
}

// ============================================================================
 // messages section (filter bar + grouped lists + pagination)
 // ============================================================================

type MessagesSectionProps = {
  messages: OutboundMessage[];
  loading: boolean;
  total: number;
  page: number;
  totalPages: number;
  busyId: string | null;
  draft: Filters;
  onDraftChange: (patch: Partial<Filters>) => void;
  onApply: () => void;
  onReset: () => void;
  onPage: (p: number) => void;
  onCopy: (url: string) => void;
  onResend: (m: OutboundMessage) => void;
  onInvalidate: (m: OutboundMessage) => void;
  onViewDetail: (m: OutboundMessage) => void;
};

type MessageGroup = {
  key: string;
  label: string;
  hint: string;
  subgroups: Array<{ key: string; label: string; items: OutboundMessage[] }>;
  total: number;
};

const MESSAGE_GROUP_ORDER = [
  'MEDICATION_REMINDER',
  'VITAL_RECHECK_REMINDER',
  'QUESTIONNAIRE_REMINDER',
  'HOSPITAL_VISIT_REMINDER',
  'OTHER',
] as const;

function MessagesSection(props: MessagesSectionProps) {
  const { messages, loading, draft } = props;
  return (
    <section className="pe-admin-messages">
      <div className="pe-admin-section-head pe-admin-section-head-with-copy">
        <div>
          <h3>历史随访记录</h3>
          <p className="pe-admin-muted">按随访类型和具体事项归类展示。点击类型或子类型可展开和收起。</p>
        </div>
      </div>

      <div className="pe-admin-filter-bar">
        <label className="pe-admin-filter-field">
          <span>状态</span>
          <select value={draft.status} onChange={(e) => props.onDraftChange({ status: e.target.value })}>
            {STATUS_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="pe-admin-filter-field">
          <span>类型</span>
          <select value={draft.messageType} onChange={(e) => props.onDraftChange({ messageType: e.target.value })}>
            {TYPE_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="pe-admin-filter-field">
          <span>创建时间从</span>
          <input type="date" value={draft.from} onChange={(e) => props.onDraftChange({ from: e.target.value })} />
        </label>
        <label className="pe-admin-filter-field">
          <span>创建时间至</span>
          <input type="date" value={draft.to} onChange={(e) => props.onDraftChange({ to: e.target.value })} />
        </label>
        <div className="pe-admin-filter-actions">
          <button type="button" className="pe-admin-primary" onClick={props.onApply}>查询</button>
          <button type="button" className="pe-admin-link-button" onClick={props.onReset}>重置</button>
        </div>
      </div>

      {loading && !messages.length ? (
        <p className="pe-admin-muted">加载中…</p>
      ) : !messages.length ? (
        <p className="pe-admin-muted">没有符合条件的随访记录。</p>
      ) : (
        <>
          <GroupedMessagesTable {...props} />
          <div className="pe-admin-pagination">
            <span className="pe-admin-muted">共 {props.total} 条 · 第 {props.page}/{props.totalPages} 页</span>
            <div>
              <button type="button" className="pe-admin-secondary" disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)}>上一页</button>
              <button type="button" className="pe-admin-secondary" disabled={props.page >= props.totalPages} onClick={() => props.onPage(props.page + 1)}>下一页</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function GroupedMessagesTable(props: MessagesSectionProps) {
  const groups = groupMessages(props.messages);
  return (
    <div className="pe-clinical-group-list">
      {groups.map((group) => (
        <MessageTypeGroup key={group.key} group={group} props={props} />
      ))}
    </div>
  );
}

function MessageTypeGroup({ group, props }: { group: MessageGroup; props: MessagesSectionProps }) {
  const [open, setOpen] = useState(true);
  return (
    <details className="pe-clinical-group" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="pe-clinical-group-summary">
        <span className="pe-clinical-caret" aria-hidden="true">›</span>
        <span className={`pe-clinical-type-mark pe-clinical-type-mark-${messageGroupTone(group.key)}`} aria-hidden="true" />
        <span className="pe-clinical-group-title-wrap">
          <strong>{group.label}</strong>
          <small>{group.hint}</small>
        </span>
        <span className="pe-clinical-count">{group.total} 条</span>
      </summary>
      <div className="pe-clinical-subgroup-list">
        {group.subgroups.map((subgroup) => (
          <MessageSubgroup key={subgroup.key} label={subgroup.label} items={subgroup.items} props={props} />
        ))}
      </div>
    </details>
  );
}

function MessageSubgroup({
  label,
  items,
  props,
}: {
  label: string;
  items: OutboundMessage[];
  props: MessagesSectionProps;
}) {
  const [open, setOpen] = useState(items.length <= 5);
  return (
    <details
      className={`pe-clinical-subgroup pe-clinical-subgroup-${messageGroupTone(items[0]?.messageType || 'OTHER')}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="pe-clinical-subgroup-summary">
        <span className="pe-clinical-caret" aria-hidden="true">›</span>
        <span className="pe-clinical-subgroup-name">
          <EntityName kind={entityKindForMessage(items[0])}>{label}</EntityName>
        </span>
        <span className="pe-clinical-summary-statuses">{messageSummaryBadges(items)}</span>
        <span className="pe-clinical-count">{items.length} 条</span>
      </summary>
      <div className="pe-admin-table-wrap">
        <table className="pe-admin-messages-table pe-clinical-table">
          <thead>
            <tr>
              <th>创建时间</th>
              <th>随访事项</th>
              <th>状态</th>
              <th>发送方式</th>
              <th>患者反馈</th>
              <th>链接状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((message) => {
              const linkActive = message.formLink?.status === 'ACTIVE';
              const completed = message.status === 'SUBMITTED' || message.formLink?.status === 'USED';
              return (
                <tr key={message.id}>
                  <td>{new Date(message.createdAt).toLocaleString('zh-CN', { hour12: false })}</td>
                  <td>
                    <div className="pe-clinical-row-heading">
                      <EntityName kind={entityKindForMessage(message)}>{label}</EntityName>
                      <span className="pe-clinical-row-context">{messageItemContext(message.messageType)}</span>
                    </div>
                    {supportingMessageTitle(message.title, label) ? (
                      <small className="pe-clinical-row-supporting">{supportingMessageTitle(message.title, label)}</small>
                    ) : null}
                  </td>
                  <td><MessageStatusBadge status={message.status} /></td>
                  <td><DeliveryCell message={message} /></td>
                  <td>{patientFeedbackText(message)}</td>
                  <td><FormLinkStatusBadge status={message.formLink?.status || ''} /></td>
                  <td className="pe-admin-actions-cell">
                    <button type="button" className="pe-admin-secondary" onClick={() => props.onViewDetail(message)}>查看详情</button>
                    {message.linkUrl ? <button type="button" className="pe-admin-secondary" onClick={() => props.onCopy(message.linkUrl!)}>复制链接</button> : null}
                    {linkActive && !completed ? (
                      <>
                        <button type="button" className="pe-admin-secondary" disabled={props.busyId === message.id} onClick={() => props.onResend(message)}>再次发送</button>
                        <button type="button" className="pe-admin-danger" disabled={props.busyId === message.id} onClick={() => props.onInvalidate(message)}>使链接失效</button>
                      </>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function messageItemContext(messageType: string): string {
  if (messageType === 'MEDICATION_REMINDER') return '服药提醒';
  if (messageType === 'VITAL_RECHECK_REMINDER') return '指标打卡';
  if (messageType === 'QUESTIONNAIRE_REMINDER') return '随访问卷';
  if (messageType === 'HOSPITAL_VISIT_REMINDER') return '到院随访';
  return '随访事项';
}

function supportingMessageTitle(title: string | null | undefined, entityName: string): string | null {
  const value = textValue(title);
  if (!value || value === entityName || value.includes(entityName)) return null;
  return value;
}

function groupMessages(messages: OutboundMessage[]): MessageGroup[] {
  const grouped = new Map<string, Map<string, OutboundMessage[]>>();
  for (const message of messages) {
    const groupKey = MESSAGE_GROUP_ORDER.includes(message.messageType as (typeof MESSAGE_GROUP_ORDER)[number])
      ? message.messageType
      : 'OTHER';
    const subgroupLabel = messageSubgroupLabel(message);
    const subgroups = grouped.get(groupKey) ?? new Map<string, OutboundMessage[]>();
    const rows = subgroups.get(subgroupLabel) ?? [];
    rows.push(message);
    subgroups.set(subgroupLabel, rows);
    grouped.set(groupKey, subgroups);
  }

  return MESSAGE_GROUP_ORDER.flatMap((key) => {
    const subgroups = grouped.get(key);
    if (!subgroups) return [];
    const meta = messageGroupMeta(key);
    const values = [...subgroups.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
      .map(([label, items]) => ({ key: `${key}:${label}`, label, items }));
    return [{ key, label: meta.label, hint: meta.hint, subgroups: values, total: values.reduce((sum, item) => sum + item.items.length, 0) }];
  });
}

function messageGroupMeta(key: string) {
  switch (key) {
    case 'MEDICATION_REMINDER':
      return { label: '服药提醒', hint: '按药品名称归类' };
    case 'VITAL_RECHECK_REMINDER':
      return { label: '指标打卡', hint: '按血压、血糖、血氧等指标归类' };
    case 'QUESTIONNAIRE_REMINDER':
      return { label: '随访问卷', hint: '按问卷类型归类' };
    case 'HOSPITAL_VISIT_REMINDER':
      return { label: '到院随访', hint: '按到院原因归类' };
    default:
      return { label: '其他随访', hint: '其他患者触达记录' };
  }
}

function messageGroupTone(key: string): string {
  if (key === 'VITAL_RECHECK_REMINDER') return 'vital';
  if (key === 'MEDICATION_REMINDER') return 'medication';
  if (key === 'QUESTIONNAIRE_REMINDER') return 'questionnaire';
  if (key === 'HOSPITAL_VISIT_REMINDER') return 'visit';
  return 'general';
}

function messageSubgroupLabel(message: OutboundMessage): string {
  const payload = (message.formLink?.payload || {}) as Record<string, unknown>;
  if (message.messageType === 'MEDICATION_REMINDER') {
    return textValue(payload.medicationName) || '用药计划';
  }
  if (message.messageType === 'VITAL_RECHECK_REMINDER') {
    return localizeVitalType(textValue(payload.vitalType));
  }
  if (message.messageType === 'QUESTIONNAIRE_REMINDER') {
    return localizeQuestionnaireType(textValue(payload.questionnaireType));
  }
  if (message.messageType === 'HOSPITAL_VISIT_REMINDER') {
    return compactReason(textValue(payload.reason)) || '到院安排';
  }
  return message.title || '其他随访';
}

function entityKindForMessage(message?: OutboundMessage): 'medication' | 'vital' | 'plan' {
  if (message?.messageType === 'MEDICATION_REMINDER') return 'medication';
  if (message?.messageType === 'VITAL_RECHECK_REMINDER') return 'vital';
  return 'plan';
}

function messageSummaryBadges(items: OutboundMessage[]) {
  const pending = items.filter((item) => item.status === 'PENDING' || item.status === 'SENT' || item.status === 'CLICKED').length;
  const submitted = items.filter((item) => item.status === 'SUBMITTED').length;
  const failed = items.filter((item) => item.status === 'FAILED').length;
  return (
    <>
      {pending ? <span className="pe-admin-status pe-admin-status-pending">进行中 {pending}</span> : null}
      {submitted ? <span className="pe-admin-status pe-admin-status-submitted">已提交 {submitted}</span> : null}
      {failed ? <span className="pe-admin-status pe-admin-status-failed">发送失败 {failed}</span> : null}
    </>
  );
}

function MessageStatusBadge({ status }: { status: string }) {
  return (
    <span className={`pe-admin-status pe-admin-status-${status.toLowerCase()}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function FormLinkStatusBadge({ status }: { status: string }) {
  if (!status) return <span className="pe-admin-muted">—</span>;
  const css = status === 'ACTIVE' ? 'active' : status === 'USED' ? 'submitted' : status === 'REVOKED' ? 'canceled' : 'pending';
  return (
    <span className={`pe-admin-status pe-admin-status-${css}`}>
      {FORMLINK_STATUS_LABEL[status] || status}
    </span>
  );
}

function patientFeedbackText(message: OutboundMessage) {
  if (message.submittedAt || message.formLink?.status === 'USED' || message.status === 'SUBMITTED') {
    return <span className="pe-admin-pos">已提交</span>;
  }
  if (message.formLink?.status === 'REVOKED') return <span className="pe-admin-muted">链接已失效</span>;
  if (message.formLink?.status === 'EXPIRED') return <span className="pe-admin-muted">链接已过期</span>;
  return <span className="pe-admin-muted">待患者反馈</span>;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function compactReason(value?: string): string | undefined {
  if (!value) return undefined;
  return value.length > 22 ? `${value.slice(0, 22)}…` : value;
}

function localizeVitalType(value?: string): string {
  if (!value) return '指标打卡';
  const labels: Record<string, string> = {
    BLOOD_PRESSURE: '血压（收缩压/舒张压）',
    BLOOD_GLUCOSE: '血糖',
    WEIGHT: '体重',
    HEART_RATE: '心率',
    SPO2: '血氧',
    TEMPERATURE: '体温',
  };
  return labels[value] || value;
}

function localizeQuestionnaireType(value?: string): string {
  if (!value) return '随访问卷';
  const labels: Record<string, string> = {
    HYPERTENSION_FOLLOWUP: '高血压随访问卷',
    DIABETES_FOLLOWUP: '糖尿病随访问卷',
    COPD_FOLLOWUP: '慢阻肺随访问卷',
    GENERIC: '通用随访问卷',
  };
  return labels[value] || value;
}

// ============================================================================
// detail drawer
// ============================================================================

function MessageDetailDrawer({
  messageId,
  onClose,
  onCopy,
  onResend,
  onInvalidate,
}: {
  messageId: string;
  onClose: () => void;
  onCopy: (url: string) => void;
  onResend: (m: OutboundMessage) => Promise<void> | void;
  onInvalidate: (m: OutboundMessage) => Promise<void> | void;
}) {
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchMessageDetail(messageId);
      setDetail(d);
    } catch (err) {
      setError(getApiErrorMessage(err, '加载详情失败'));
    } finally {
      setLoading(false);
    }
  }, [messageId]);

  useEffect(() => {
    void load();
  }, [load]);

  const message = detail?.message;
  const formLink = detail?.formLink;
  const linkActive = formLink?.status === 'ACTIVE';
  const completed = message?.status === 'SUBMITTED' || formLink?.status === 'USED';

  return (
    <div className="pe-admin-modal-backdrop" onClick={onClose}>
      <div className="pe-admin-drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>随访记录详情</h3>
          <button type="button" onClick={onClose}>×</button>
        </header>
        <div className="pe-admin-drawer-body">
          {loading && <p className="pe-admin-muted">加载中…</p>}
          {error && <p className="pe-admin-error">{error}</p>}
          {detail && message && (
            <>
              {/* 1. 基本信息 */}
              <section className="pe-admin-drawer-section">
                <h4>基本信息</h4>
                <div className="pe-admin-kv">
                  <div><label>类型</label><strong>{MSGTYPE_LABEL[message.messageType] || message.messageType}</strong></div>
                  <div><label>标题</label><strong>{message.title}</strong></div>
                  <div><label>创建时间</label><strong>{new Date(message.createdAt).toLocaleString('zh-CN', { hour12: false })}</strong></div>
                  <div>
                    <label>当前状态</label>
                    <strong><span className={`pe-admin-status pe-admin-status-${message.status.toLowerCase()}`}>{STATUS_LABEL[message.status] || message.status}</span></strong>
                  </div>
                </div>
              </section>

              {/* fallback banner */}
              {message.deliverySummary?.wechat === 'FAILED' && message.deliverySummary?.sms === 'SENT' && (
                <div className="pe-admin-banner pe-admin-banner-warn">本院服务号发送失败，已通过短信发送。</div>
              )}
              {message.status === 'FAILED' && (
                <div className="pe-admin-banner pe-admin-banner-error">发送失败，请检查患者联系方式或稍后重试。</div>
              )}

              {/* 2. 发送方式 / attempts timeline */}
              <section className="pe-admin-drawer-section">
                <h4>发送记录</h4>
                {detail.attempts.length === 0 ? (
                  <p className="pe-admin-muted">暂无发送记录。该链接可能尚未发送。</p>
                ) : (
                  <ul className="pe-admin-timeline">
                    {detail.attempts.map((a) => (
                      <li key={a.id} className={a.status === 'FAILED' ? 'pe-admin-timeline-fail' : 'pe-admin-timeline-ok'}>
                        <div className="pe-admin-timeline-head">
                          <strong>第 {a.attemptNo} 次发送 · {CHANNEL_LABEL[a.channel] || a.channel}</strong>
                          <span className={a.status === 'FAILED' ? 'pe-admin-neg' : 'pe-admin-pos'}>
                            {a.status === 'FAILED' ? '失败' : '已发送'}
                          </span>
                          <small>{triggerLabel(a.triggerReason)}</small>
                        </div>
                        <div className="pe-admin-timeline-meta">
                          <small>{new Date(a.createdAt).toLocaleString('zh-CN', { hour12: false })}</small>
                          {a.recipientMasked && <small> · {a.recipientMasked}</small>}
                          {a.errorMessage && <small className="pe-admin-error"> · 未成功：{a.errorMessage}</small>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* 3. 患者填写内容 */}
              <section className="pe-admin-drawer-section">
                <h4>患者填写内容</h4>
                <SubmissionView submission={detail.submission} />
              </section>

              {/* 4. 链接状态 */}
              <section className="pe-admin-drawer-section">
                <h4>链接状态</h4>
                <div className="pe-admin-kv">
                  <div><label>状态</label><strong>{FORMLINK_STATUS_LABEL[formLink?.status || ''] || formLink?.status || '—'}</strong></div>
                  {formLink?.expiresAt && (
                    <div><label>过期时间</label><strong>{new Date(formLink.expiresAt).toLocaleString('zh-CN', { hour12: false })}</strong></div>
                  )}
                  {formLink?.status === 'REVOKED' && formLink?.revokeReason && (
                    <div><label>失效原因</label><strong>{formLink.revokeReason}</strong></div>
                  )}
                </div>
                {message.linkUrl && (
                  <div className="pe-admin-link-row">
                    <input readOnly value={message.linkUrl} onClick={(e) => e.currentTarget.select()} />
                    <button type="button" className="pe-admin-secondary" onClick={() => onCopy(message.linkUrl!)}>复制链接</button>
                  </div>
                )}
              </section>

              {/* 5. 操作 */}
              {linkActive && !completed && (
                <section className="pe-admin-drawer-section">
                  <h4>操作</h4>
                  <div className="pe-admin-drawer-actions">
                    <button type="button" className="pe-admin-primary" onClick={() => void onResend(message)}>再次发送</button>
                    <button type="button" className="pe-admin-danger" onClick={() => void onInvalidate(message)}>使链接失效</button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SubmissionView({ submission }: { submission: MessageSubmission }) {
  if (!submission) return <p className="pe-admin-muted">患者尚未提交内容。</p>;
  const { type, data, submittedAt, inferred } = submission;
  const rows: Array<[string, string]> = [];
  const fmt = (v: any) => (v === null || v === undefined || v === '' ? '—' : String(v));

  if (type === 'QuestionnaireResult') {
    rows.push(['问卷类型', localizeQuestionnaireType(fmt(data.questionnaireType))]);
    rows.push(['得分', fmt(data.score)]);
    rows.push(['风险等级', localizeRiskLevel(fmt(data.riskLevel))]);
    rows.push(['风险结论', fmt(data.riskConclusion)]);
    if (data.note) rows.push(['备注', fmt(data.note)]);
  } else if (type === 'VitalRecord') {
    rows.push(['指标', localizeVitalType(fmt(data.vitalType))]);
    rows.push(['数值', `${fmt(data.value)} ${fmt(data.unit)}`]);
    rows.push(['测量时间', data.measuredAt ? new Date(data.measuredAt).toLocaleString('zh-CN', { hour12: false }) : '—']);
    rows.push(['是否异常', data.isAbnormal ? '异常' : '正常']);
    if (data.note) rows.push(['备注', fmt(data.note)]);
  } else if (type === 'MedicationCheckIn') {
    rows.push(['药品', fmt(data.medicationName)]);
    if (data.dosage) rows.push(['剂量', fmt(data.dosage)]);
    rows.push(['是否服药', data.taken ? '已服药' : '未服药']);
    rows.push(['打卡时间', data.checkedAt ? new Date(data.checkedAt).toLocaleString('zh-CN', { hour12: false }) : '—']);
    if (data.note) rows.push(['备注', fmt(data.note)]);
  } else if (type === 'HospitalVisitFeedback' || type === 'FollowUpRecord') {
    rows.push(['患者反馈', visitActionLabel(data.action)]);
    if (data.note) rows.push(['备注', fmt(data.note)]);
  } else if (type === 'PatientDirectMessage') {
    rows.push(['消息内容', fmt(data.content)]);
    rows.push(['需要确认', data.requiresAck ? '是' : '否']);
    rows.push(['确认时间', data.acknowledgedAt ? new Date(data.acknowledgedAt).toLocaleString('zh-CN', { hour12: false }) : '—']);
  } else {
    rows.push(['类型', fmt(type)]);
  }

  return (
    <div>
      {submittedAt && <p className="pe-admin-muted">提交时间：{new Date(submittedAt).toLocaleString('zh-CN', { hour12: false })}{inferred ? '（推断）' : ''}</p>}
      <table className="pe-admin-submission-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}><th>{k}</th><td>{v}</td></tr>
          ))}
        </tbody>
      </table>
      {type === 'QuestionnaireResult' && data.answers && (
        <QuestionnaireAnswersView answers={data.answers} />
      )}
    </div>
  );
}

function QuestionnaireAnswersView({ answers }: { answers: unknown }) {
  const entries = Object.entries((answers && typeof answers === 'object' ? answers : {}) as Record<string, unknown>);
  if (!entries.length) return null;

  return (
    <details className="pe-admin-answers">
      <summary>查看问卷作答明细</summary>
      <table className="pe-admin-submission-table pe-admin-answer-table">
        <tbody>
          {entries.map(([question, answer]) => (
            <tr key={question}>
              <th>{friendlyQuestionLabel(question)}</th>
              <td>{friendlyAnswerValue(answer)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function friendlyQuestionLabel(value: string): string {
  const labels: Record<string, string> = {
    medicationAdherence: '服药情况',
    bloodPressureControl: '血压控制',
    symptoms: '近期症状',
    lifestyle: '生活方式',
    followUpNeed: '随访需求',
  };
  return labels[value] || value;
}

function friendlyAnswerValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join('、');
  if (value === true) return '是';
  if (value === false) return '否';
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).map((item) => String(item)).join('、');
  return String(value);
}

// ============================================================================
// compose modal
// ============================================================================

function ComposeModal(props: {
  state: Extract<ComposeState, { kind: 'open' }>;
  medications: Array<{ id: string; medicationName: string; dosage?: string; frequency?: string }>;
  hospitalVisitReminders: Array<{ id: string; title?: string; reason?: string }>;
  recommendedChannel?: 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS' | 'MANUAL_COPY';
  onChange: (next: Partial<Extract<ComposeState, { kind: 'open' }>>) => void;
  onCancel: () => void;
  onSaveOnly: () => void;
  onSaveAndSend: () => void;
}) {
  const { state, onChange, recommendedChannel } = props;
  const recommendedHint = recommendedChannel
    ? `当前推荐：${CHANNEL_LABEL[recommendedChannel] || recommendedChannel}（选择“自动选择”后将按此规则发送）`
    : '';

  return (
    <div className="pe-admin-modal-backdrop" onClick={props.onCancel}>
      <div className="pe-admin-modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>发送：{linkTypeLabel(state.linkType)}</h3>
          <button type="button" onClick={props.onCancel}>×</button>
        </header>
        <div className="pe-admin-modal-body">
          {state.linkType === 'QUESTIONNAIRE' && (
            <label className="pe-admin-field">
              <span>问卷类型</span>
              <select value={state.questionnaireType || 'HYPERTENSION_FOLLOWUP'} onChange={(e) => onChange({ questionnaireType: e.target.value })}>
                <option value="HYPERTENSION_FOLLOWUP">高血压随访</option>
                <option value="DIABETES_FOLLOWUP">糖尿病随访</option>
                <option value="COPD_FOLLOWUP">慢阻肺随访</option>
                <option value="GENERIC">通用随访</option>
              </select>
            </label>
          )}
          {state.linkType === 'VITAL_RECHECK' && (
            <label className="pe-admin-field">
              <span>复测指标</span>
              <select value={state.vitalType || 'BLOOD_PRESSURE'} onChange={(e) => onChange({ vitalType: e.target.value })}>
                <option value="BLOOD_PRESSURE">血压</option>
                <option value="BLOOD_GLUCOSE">血糖</option>
                <option value="WEIGHT">体重</option>
                <option value="HEART_RATE">心率</option>
                <option value="SPO2">血氧</option>
              </select>
            </label>
          )}
          {state.linkType === 'MEDICATION_CHECKIN' && (
            <label className="pe-admin-field">
              <span>用药计划</span>
              <select value={state.medicationId || ''} onChange={(e) => onChange({ medicationId: e.target.value })}>
                <option value="">请选择</option>
                {props.medications.map((m) => (
                  <option key={m.id} value={m.id}>{m.medicationName}{m.dosage ? ` · ${m.dosage}` : ''}{m.frequency ? ` · ${m.frequency}` : ''}</option>
                ))}
              </select>
            </label>
          )}
          {state.linkType === 'HOSPITAL_VISIT_CONFIRM' && (
            <label className="pe-admin-field">
              <span>到院原因 (患者会看到)</span>
              <textarea rows={2} value={state.reason || ''} onChange={(e) => onChange({ reason: e.target.value })} placeholder="例如：近期血压升高，建议门诊评估" />
            </label>
          )}
          <label className="pe-admin-field">
            <span>标题</span>
            <input value={state.title} onChange={(e) => onChange({ title: e.target.value })} />
          </label>
          <label className="pe-admin-field">
            <span>说明（患者会看到，可选）</span>
            <textarea rows={2} value={state.description} onChange={(e) => onChange({ description: e.target.value })} />
          </label>
          <div className="pe-admin-field-row">
            <label className="pe-admin-field">
              <span>有效时长（小时）</span>
              <input
                type="number"
                min={1}
                max={720}
                value={state.expiresInHours}
                onChange={(e) => onChange({ expiresInHours: Math.max(1, Math.min(720, Number(e.target.value) || 72)) })}
              />
            </label>
            <label className="pe-admin-field">
              <span>通道</span>
              <select value={state.preferredChannel} onChange={(e) => onChange({ preferredChannel: e.target.value as PreferredChannel })}>
                <option value="AUTO">自动选择（推荐）</option>
                <option value="WECHAT_OFFICIAL_ACCOUNT">本院服务号</option>
                <option value="SMS">短信</option>
                <option value="MANUAL_COPY">仅生成链接</option>
              </select>
            </label>
          </div>
          {recommendedHint && <p className="pe-admin-muted">{recommendedHint}</p>}
          <label className="pe-admin-checkbox">
            <input type="checkbox" checked={state.requiresIdentityCheck} onChange={(e) => onChange({ requiresIdentityCheck: e.target.checked })} />
            <span>提交前要求患者补充身份信息（手机号末 4 位 / 身份证末 4 位 / 出生日期任一）</span>
          </label>
          <details className="pe-admin-advanced-fields">
            <summary>高级关联（通常无需填写）</summary>
            <p className="pe-admin-muted">仅在需要把本次随访关联至已有临床处置事项时填写。</p>
            <div className="pe-admin-field-row">
              <label className="pe-admin-field">
                <span>关联任务编号（可选）</span>
                <input value={state.taskId || ''} onChange={(e) => onChange({ taskId: e.target.value })} />
              </label>
              <label className="pe-admin-field">
                <span>关联预警编号（可选）</span>
                <input value={state.riskAlertId || ''} onChange={(e) => onChange({ riskAlertId: e.target.value })} />
              </label>
            </div>
          </details>
        </div>
        <footer>
          <button type="button" className="pe-admin-link-button" onClick={props.onCancel}>取消</button>
          <button type="button" className="pe-admin-secondary" onClick={props.onSaveOnly}>仅生成链接</button>
          <button type="button" className="pe-admin-primary" onClick={props.onSaveAndSend}>生成并发送</button>
        </footer>
      </div>
    </div>
  );
}

// ============================================================================
// helpers
// ============================================================================

function linkTypeLabel(t: LinkType): string {
  const map: Record<LinkType, string> = {
    QUESTIONNAIRE: '随访问卷',
    VITAL_RECHECK: '指标打卡',
    MEDICATION_CHECKIN: '服药提醒',
    HOSPITAL_VISIT_CONFIRM: '发送到院随访',
  };
  return map[t];
}

function defaultTitleFor(t: LinkType): string {
  if (t === 'QUESTIONNAIRE') return `请填写随访问卷`;
  if (t === 'VITAL_RECHECK') return `请提交复测结果`;
  if (t === 'MEDICATION_CHECKIN') return `请完成用药打卡`;
  if (t === 'HOSPITAL_VISIT_CONFIRM') return `请确认到院安排`;
  return '医院随访任务';
}

function localizeRiskLevel(value: string): string {
  const labels: Record<string, string> = {
    LOW: '低风险',
    MEDIUM: '中风险',
    HIGH: '高风险',
    VERY_HIGH: '极高风险',
  };
  return labels[value] || value;
}

function triggerLabel(t: string | null): string {
  switch (t) {
    case 'INITIAL':
      return '首次发送';
    case 'AUTO_FALLBACK':
      return '短信兜底';
    case 'NURSE_RESEND':
      return '再次发送';
    default:
      return t || '';
  }
}

function visitActionLabel(a: string): string {
  switch (a) {
    case 'WILL_VISIT':
      return '计划到院';
    case 'ARRIVED':
      return '已到院';
    case 'CANNOT_VISIT':
      return '暂无法到院';
    case 'REFUSED':
      return '拒绝到院';
    default:
      return a || '—';
  }
}

export default PatientEngagementTab;


