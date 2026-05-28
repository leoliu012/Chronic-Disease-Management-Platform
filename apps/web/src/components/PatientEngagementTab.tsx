/**
 * PatientEngagementTab
 * --------------------
 * 患者档案 → 微信随访 tab. 包含:
 *   1) 触达概览卡: 手机号脱敏 / 是否关注服务号 / 最近一次发送状态 / 推荐通道
 *   2) 快捷动作: 发问卷 / 复测 / 用药打卡 / 到院确认 / 仅复制链接
 *   3) 发送弹窗: 标题、说明、过期时间、preferredChannel、requiresIdentityCheck、关联 Task/RiskAlert
 *   4) 历史消息: 时间、类型、通道、状态、提交链接、操作 (复制链接 / 重发 / 撤销 / 标记手动)
 *
 * 全部走 apps/web/src/api/patient-engagement.ts.
 *
 * 注意: 这是后台护士/医生看的页面, 仅在 PatientDetailPage 内引用, 因此默认依赖
 * 后台已有的 axios client、登录态、role guard。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type ContactSummary,
  type OutboundMessage,
  type CreateLinkResponse,
  type PreferredChannel,
  createHospitalVisitLink,
  createMedicationCheckinLink,
  createQuestionnaireLink,
  createVitalRecheckLink,
  fetchContactSummary,
  fetchPatientMessages,
  markMessageManualSent,
  resendMessage,
  revokeFormLink,
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
      // type-specific
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
  CANCELED: '已取消',
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
  REVOKED: '已撤销',
};

type PatientEngagementTabProps = {
  patientId: string;
  /** Optional list of patient's medications, for the medication-checkin dropdown */
  medications?: Array<{ id: string; medicationName: string; dosage?: string; frequency?: string }>;
  /** Optional list of active hospital visit reminders for linking */
  hospitalVisitReminders?: Array<{ id: string; title?: string; reason?: string }>;
};

