/**
 * PatientEngagementTab (v3.2)
 * ---------------------------
 * 患者档案 → 微信随访 tab.
 *   1) 触达概览卡
 *   2) 快捷发送 (问卷 / 复测 / 用药打卡 / 到院确认)
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
  VITAL_RECHECK_REMINDER: '指标复测',
  MEDICATION_REMINDER: '用药打卡',
  HOSPITAL_VISIT_REMINDER: '到院确认',
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
  { value: 'VITAL_RECHECK_REMINDER', label: '指标复测' },
  { value: 'MEDICATION_REMINDER', label: '用药打卡' },
  { value: 'HOSPITAL_VISIT_REMINDER', label: '到院确认' },
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
        <ActionButton title="申请血压复测" hint="自动触发风险评估" onClick={() => onSelect('VITAL_RECHECK')} />
        <ActionButton title="用药打卡提醒" hint={hasMedications ? '从已有用药计划中选择' : '该患者暂无用药计划'} disabled={!hasMedications} onClick={() => onSelect('MEDICATION_CHECKIN')} />
        <ActionButton title="到院确认" hint={hasHospitalVisitReminders ? '可关联已有到院提醒' : '可独立发送'} onClick={() => onSelect('HOSPITAL_VISIT_CONFIRM')} />
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
// messages section (filter bar + table + pagination)
// ============================================================================

function MessagesSection(props: {
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
}) {
  const { messages, loading, draft } = props;
  return (
    <section className="pe-admin-messages">
      <h3>历史随访记录</h3>

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
          <table className="pe-admin-messages-table">
            <thead>
              <tr>
                <th>创建时间</th>
                <th>类型</th>
                <th>标题</th>
                <th>状态</th>
                <th>发送方式</th>
                <th>提交时间</th>
                <th>链接状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => {
                const linkActive = m.formLink?.status === 'ACTIVE';
                const completed = m.status === 'SUBMITTED' || m.formLink?.status === 'USED';
                return (
                  <tr key={m.id}>
                    <td>{new Date(m.createdAt).toLocaleString('zh-CN', { hour12: false })}</td>
                    <td>{MSGTYPE_LABEL[m.messageType] || m.messageType}</td>
                    <td>{m.title}</td>
                    <td>
                      <span className={`pe-admin-status pe-admin-status-${m.status.toLowerCase()}`}>
                        {STATUS_LABEL[m.status] || m.status}
                      </span>
                    </td>
                    <td><DeliveryCell message={m} /></td>
                    <td>{m.submittedAt ? new Date(m.submittedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
                    <td>
                      <small>
                        {FORMLINK_STATUS_LABEL[m.formLink?.status || ''] || m.formLink?.status || '—'}
                      </small>
                    </td>
                    <td className="pe-admin-actions-cell">
                      <button type="button" className="pe-admin-secondary" onClick={() => props.onViewDetail(m)}>查看详情</button>
                      {m.linkUrl && <button type="button" className="pe-admin-secondary" onClick={() => props.onCopy(m.linkUrl!)}>复制链接</button>}
                      {linkActive && !completed && (
                        <>
                          <button type="button" className="pe-admin-secondary" disabled={props.busyId === m.id} onClick={() => props.onResend(m)}>再次发送</button>
                          <button type="button" className="pe-admin-danger" disabled={props.busyId === m.id} onClick={() => props.onInvalidate(m)}>使链接失效</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

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
          <h3>随访案件详情</h3>
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
                <h4>发送尝试</h4>
                {detail.attempts.length === 0 ? (
                  <p className="pe-admin-muted">暂无发送尝试（可能为仅生成链接）。</p>
                ) : (
                  <ul className="pe-admin-timeline">
                    {detail.attempts.map((a) => (
                      <li key={a.id} className={a.status === 'FAILED' ? 'pe-admin-timeline-fail' : 'pe-admin-timeline-ok'}>
                        <div className="pe-admin-timeline-head">
                          <strong>#{a.attemptNo} · {CHANNEL_LABEL[a.channel] || a.channel}</strong>
                          <span className={a.status === 'FAILED' ? 'pe-admin-neg' : 'pe-admin-pos'}>
                            {a.status === 'FAILED' ? '失败' : '已发送'}
                          </span>
                          <small>{triggerLabel(a.triggerReason)}</small>
                        </div>
                        <div className="pe-admin-timeline-meta">
                          <small>{new Date(a.createdAt).toLocaleString('zh-CN', { hour12: false })}</small>
                          {a.recipientMasked && <small> · {a.recipientMasked}</small>}
                          {a.errorMessage && <small className="pe-admin-error"> · {a.errorMessage}</small>}
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
    rows.push(['问卷类型', fmt(data.questionnaireType)]);
    rows.push(['得分', fmt(data.score)]);
    rows.push(['风险等级', fmt(data.riskLevel)]);
    rows.push(['风险结论', fmt(data.riskConclusion)]);
    if (data.note) rows.push(['备注', fmt(data.note)]);
  } else if (type === 'VitalRecord') {
    rows.push(['指标', fmt(data.vitalType)]);
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
        <details className="pe-admin-answers">
          <summary>查看问卷作答明细</summary>
          <pre>{JSON.stringify(data.answers, null, 2)}</pre>
        </details>
      )}
    </div>
  );
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
    ? `当前推荐：${CHANNEL_LABEL[recommendedChannel] || recommendedChannel}（AUTO 即按此规则发送）`
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
                <option value="AUTO">AUTO (推荐)</option>
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
          <div className="pe-admin-field-row">
            <label className="pe-admin-field">
              <span>关联任务 ID (可选)</span>
              <input value={state.taskId || ''} onChange={(e) => onChange({ taskId: e.target.value })} placeholder="task-xxxx" />
            </label>
            <label className="pe-admin-field">
              <span>关联预警 ID (可选)</span>
              <input value={state.riskAlertId || ''} onChange={(e) => onChange({ riskAlertId: e.target.value })} placeholder="alert-xxxx" />
            </label>
          </div>
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
    VITAL_RECHECK: '指标复测',
    MEDICATION_CHECKIN: '用药打卡',
    HOSPITAL_VISIT_CONFIRM: '到院确认',
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
