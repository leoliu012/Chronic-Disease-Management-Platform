/**
 * ChronicLeadInvitationPage.tsx —— 护士工作台 · 高危慢病线索邀约中心
 *
 * 这是患者"自愿入网"的核心控制面板。后端 GatewayLeadPromoterService
 * 把网关捞到的高危信号写入 ChronicLead 待签约池，本页是护士对这些线索
 * 做"打电话邀约 → 患者口头同意 → 手动登记建档"的唯一入口。
 *
 * 临床合规边界：本页**没有**任何自动建档按钮。任何把线索升档为
 * Patient 的动作都必须经过【签约】按钮 + 知情同意确认。
 */

import { useEffect, useMemo, useState, Fragment, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getApiErrorMessage } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { useFeedbackMessageBridge } from '../utils/feedbackMessage';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type LeadStatus = 'PENDING_REVIEW' | 'CONTACTED' | 'SIGNED' | 'REJECTED' | 'DEFERRED' | 'EXPIRED';
type SourceChannel =
  | 'HL7_DISCHARGE'
  | 'HL7_OUTPATIENT'
  | 'HL7_ABNORMAL_OBSERVATION'
  | 'FHIR_DISCHARGE'
  | 'FHIR_ENCOUNTER'
  | 'FHIR_CONDITION'
  | 'FHIR_OBSERVATION'
  | 'HIS_EVENT_DISCHARGE'
  | 'HIS_EVENT_ENCOUNTER'
  | 'HIS_EVENT_LAB'
  | 'INTERMEDIATE_DB'
  | 'MANUAL';
type DiseaseType =
  | 'HYPERTENSION'
  | 'TYPE_2_DIABETES'
  | 'COPD'
  | 'CORONARY_HEART_DISEASE'
  | 'HYPERLIPIDEMIA'
  | 'OBESITY'
  | 'OTHER';
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
type Gender = 'MALE' | 'FEMALE' | 'UNKNOWN';

type ChronicLead = {
  id: string;
  hospitalPatientId: string | null;
  idCardNo: string | null;
  phone: string | null;
  externalPatientId: string | null;
  name: string | null;
  gender: Gender;
  birthDate: string | null;
  sourceChannel: SourceChannel;
  sourceRecordId: string | null;
  sourceBatchId: string | null;
  suspectedDisease: DiseaseType | null;
  diagnosisIcd: string | null;
  diagnosisText: string | null;
  riskHint: RiskLevel;
  evidenceSummary: string | null;
  status: LeadStatus;
  consentSource: 'MINI_PROGRAM_SIGN' | 'NURSE_CONFIRM' | 'DOCTOR_CONFIRM' | null;
  consentRef: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  promotedPatientId: string | null;
  promotedAt: string | null;
  hitCount: number;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
  reviewedBy?: { id: string; displayName: string; role: string } | null;
  promotedPatient?: { id: string; name: string; hospitalPatientId: string | null } | null;
};

/* -------------------------------------------------------------------------- */
/*  Display dictionaries                                                       */
/* -------------------------------------------------------------------------- */

const statusLabel: Record<LeadStatus, string> = {
  PENDING_REVIEW: '待邀约',
  CONTACTED: '已联系',
  SIGNED: '已建档',
  REJECTED: '已拒绝',
  DEFERRED: '已暂缓',
  EXPIRED: '已失效',
};

const diseaseLabel: Record<DiseaseType, string> = {
  HYPERTENSION: '高血压',
  TYPE_2_DIABETES: '2型糖尿病',
  COPD: '慢性阻塞性肺病',
  CORONARY_HEART_DISEASE: '冠心病',
  HYPERLIPIDEMIA: '高脂血症',
  OBESITY: '肥胖症',
  OTHER: '其他慢病',
};

const riskLabel: Record<RiskLevel, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  VERY_HIGH: '极高',
};

const sourceLabel: Record<SourceChannel, string> = {
  HL7_DISCHARGE: 'HL7 · 出院',
  HL7_OUTPATIENT: 'HL7 · 门诊',
  HL7_ABNORMAL_OBSERVATION: 'HL7 · 异常检验',
  FHIR_DISCHARGE: 'FHIR · 出院',
  FHIR_ENCOUNTER: 'FHIR · 就诊',
  FHIR_CONDITION: 'FHIR · 诊断',
  FHIR_OBSERVATION: 'FHIR · 检验',
  HIS_EVENT_DISCHARGE: 'HIS · 出院',
  HIS_EVENT_ENCOUNTER: 'HIS · 就诊',
  HIS_EVENT_LAB: 'HIS · 化验',
  INTERMEDIATE_DB: '中间表',
  MANUAL: '手工录入',
};