export function PatientEngagementTab(props: PatientEngagementTabProps) {
  const { patientId } = props;
  const [summary, setSummary] = useState<ContactSummary | null>(null);
  const [messages, setMessages] = useState<OutboundMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeState>({ kind: 'closed' });
  const [lastCreated, setLastCreated] = useState<CreateLinkResponse | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, m] = await Promise.all([
        fetchContactSummary(patientId),
        fetchPatientMessages(patientId),
      ]);
      setSummary(s);
      setMessages(m);
    } catch (err) {
      setError(getApiErrorMessage(err, '加载患者触达信息失败'));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function flashSuccess(message: string) {
    setToast({ kind: 'success', message });
    window.setTimeout(() => setToast(null), 3000);
  }
  function flashError(message: string) {
    setToast({ kind: 'error', message });
    window.setTimeout(() => setToast(null), 4000);
  }

  function openCompose(linkType: LinkType, prefill?: Partial<ComposeState>) {
    const defaults: ComposeState = {
      kind: 'open',
      linkType,
      title: defaultTitleFor(linkType, prefill),
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
        res = await createQuestionnaireLink(patientId, {
          ...baseInput,
          questionnaireType: c.questionnaireType || 'GENERIC',
        });
      } else if (c.linkType === 'VITAL_RECHECK') {
        res = await createVitalRecheckLink(patientId, {
          ...baseInput,
          vitalType: c.vitalType || 'BLOOD_PRESSURE',
        });
      } else if (c.linkType === 'MEDICATION_CHECKIN') {
        if (!c.medicationId) {
          flashError('请选择用药计划');
          return;
        }
        res = await createMedicationCheckinLink(patientId, {
          ...baseInput,
          medicationId: c.medicationId,
        });
      } else {
        res = await createHospitalVisitLink(patientId, {
          ...baseInput,
          reason: c.reason || '请到医院随访',
        });
      }
      setLastCreated(res);
      flashSuccess(send ? '链接已创建并触发发送（点开下方记录可查看发送状态）' : '链接已创建，可复制后再发送');
      await reload();
    } catch (err) {
      flashError(getApiErrorMessage(err, '创建链接失败'));
    }
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      flashSuccess('链接已复制到剪贴板');
    } catch {
      // Fallback: tiny prompt
      window.prompt('请手动复制以下链接', url);
    }
  }

  async function handleResend(message: OutboundMessage, channel?: PreferredChannel) {
    try {
      await resendMessage(message.id, channel);
      flashSuccess('已重新发送');
      await reload();
    } catch (err) {
      flashError(getApiErrorMessage(err, '重发失败'));
    }
  }

  async function handleRevoke(message: OutboundMessage) {
    if (!message.formLink) return;
    const reason = window.prompt('撤销原因（必填）') || '';
    if (!reason.trim()) return;
    try {
      await revokeFormLink(message.formLink.id, reason.trim());
      flashSuccess('已撤销该链接');
      await reload();
    } catch (err) {
      flashError(getApiErrorMessage(err, '撤销失败'));
    }
  }

  async function handleMarkManual(message: OutboundMessage) {
    try {
      await markMessageManualSent(message.id, '后台标记手动已发送');
      flashSuccess('已标记为手动发送');
      await reload();
    } catch (err) {
      flashError(getApiErrorMessage(err, '标记失败'));
    }
  }

  return (
    <div className="pe-admin-tab">
      <ContactSummaryCard summary={summary} loading={loading} error={error} />

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

      <MessagesTable
        messages={messages}
        loading={loading}
        onCopy={(url) => void handleCopy(url)}
        onResend={(m) => void handleResend(m)}
        onResendSms={(m) => void handleResend(m, 'SMS')}
        onResendWechat={(m) => void handleResend(m, 'WECHAT_OFFICIAL_ACCOUNT')}
        onResendManual={(m) => void handleResend(m, 'MANUAL_COPY')}
        onRevoke={(m) => void handleRevoke(m)}
        onMarkManual={(m) => void handleMarkManual(m)}
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
              {summary.hasOpenId
                ? '已关注'
                : summary.hospitalServiceAccountConfigured
                  ? '未关注'
                  : '本院未配置'}
            </strong>
            {summary.hospitalDisplayName && (
              <small className="pe-admin-muted">{summary.hospitalDisplayName}</small>
            )}
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
// last created panel — shows link / token / copy
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
        <button type="button" onClick={onCopy}>复制</button>
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
// messages table
// ============================================================================

function MessagesTable(props: {
  messages: OutboundMessage[];
  loading: boolean;
  onCopy: (url: string) => void;
  onResend: (m: OutboundMessage) => void;
  onResendSms: (m: OutboundMessage) => void;
  onResendWechat: (m: OutboundMessage) => void;
  onResendManual: (m: OutboundMessage) => void;
  onRevoke: (m: OutboundMessage) => void;
  onMarkManual: (m: OutboundMessage) => void;
}) {
  const { messages, loading } = props;
  if (loading && !messages.length) return <p className="pe-admin-muted">加载中…</p>;
  if (!messages.length) return (
    <section className="pe-admin-messages">
      <h3>历史发送</h3>
      <p className="pe-admin-muted">暂未发送过随访链接。</p>
    </section>
  );
  return (
    <section className="pe-admin-messages">
      <h3>历史发送</h3>
      <table className="pe-admin-messages-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>类型</th>
            <th>通道</th>
            <th>状态</th>
            <th>链接</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {messages.map((m) => (
            <tr key={m.id}>
              <td>{new Date(m.createdAt).toLocaleString('zh-CN', { hour12: false })}</td>
              <td>{MSGTYPE_LABEL[m.messageType] || m.messageType}</td>
              <td>{CHANNEL_LABEL[m.channel] || m.channel}</td>
              <td>
                <span className={`pe-admin-status pe-admin-status-${m.status.toLowerCase()}`}>
                  {STATUS_LABEL[m.status] || m.status}
                </span>
                {m.errorMessage && <small className="pe-admin-error">{m.errorMessage}</small>}
              </td>
              <td>
                {m.formLink ? (
                  <small>
                    {FORMLINK_STATUS_LABEL[m.formLink.status] || m.formLink.status}
                    {' · '}
                    {m.formLink.expiresAt ? `失效 ${new Date(m.formLink.expiresAt).toLocaleString('zh-CN', { hour12: false })}` : ''}
                  </small>
                ) : <small>-</small>}
              </td>
              <td className="pe-admin-actions-cell">
                {m.linkUrl && (
                  <button type="button" onClick={() => props.onCopy(m.linkUrl!)}>复制</button>
                )}
                {m.formLink?.status === 'ACTIVE' && (
                  <>
                    <button type="button" onClick={() => props.onResend(m)}>重发</button>
                    <button type="button" onClick={() => props.onResendSms(m)}>改短信</button>
                    <button type="button" onClick={() => props.onResendWechat(m)}>改服务号</button>
                    <button type="button" onClick={() => props.onMarkManual(m)}>标记手动</button>
                    <button type="button" className="pe-admin-danger" onClick={() => props.onRevoke(m)}>撤销</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
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
              <select
                value={state.questionnaireType || 'HYPERTENSION_FOLLOWUP'}
                onChange={(e) => onChange({ questionnaireType: e.target.value })}
              >
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
            <input
              type="checkbox"
              checked={state.requiresIdentityCheck}
              onChange={(e) => onChange({ requiresIdentityCheck: e.target.checked })}
            />
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
          <button type="button" onClick={props.onSaveOnly}>仅生成链接</button>
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

function defaultTitleFor(t: LinkType, prefill?: Partial<ComposeState>): string {
  if (t === 'QUESTIONNAIRE') return `请填写随访问卷`;
  if (t === 'VITAL_RECHECK') return `请提交复测结果`;
  if (t === 'MEDICATION_CHECKIN') return `请完成用药打卡`;
  if (t === 'HOSPITAL_VISIT_CONFIRM') return `请确认到院安排`;
  return '医院随访任务';
}

export default PatientEngagementTab;