function statusBadgeClass(status: LeadStatus) {
  if (status === 'SIGNED') return 'status-badge status-done';
  if (status === 'REJECTED' || status === 'EXPIRED') return 'status-badge status-canceled';
  if (status === 'CONTACTED' || status === 'DEFERRED') return 'status-badge status-progress';
  return 'status-badge status-pending';
}

function riskClass(risk: RiskLevel) {
  if (risk === 'VERY_HIGH') return 'risk-pill risk-pill-critical';
  if (risk === 'HIGH') return 'risk-pill risk-pill-high';
  if (risk === 'MEDIUM') return 'risk-pill risk-pill-medium';
  return 'risk-pill risk-pill-low';
}

function formatTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function maskPhone(phone?: string | null) {
  if (!phone || phone.length < 7) return phone ?? '-';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function maskIdCard(id?: string | null) {
  if (!id || id.length < 8) return id ?? '-';
  return `${id.slice(0, 4)}****${id.slice(-4)}`;
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

type ActionKind = 'contact' | 'defer' | 'reject' | 'sign';

export function ChronicLeadInvitationPage() {
  const navigate = useNavigate();

  const [leads, setLeads] = useState<ChronicLead[]>([]);
  const [statusFilter, setStatusFilter] = useState<'ALL' | LeadStatus>('PENDING_REVIEW');
  const [diseaseFilter, setDiseaseFilter] = useState<'ALL' | DiseaseType>('ALL');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<{ leadId: string; kind: ActionKind } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useFeedbackMessageBridge(message, error);

  const visibleLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (diseaseFilter !== 'ALL' && lead.suspectedDisease !== diseaseFilter) return false;
      return true;
    });
  }, [leads, diseaseFilter]);

  async function loadLeads(
    nextStatus: 'ALL' | LeadStatus = statusFilter,
    opts?: { silent?: boolean },
  ) {
    if (!opts?.silent) setLoading(true);
    setError('');
    try {
      const params: Record<string, string | number> = {};
      if (nextStatus !== 'ALL') params.status = nextStatus;
      if (keyword.trim()) params.keyword = keyword.trim();
      params.limit = 200;

      const res = await api.get<ChronicLead[]>('/chronic-leads', { params });
      setLeads(res.data || []);
    } catch (err) {
      setError(getApiErrorMessage(err, '加载高危线索失败，请确认已登录并具备护士/管理员权限。'));
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 高危慢病线索邀约库每 20 秒自动刷新，无需手动点「刷新」。
  usePolling(() => loadLeads(undefined, { silent: true }), 20000);

  function changeStatus(next: 'ALL' | LeadStatus) {
    setStatusFilter(next);
    setExpanded(null);
    loadLeads(next);
  }

  function changeDisease(next: 'ALL' | DiseaseType) {
    setDiseaseFilter(next);
  }

  function refresh() {
    setExpanded(null);
    loadLeads();
  }

  function openAction(leadId: string, kind: ActionKind) {
    setExpanded({ leadId, kind });
  }

  function closeAction() {
    setExpanded(null);
  }

  /* ----------------------- One-click actions ---------------------- */

  async function performContact(leadId: string, note: string) {
    setUpdatingId(leadId);
    setMessage('');
    setError('');
    try {
      await api.post(`/chronic-leads/${leadId}/contact`, note.trim() ? { note: note.trim() } : {});
      setMessage('已记录为"已联系"，可在筛选中切换至已联系视图查看。');
      closeAction();
      await loadLeads();
    } catch (err) {
      setError(getApiErrorMessage(err, '更新线索状态失败。'));
    } finally {
      setUpdatingId(null);
    }
  }

  async function performDefer(leadId: string, note: string) {
    setUpdatingId(leadId);
    setMessage('');
    setError('');
    try {
      await api.post(`/chronic-leads/${leadId}/defer`, note.trim() ? { note: note.trim() } : {});
      setMessage('已暂缓，本线索将不在待邀约视图出现，可在已暂缓中找回。');
      closeAction();
      await loadLeads();
    } catch (err) {
      setError(getApiErrorMessage(err, '暂缓线索失败。'));
    } finally {
      setUpdatingId(null);
    }
  }

  async function performReject(leadId: string, reason: string) {
    setUpdatingId(leadId);
    setMessage('');
    setError('');
    try {
      await api.post(`/chronic-leads/${leadId}/reject`, reason.trim() ? { rejectReason: reason.trim() } : {});
      setMessage('已记录为"患者拒绝"。');
      closeAction();
      await loadLeads();
    } catch (err) {
      setError(getApiErrorMessage(err, '拒绝线索失败。'));
    } finally {
      setUpdatingId(null);
    }
  }

  async function performSign(
    leadId: string,
    payload: { consentRef: string; overrideName?: string; overridePhone?: string },
  ) {
    setUpdatingId(leadId);
    setMessage('');
    setError('');
    try {
      const res = await api.post<{ patient: { id: string; name: string } }>(
        `/chronic-leads/${leadId}/sign`,
        {
          consentSource: 'NURSE_CONFIRM',
          consentRef: payload.consentRef.trim(),
          ...(payload.overrideName ? { overrideName: payload.overrideName } : {}),
          ...(payload.overridePhone ? { overridePhone: payload.overridePhone } : {}),
        },
      );
      const newPatient = res.data?.patient;
      setMessage(
        newPatient
          ? `已为 ${newPatient.name} 建立慢病档案（患者ID: ${newPatient.id.slice(0, 8)}…）。`
          : '已建立慢病档案。',
      );
      closeAction();
      await loadLeads();
    } catch (err) {
      setError(getApiErrorMessage(err, '建档失败，请检查是否已存在同号患者或当前角色权限。'));
    } finally {
      setUpdatingId(null);
    }
  }

  /* ------------------------------- Render ------------------------------- */

  const statusChips: Array<'PENDING_REVIEW' | 'CONTACTED' | 'DEFERRED' | 'SIGNED' | 'REJECTED' | 'ALL'> = [
    'PENDING_REVIEW',
    'CONTACTED',
    'DEFERRED',
    'SIGNED',
    'REJECTED',
    'ALL',
  ];

  const diseaseChips: Array<'ALL' | DiseaseType> = [
    'ALL',
    'HYPERTENSION',
    'TYPE_2_DIABETES',
    'COPD',
    'CORONARY_HEART_DISEASE',
    'HYPERLIPIDEMIA',
  ];

  return (
    <div className="chronic-lead-invitation-page patient-binding-page">
      <section className="page-intro-card">
        <div>
          <h2 className="page-intro-title">高危慢病线索 · 邀约中心</h2>
          <p className="page-intro-subtitle">
            网关从 HIS / LIS / 出院信息中识别出的高危患者
            <strong>尚未签署知情同意</strong>，不进入正式档案。请逐条致电邀约，
            <strong>仅在患者口头同意后</strong>点击「签约」建档。
          </p>
        </div>
        <div className="page-intro-meta">
          <div className="page-intro-stat">
            <span className="page-intro-stat-num">{leads.filter((l) => l.status === 'PENDING_REVIEW').length}</span>
            <span className="page-intro-stat-label">待邀约</span>
          </div>
          <div className="page-intro-stat">
            <span className="page-intro-stat-num">{leads.filter((l) => l.status === 'CONTACTED').length}</span>
            <span className="page-intro-stat-label">已联系</span>
          </div>
          <div className="page-intro-stat">
            <span className="page-intro-stat-num">{leads.filter((l) => l.status === 'SIGNED').length}</span>
            <span className="page-intro-stat-label">已建档</span>
          </div>
        </div>
      </section>

      <section className="toolbar-card binding-toolbar-card">
        <div className="filter-group">
          {statusChips.map((item) => (
            <button
              key={item}
              className={statusFilter === item ? 'filter-chip active' : 'filter-chip'}
              onClick={() => changeStatus(item)}
            >
              {item === 'ALL' ? '全部' : statusLabel[item as LeadStatus]}
            </button>
          ))}
        </div>

        <div className="filter-group filter-group-secondary">
          {diseaseChips.map((item) => (
            <button
              key={item}
              className={
                diseaseFilter === item ? 'filter-chip filter-chip-small active' : 'filter-chip filter-chip-small'
              }
              onClick={() => changeDisease(item)}
            >
              {item === 'ALL' ? '所有病种' : diseaseLabel[item]}
            </button>
          ))}
        </div>

        <div className="binding-toolbar-actions">
          <input
            type="text"
            className="search-input"
            value={keyword}
            placeholder="搜索 姓名 / 院内号 / 手机 / ICD"
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') loadLeads();
            }}
          />
          <button className="secondary-btn" onClick={refresh} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </section>

      <section className="table-card binding-review-card chronic-lead-table-card">
        <table className="data-table chronic-lead-table">
          <thead>
            <tr>
              <th>入池时间</th>
              <th>患者快照</th>
              <th>慢病疑似 / 风险</th>
              <th>临床证据</th>
              <th>来源</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleLeads.map((lead) => {
              const isExpanded = expanded?.leadId === lead.id;
              return (
                <Fragment key={lead.id}>
                  <tr className={isExpanded ? 'row-expanded' : undefined}>
                    <td>
                      <div>{formatTime(lead.lastSeenAt)}</div>
                      {lead.hitCount > 1 && (
                        <div className="muted">命中 {lead.hitCount} 次</div>
                      )}
                    </td>
                    <td>
                      <div className="primary-cell">{lead.name || '（未提供姓名）'}</div>
                      <div className="muted">院内号：{lead.hospitalPatientId || '-'}</div>
                      <div className="muted">手机：{maskPhone(lead.phone)}</div>
                      <div className="muted">身份证：{maskIdCard(lead.idCardNo)}</div>
                    </td>
                    <td>
                      <div className="primary-cell">
                        {lead.suspectedDisease ? diseaseLabel[lead.suspectedDisease] : '—'}
                      </div>
                      <div className={riskClass(lead.riskHint)}>{riskLabel[lead.riskHint]}风险</div>
                    </td>
                    <td>
                      <div className="evidence-cell">
                        {lead.diagnosisIcd && (
                          <div>
                            <span className="evidence-tag">{lead.diagnosisIcd}</span>{' '}
                            <span>{lead.diagnosisText || ''}</span>
                          </div>
                        )}
                        {lead.evidenceSummary && (
                          <div className="evidence-summary">{lead.evidenceSummary}</div>
                        )}
                        {!lead.diagnosisIcd && !lead.evidenceSummary && (
                          <span className="muted">无结构化证据</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="source-pill">{sourceLabel[lead.sourceChannel]}</span>
                    </td>
                    <td>
                      <span className={statusBadgeClass(lead.status)}>{statusLabel[lead.status]}</span>
                      {lead.status === 'SIGNED' && lead.promotedPatient && (
                        <div className="muted lead-promoted-link">
                          <button
                            className="link-btn"
                            type="button"
                            onClick={() => navigate(`/patients/${lead.promotedPatient!.id}`)}
                          >
                            查看档案 →
                          </button>
                        </div>
                      )}
                      {lead.status === 'REJECTED' && lead.rejectReason && (
                        <div className="status-small-warn">{lead.rejectReason}</div>
                      )}
                      {lead.reviewedBy && lead.status !== 'PENDING_REVIEW' && (
                        <div className="muted">{lead.reviewedBy.displayName} · {formatTime(lead.reviewedAt)}</div>
                      )}
                    </td>
                    <td>
                      {actionableStatuses.includes(lead.status) ? (
                        <div className="action-row compact-actions chronic-lead-actions">
                          <button
                            className="primary-btn"
                            disabled={updatingId === lead.id}
                            onClick={() => openAction(lead.id, 'sign')}
                          >
                            签约
                          </button>
                          {lead.status === 'PENDING_REVIEW' && (
                            <button
                              className="secondary-btn"
                              disabled={updatingId === lead.id}
                              onClick={() => openAction(lead.id, 'contact')}
                            >
                              已联系
                            </button>
                          )}
                          <button
                            className="ghost-btn"
                            disabled={updatingId === lead.id}
                            onClick={() => openAction(lead.id, 'defer')}
                          >
                            暂缓
                          </button>
                          <button
                            className="ghost-btn ghost-btn-danger"
                            disabled={updatingId === lead.id}
                            onClick={() => openAction(lead.id, 'reject')}
                          >
                            拒绝
                          </button>
                        </div>
                      ) : (
                        <span className="muted">已处理</span>
                      )}
                    </td>
                  </tr>

                  {isExpanded && expanded && (
                    <tr className="row-action-form">
                      <td colSpan={7}>
                        {expanded.kind === 'sign' && (
                          <SignForm
                            lead={lead}
                            busy={updatingId === lead.id}
                            onCancel={closeAction}
                            onSubmit={(payload) => performSign(lead.id, payload)}
                          />
                        )}
                        {expanded.kind === 'reject' && (
                          <RejectForm
                            busy={updatingId === lead.id}
                            onCancel={closeAction}
                            onSubmit={(reason) => performReject(lead.id, reason)}
                          />
                        )}
                        {expanded.kind === 'contact' && (
                          <SimpleNoteForm
                            title="确认已联系患者"
                            description="护士已通过电话/线下联系患者，但患者尚未做出最终决定。可填写备注（如:已留语音/约下周再打）。"
                            submitLabel="标记为已联系"
                            busy={updatingId === lead.id}
                            onCancel={closeAction}
                            onSubmit={(note) => performContact(lead.id, note)}
                          />
                        )}
                        {expanded.kind === 'defer' && (
                          <SimpleNoteForm
                            title="暂缓本线索"
                            description="患者尚在住院/治疗中，暂不打扰，或暂时联系不上。可填写备注。"
                            submitLabel="标记为已暂缓"
                            busy={updatingId === lead.id}
                            onCancel={closeAction}
                            onSubmit={(note) => performDefer(lead.id, note)}
                          />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}

            {!visibleLeads.length && !loading && (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state">
                    {statusFilter === 'PENDING_REVIEW'
                      ? '当前没有待邀约线索。网关识别到新的高危信号时会自动出现在这里。'
                      : '没有符合条件的线索。'}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const actionableStatuses: LeadStatus[] = ['PENDING_REVIEW', 'CONTACTED', 'DEFERRED'];

/* -------------------------------------------------------------------------- */
/*  Sub-forms                                                                  */
/* -------------------------------------------------------------------------- */

function SignForm({
  lead,
  busy,
  onCancel,
  onSubmit,
}: {
  lead: ChronicLead;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: { consentRef: string; overrideName?: string; overridePhone?: string }) => void;
}) {
  const [consentRef, setConsentRef] = useState(
    `电话邀约 / 患者口头同意 / ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
  );
  const [overrideName, setOverrideName] = useState(lead.name ?? '');
  const [overridePhone, setOverridePhone] = useState(lead.phone ?? '');

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      consentRef,
      overrideName: overrideName !== (lead.name ?? '') ? overrideName : undefined,
      overridePhone: overridePhone !== (lead.phone ?? '') ? overridePhone : undefined,
    });
  }

  return (
    <form className="lead-action-form lead-action-form-sign" onSubmit={submit}>
      <div className="lead-action-header">
        <strong>签约建档 · 护士确认（NURSE_CONFIRM）</strong>
        <span className="muted">
          继续即在 Patient 表新建档案。该动作会写审计日志，不可撤销 ——
          请确认已获得患者口头同意。
        </span>
      </div>

      <div className="form-grid form-grid-2">
        <label className="form-field">
          <span>知情同意凭证 *</span>
          <input
            type="text"
            value={consentRef}
            onChange={(e) => setConsentRef(e.target.value)}
            placeholder="例如：电话录音编号 / 通话时间 / 患者口头确认"
            required
          />
        </label>
        <label className="form-field">
          <span>姓名（可覆盖）</span>
          <input
            type="text"
            value={overrideName}
            onChange={(e) => setOverrideName(e.target.value)}
            placeholder={lead.name ?? '请输入患者姓名'}
          />
        </label>
        <label className="form-field">
          <span>手机号（可覆盖）</span>
          <input
            type="text"
            value={overridePhone}
            onChange={(e) => setOverridePhone(e.target.value)}
            placeholder={lead.phone ?? '请输入手机号'}
          />
        </label>
      </div>

      <div className="lead-action-footer">
        <button type="button" className="ghost-btn" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button type="submit" className="primary-btn" disabled={busy || !consentRef.trim()}>
          {busy ? '正在建档…' : '确认建档'}
        </button>
      </div>
    </form>
  );
}

function RejectForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(reason);
  }

  return (
    <form className="lead-action-form lead-action-form-reject" onSubmit={submit}>
      <div className="lead-action-header">
        <strong>记录"患者拒绝加入慢病管理"</strong>
        <span className="muted">线索状态将变为已拒绝。不会从数据库删除（保留审计），但不会再出现在待邀约视图。</span>
      </div>

      <label className="form-field form-field-wide">
        <span>拒绝原因（可选）</span>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="例如：患者表示不需要长期管理 / 已在外院签约 / 联系不上 等"
        />
      </label>

      <div className="lead-action-footer">
        <button type="button" className="ghost-btn" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button type="submit" className="primary-btn primary-btn-danger" disabled={busy}>
          {busy ? '正在保存…' : '确认拒绝'}
        </button>
      </div>
    </form>
  );
}

function SimpleNoteForm({
  title,
  description,
  submitLabel,
  busy,
  onCancel,
  onSubmit,
}: {
  title: string;
  description: string;
  submitLabel: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(note);
  }

  return (
    <form className="lead-action-form" onSubmit={submit}>
      <div className="lead-action-header">
        <strong>{title}</strong>
        <span className="muted">{description}</span>
      </div>

      <label className="form-field form-field-wide">
        <span>备注（可选）</span>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="留下处理痕迹有助于团队协作"
        />
      </label>

      <div className="lead-action-footer">
        <button type="button" className="ghost-btn" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? '正在保存…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

