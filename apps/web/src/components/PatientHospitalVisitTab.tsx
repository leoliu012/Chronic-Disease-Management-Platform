import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { api, emitOperationNotice, getApiErrorMessage } from '../api/client';
import '../hospital-visit-tab-flat.css';

type Patient = {
  id: string;
  name: string;
  hospitalPatientId?: string;
  gender?: string;
  birthDate?: string;
  phone?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  responsibleDoctorId?: string | null;
  responsibleNurseId?: string | null;
};

type TimelineEvent = {
  type: string;
  time: string;
  title: string;
  description?: string;
  data: any;
};

type HospitalVisitReminder = {
  id: string;
  patientId: string;
  sourceRiskAlertId?: string | null;
  reason: string;
  note?: string | null;
  status: string;
  remindedAt: string;
  createdAt?: string;
  relatedTaskId?: string | null;
};

type VisitAction = 'remind-again' | 'arrived' | 'no-show' | 'refused' | 'revoke';

type ActiveForm =
  | { kind: 'create' }
  | { kind: 'action'; reminderId: string; action: VisitAction }
  | null;

type ActionDraft = {
  note: string;
  signature: string;
};

type Props = {
  patientId: string;
  patient: Patient;
  timeline: TimelineEvent[];
  activeHospitalVisitReminders: HospitalVisitReminder[];
  onChanged: () => Promise<void> | void;
  formatTime: (value?: string) => string;
  localizeBackendText: (value?: string | null) => string;
};

const actionLabelMap: Record<VisitAction, string> = {
  'remind-again': '再次提醒到院',
  arrived: '登记已到院',
  'no-show': '登记未到院',
  refused: '登记拒绝到院',
  revoke: '撤销提醒',
};

const actionTitleMap: Record<VisitAction, string> = {
  'remind-again': '再次提醒患者到院',
  arrived: '登记患者已到院检查',
  'no-show': '登记患者未到院',
  refused: '登记患者拒绝到院',
  revoke: '撤销本次到院提醒',
};

const actionNoteLabelMap: Record<VisitAction, string> = {
  'remind-again': '再次提醒内容',
  arrived: '到院检查记录',
  'no-show': '未到院说明',
  refused: '拒绝到院说明',
  revoke: '撤销原因',
};

const defaultActionNoteMap: Record<VisitAction, string> = {
  'remind-again': '再次通知患者建议门诊复诊/门急诊评估，并提醒保持电话畅通。',
  arrived: '已确认患者到院检查。',
  'no-show': '到院提醒超过两天，患者仍未到院。',
  refused: '患者明确表示拒绝到院检查。',
  revoke: '医护在患者详情页撤销到院提醒。',
};

const riskLabelMap: Record<string, string> = {
  LOW: '低危',
  MEDIUM: '中危',
  HIGH: '高危',
  VERY_HIGH: '极高危',
};

const statusLabelMap: Record<string, string> = {
  ACTIVE: '提醒中',
  ARRIVED: '已到院',
  NO_SHOW: '未到院',
  REFUSED: '拒绝到院',
  REVOKED: '已撤销',
};

function isOlderThanTwoDays(value?: string) {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() >= 48 * 60 * 60 * 1000;
}

function getFirstReminderTime(reminder?: HospitalVisitReminder | null) {
  return reminder?.createdAt || reminder?.remindedAt;
}

function getRiskClass(riskLevel?: string) {
  return `risk-badge risk-${String(riskLevel || '').toLowerCase().replace(/_/g, '-')}`;
}

function formatGender(value?: string) {
  const gender = String(value ?? '').toUpperCase();
  if (gender === 'MALE') return '男';
  if (gender === 'FEMALE') return '女';
  return '未登记';
}

function calculateAge(value?: string) {
  if (!value) return '未登记';
  const birth = new Date(value);
  if (Number.isNaN(birth.getTime())) return '未登记';
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age >= 0 && age < 130 ? `${age}岁` : '未登记';
}

function buildDefaultReason(alert?: TimelineEvent | null, localizeBackendText?: (value?: string | null) => string) {
  if (!alert) return '立即前往医院/门急诊评估：请患者携带近期居家监测记录到院复核。';
  const title = localizeBackendText ? localizeBackendText(alert.title) : alert.title;
  return `立即前往医院/门急诊评估：${title}`;
}

function getReminderRisk(reminder: HospitalVisitReminder, alerts: TimelineEvent[]) {
  if (!reminder.sourceRiskAlertId) return null;
  return alerts.find((item) => item.data?.id === reminder.sourceRiskAlertId) ?? null;
}

function activeFormKey(form: ActiveForm) {
  if (!form) return '';
  if (form.kind === 'create') return 'create';
  return `${form.reminderId}:${form.action}`;
}

export function PatientHospitalVisitTab({
  patientId,
  patient,
  timeline,
  activeHospitalVisitReminders,
  onChanged,
  formatTime,
  localizeBackendText,
}: Props) {
  const riskAlerts = useMemo(() => timeline.filter((item) => item.type === 'RISK_ALERT'), [timeline]);
  const activeRiskAlerts = useMemo(
    () => riskAlerts.filter((item) => ['OPEN', 'IN_PROGRESS'].includes(String(item.data?.status ?? ''))),
    [riskAlerts],
  );

  const [selectedAlertId, setSelectedAlertId] = useState('');
  const selectedAlert = useMemo(
    () => activeRiskAlerts.find((item) => item.data?.id === selectedAlertId) ?? activeRiskAlerts[0] ?? null,
    [activeRiskAlerts, selectedAlertId],
  );

  const [activeForm, setActiveForm] = useState<ActiveForm>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [signature, setSignature] = useState('');
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [actionDrafts, setActionDrafts] = useState<Record<string, ActionDraft>>({});
  // 顶部“当前到院提醒”横幅内的撤销表单（原因 + 工号，记录全程留存）。
  const [bannerRevokeOpen, setBannerRevokeOpen] = useState(false);
  const [bannerRevokeNote, setBannerRevokeNote] = useState('');
  const [bannerRevokeSignature, setBannerRevokeSignature] = useState('');
  const [bannerRevokeSubmitting, setBannerRevokeSubmitting] = useState(false);
  const hasActiveVisitReminder = activeHospitalVisitReminders.length > 0;

  useEffect(() => {
    if (!selectedAlertId && activeRiskAlerts[0]?.data?.id) {
      setSelectedAlertId(String(activeRiskAlerts[0].data.id));
    }
  }, [activeRiskAlerts, selectedAlertId]);

  useEffect(() => {
    if (activeForm?.kind !== 'create') return;
    setReason(buildDefaultReason(selectedAlert, localizeBackendText));
    setNote(selectedAlert?.description ? `风险依据：${localizeBackendText(selectedAlert.description)}` : '请患者携带近期居家监测记录到院复核。');
  }, [activeForm?.kind, localizeBackendText, selectedAlert]);

  useEffect(() => {
    if (hasActiveVisitReminder && activeForm?.kind === 'create') {
      setActiveForm(null);
    }
  }, [activeForm?.kind, hasActiveVisitReminder]);

  // Collapse the top-banner revoke form whenever the patient no longer has an
  // active reminder (e.g. it was just revoked or resolved elsewhere).
  useEffect(() => {
    if (!hasActiveVisitReminder && bannerRevokeOpen) {
      setBannerRevokeOpen(false);
      setBannerRevokeNote('');
      setBannerRevokeSignature('');
    }
  }, [hasActiveVisitReminder, bannerRevokeOpen]);

  function notify(type: 'success' | 'error' | 'warning', title: string, message: string) {
    emitOperationNotice({ type, title, message, operationKey: `hospital-visit-${Date.now()}` });
  }

  function openCreateForm() {
    if (hasActiveVisitReminder) {
      notify('warning', '已有有效到院提醒', '该患者当前已有有效到院提醒，请先登记到院/未到院/拒绝到院或撤销后再新建。');
      return;
    }
    setActiveForm((prev) => (prev?.kind === 'create' ? null : { kind: 'create' }));
  }

  function getDraftKey(reminderId: string, action: VisitAction) {
    return `${reminderId}:${action}`;
  }

  function getDraft(reminderId: string, action: VisitAction) {
    return actionDrafts[getDraftKey(reminderId, action)] ?? { note: '', signature: '' };
  }

  function updateDraft(reminderId: string, action: VisitAction, patch: Partial<ActionDraft>) {
    const key = getDraftKey(reminderId, action);
    setActionDrafts((prev) => ({
      ...prev,
      [key]: {
        note: prev[key]?.note ?? '',
        signature: prev[key]?.signature ?? '',
        ...patch,
      },
    }));
  }

  function clearDraft(reminderId: string, action: VisitAction) {
    const key = getDraftKey(reminderId, action);
    setActionDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasActiveVisitReminder) {
      notify('warning', '已有有效到院提醒', '该患者当前已有有效到院提醒，不能重复新建。请先完成或撤销现有到院提醒。');
      setActiveForm(null);
      return;
    }
    if (!reason.trim()) {
      notify('warning', '信息不完整', '请填写到院提醒原因。');
      return;
    }
    if (!signature.trim()) {
      notify('warning', '信息不完整', '请填写电子签名。');
      return;
    }

    setSubmittingCreate(true);
    try {
      await api.post(`/patients/${patientId}/hospital-visit-reminders`, {
        sourceRiskAlertId: selectedAlert?.data?.id || undefined,
        reason: reason.trim(),
        note: note.trim() || undefined,
        electronicSignature: signature.trim(),
      });
      notify('success', '到院提醒已发送', '患者端醒目到院提醒已生成；如果当前任务已开始处理，本次操作会自动进入任务处理流程。');
      setActiveForm(null);
      setReason('');
      setNote('');
      setSignature('');
      await onChanged();
    } catch (err) {
      console.error(err);
      notify('error', '到院提醒发送失败', getApiErrorMessage(err, '创建到院提醒失败，请稍后重试。'));
    } finally {
      setSubmittingCreate(false);
    }
  }

  async function submitAction(event: FormEvent<HTMLFormElement>, reminder: HospitalVisitReminder, action: VisitAction) {
    event.preventDefault();
    const draft = getDraft(reminder.id, action);
    if (!draft.signature.trim()) {
      notify('warning', '信息不完整', '请填写电子签名后再提交到院提醒处理结果。');
      return;
    }
    if ((action === 'no-show' || action === 'refused') && !isOlderThanTwoDays(reminder.remindedAt)) {
      notify('warning', '暂不能登记', '到院提醒发出未满两天，暂不能登记未到院或拒绝到院。');
      return;
    }

    const submitKey = getDraftKey(reminder.id, action);
    setSubmittingAction(submitKey);
    try {
      const body = {
        note: draft.note.trim() || defaultActionNoteMap[action],
        electronicSignature: draft.signature.trim(),
      };
      await api.patch(`/hospital-visit-reminders/${reminder.id}/${action}`, body);
      notify('success', `${actionLabelMap[action]}已提交`, '处理结果已保存；如果当前任务已开始处理，本次操作会自动进入任务处理流程。');
      clearDraft(reminder.id, action);
      setActiveForm(null);
      await onChanged();
    } catch (err) {
      console.error(err);
      notify('error', `${actionLabelMap[action]}失败`, getApiErrorMessage(err, '到院提醒处理失败，请稍后重试。'));
    } finally {
      setSubmittingAction(null);
    }
  }

  async function submitBannerRevoke(event: FormEvent<HTMLFormElement>, reminder?: HospitalVisitReminder) {
    event.preventDefault();
    if (!reminder) return;
    if (!bannerRevokeNote.trim()) {
      notify('warning', '信息不完整', '请填写撤销原因后再撤销到院提醒。');
      return;
    }
    if (!bannerRevokeSignature.trim()) {
      notify('warning', '信息不完整', '请填写工号 / 电子签名后再撤销到院提醒。');
      return;
    }
    setBannerRevokeSubmitting(true);
    try {
      await api.patch(`/hospital-visit-reminders/${reminder.id}/revoke`, {
        note: bannerRevokeNote.trim(),
        electronicSignature: bannerRevokeSignature.trim(),
      });
      notify('success', '撤销提醒已提交', '到院提醒已撤销；撤销原因、工号与时间已全程留存，并同步进入处置流程。');
      setBannerRevokeOpen(false);
      setBannerRevokeNote('');
      setBannerRevokeSignature('');
      await onChanged();
    } catch (err) {
      console.error(err);
      notify('error', '撤销提醒失败', getApiErrorMessage(err, '撤销到院提醒失败，请稍后重试。'));
    } finally {
      setBannerRevokeSubmitting(false);
    }
  }

  function renderVisitReminderBanner() {
    if (!hasActiveVisitReminder) return null;
    const primary = activeHospitalVisitReminders[0];
    return (
      <div className="follow-up-next-visit-banner is-imminent visit-reminder-top-banner" role="status">
        <div className="follow-up-next-visit-banner-main">
          <span className="follow-up-next-visit-banner-label">当前到院提醒</span>
          <strong className="follow-up-next-visit-banner-time">已存在有效到院提醒</strong>
          <span className="follow-up-next-visit-banner-hint">
            为避免患者端重复收到冲突提醒，请先处理或撤销当前提醒，再新建下一条。撤销需填写原因与工号，记录全程留存。
          </span>
          {primary && (
            <span className="follow-up-next-visit-banner-task-badge" title={primary.id}>
              {activeHospitalVisitReminders.length > 1
                ? `共 ${activeHospitalVisitReminders.length} 条有效提醒 · 最近通知 ${formatTime(primary.remindedAt)}`
                : `${localizeBackendText(primary.reason)} · 最近通知 ${formatTime(primary.remindedAt)}`}
            </span>
          )}
        </div>
        <div className="follow-up-next-visit-banner-actions">
          {bannerRevokeOpen ? (
            <form
              className="follow-up-next-visit-banner-edit visit-banner-revoke-form"
              onSubmit={(event) => submitBannerRevoke(event, primary)}
            >
              <label className="visit-banner-revoke-field">
                <span>撤销原因 <span className="required-mark">*</span></span>
                <textarea
                  value={bannerRevokeNote}
                  onChange={(event) => setBannerRevokeNote(event.target.value)}
                  rows={2}
                  placeholder="请说明撤销该到院提醒的原因"
                  disabled={bannerRevokeSubmitting}
                />
              </label>
              <label className="visit-banner-revoke-field">
                <span>工号 / 电子签名 <span className="required-mark">*</span></span>
                <input
                  value={bannerRevokeSignature}
                  onChange={(event) => setBannerRevokeSignature(event.target.value)}
                  placeholder="请输入护士姓名 / 工号"
                  disabled={bannerRevokeSubmitting}
                />
              </label>
              <div className="visit-banner-revoke-actions">
                <button className="button" type="submit" disabled={bannerRevokeSubmitting}>
                  {bannerRevokeSubmitting ? '撤销中…' : '确认撤销'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setBannerRevokeOpen(false);
                    setBannerRevokeNote('');
                    setBannerRevokeSignature('');
                  }}
                  disabled={bannerRevokeSubmitting}
                >
                  放弃
                </button>
              </div>
            </form>
          ) : (
            <button
              className="secondary-button"
              type="button"
              onClick={() => setBannerRevokeOpen(true)}
              disabled={Boolean(submittingAction)}
            >
              撤销提醒
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderCreateForm() {
    if (activeForm?.kind !== 'create') return null;
    return (
      <form className="hospital-form visit-flat-form visit-create-form" onSubmit={submitCreate}>
        <div className="visit-form-title-row">
          <div>
            <strong>新建到院提醒</strong>
            <p>患者端会显示醒目到院提醒；任务开始后，该操作会自动进入右侧处理流程。</p>
          </div>
          <button className="ghost-button compact-link-btn" type="button" onClick={() => setActiveForm(null)} disabled={submittingCreate}>取消</button>
        </div>
        <div className="form-grid form-grid-two">
          <div className="form-row">
            <label>关联风险依据</label>
            <select value={selectedAlert?.data?.id ?? ''} onChange={(event) => setSelectedAlertId(event.target.value)} disabled={submittingCreate}>
              {activeRiskAlerts.length === 0 && <option value="">无进行中的风险预警</option>}
              {activeRiskAlerts.map((alert) => (
                <option key={alert.data?.id ?? alert.time} value={alert.data?.id ?? ''}>
                  {localizeBackendText(alert.title)} · {riskLabelMap[alert.data?.riskLevel] ?? alert.data?.riskLevel ?? '未分级'}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>电子签名 <span className="required-mark">*</span></label>
            <input value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="请输入护士姓名 / 工号" disabled={submittingCreate} />
          </div>
        </div>
        {selectedAlert && (
          <div className="visit-inline-risk-row">
            <span className={getRiskClass(selectedAlert.data?.riskLevel)}>{riskLabelMap[selectedAlert.data?.riskLevel] ?? selectedAlert.data?.riskLevel}</span>
            <strong>{localizeBackendText(selectedAlert.title)}</strong>
            <p>{localizeBackendText(selectedAlert.description)}</p>
          </div>
        )}
        <div className="form-row">
          <label>到院提醒原因</label>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} disabled={submittingCreate} />
        </div>
        <div className="form-row">
          <label>患者端提醒说明</label>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} disabled={submittingCreate} />
        </div>
        <div className="form-actions sticky-form-actions pro-form-actions">
          <button className="button" type="submit" disabled={submittingCreate}>{submittingCreate ? '发送中...' : '发送到院提醒'}</button>
        </div>
      </form>
    );
  }

  function renderActionForm(reminder: HospitalVisitReminder, action: VisitAction) {
    const draft = getDraft(reminder.id, action);
    const submitKey = getDraftKey(reminder.id, action);
    const submitting = submittingAction === submitKey;
    const overdue = isOlderThanTwoDays(reminder.remindedAt);
    const disabledByTime = (action === 'no-show' || action === 'refused') && !overdue;

    return (
      <form className="hospital-form visit-flat-form visit-action-expanded-form" onSubmit={(event) => submitAction(event, reminder, action)}>
        <div className="visit-form-title-row">
          <div>
            <strong>{actionTitleMap[action]}</strong>
            <p>{disabledByTime ? '到院提醒发出未满两天，暂不能登记该结果。' : '提交后会保存到院提醒结果；任务开始后，该动作会自动进入右侧处理流程。'}</p>
          </div>
          <button className="ghost-button compact-link-btn" type="button" onClick={() => setActiveForm(null)} disabled={submitting}>取消</button>
        </div>
        <div className="form-grid form-grid-two">
          <div className="form-row">
            <label>{actionNoteLabelMap[action]}</label>
            <textarea
              value={draft.note}
              onChange={(event) => updateDraft(reminder.id, action, { note: event.target.value })}
              rows={4}
              placeholder={defaultActionNoteMap[action]}
              disabled={submitting || disabledByTime}
            />
          </div>
          <div className="form-row">
            <label>电子签名 <span className="required-mark">*</span></label>
            <input
              value={draft.signature}
              onChange={(event) => updateDraft(reminder.id, action, { signature: event.target.value })}
              placeholder="请输入护士姓名 / 工号"
              disabled={submitting || disabledByTime}
            />
          </div>
        </div>
        <div className="form-actions sticky-form-actions pro-form-actions">
          <button className="button" type="submit" disabled={submitting || disabledByTime}>
            {submitting ? '提交中...' : `提交：${actionLabelMap[action]}`}
          </button>
        </div>
      </form>
    );
  }

  return (
    <section className="panel patient-hospital-visit-tab-panel visit-flat-panel">
      <div className="hospital-section-header visit-flat-header">
        <div>
          <span>到院提醒</span>
          <h2>到院提醒</h2>
        </div>
        <button
          className={hasActiveVisitReminder ? 'secondary-button disabled-button' : activeForm?.kind === 'create' ? 'secondary-button' : 'button'}
          type="button"
          onClick={openCreateForm}
          disabled={hasActiveVisitReminder}
          title={hasActiveVisitReminder ? '该患者当前已有有效到院提醒，处理或撤销后才能新建。' : undefined}
        >
          {hasActiveVisitReminder ? '已有有效到院提醒' : activeForm?.kind === 'create' ? '收起新建' : '新建到院提醒'}
        </button>
      </div>

      {renderVisitReminderBanner()}

      <section className="visit-patient-detail-card" aria-label="患者到院提醒联系信息">
        <div className="visit-patient-detail-identity">
          <div>
            <span>患者信息</span>
            <h3>{patient.name}</h3>
            <p>
              {formatGender(patient.gender)} · {calculateAge(patient.birthDate)} · {patient.hospitalPatientId ? `病案号 ${patient.hospitalPatientId}` : '病案号未登记'}
            </p>
          </div>
          <strong className={hasActiveVisitReminder ? 'visit-active-count active' : 'visit-active-count'}>
            {hasActiveVisitReminder ? `${activeHospitalVisitReminders.length} 条有效提醒` : '暂无有效提醒'}
          </strong>
        </div>

        <div className="visit-patient-detail-grid">
          <div className="visit-patient-detail-item primary-contact">
            <span>联系电话</span>
            <strong>{patient.phone ?? '-'}</strong>
            {patient.phone ? <a href={`tel:${patient.phone}`}>拨打患者电话</a> : <small>未登记患者电话</small>}
          </div>
          <div className="visit-patient-detail-item address-item">
            <span>居住地址</span>
            <strong>{patient.address || '未登记'}</strong>
            <small>用于核对到院交通、社区随访和紧急联系安排</small>
          </div>
          <div className="visit-patient-detail-item">
            <span>紧急联系人</span>
            <strong>{patient.emergencyContactName || '未登记'}</strong>
            {patient.emergencyContactPhone ? <a href={`tel:${patient.emergencyContactPhone}`}>{patient.emergencyContactPhone}</a> : <small>暂无紧急联系人电话</small>}
          </div>
          <div className="visit-patient-detail-item">
            <span>责任医护</span>
            <strong>医生：{patient.responsibleDoctorId || '未分配'}</strong>
            <small>护士：{patient.responsibleNurseId || '未分配'}</small>
          </div>
        </div>

      </section>

      {renderCreateForm()}

      <div className="visit-flat-list-header">
        <div>
          <h3>当前有效到院提醒</h3>
          <p>选择一个处理动作后，仅展开该动作对应表单，避免一层套一层。</p>
        </div>
        <strong>{activeHospitalVisitReminders.length} 条</strong>
      </div>

      {activeHospitalVisitReminders.length === 0 ? (
        <div className="empty-state compact-empty visit-flat-empty">当前患者没有有效到院提醒。可点击“新建到院提醒”生成患者端提醒。</div>
      ) : (
        <div className="visit-reminder-table" role="list">
          {activeHospitalVisitReminders.map((reminder) => {
            const alert = getReminderRisk(reminder, riskAlerts);
            const overdue = isOlderThanTwoDays(reminder.remindedAt);
            const currentActiveKey = activeFormKey(activeForm);
            return (
              <article className="visit-reminder-row" key={reminder.id} role="listitem">
                <div className="visit-reminder-main">
                  <div className="visit-reminder-title-line">
                    <strong>{localizeBackendText(reminder.reason)}</strong>
                    <em>{statusLabelMap[reminder.status] ?? reminder.status}</em>
                  </div>
                  <p>首次提醒：{formatTime(getFirstReminderTime(reminder))}；最近通知：{formatTime(reminder.remindedAt)}{overdue ? '；已超过两天，可登记未到院/拒绝到院。' : '；未满两天，暂不登记未到院/拒绝到院。'}</p>
                  {alert && (
                    <div className="visit-risk-line">
                      <span className={getRiskClass(alert.data?.riskLevel)}>{riskLabelMap[alert.data?.riskLevel] ?? alert.data?.riskLevel}</span>
                      <strong>{localizeBackendText(alert.title)}</strong>
                      <small>{localizeBackendText(alert.description)}</small>
                    </div>
                  )}
                  {reminder.note && <p className="visit-reminder-note">提醒说明：{localizeBackendText(reminder.note)}</p>}
                </div>

                <div className="visit-action-card-row" aria-label="到院提醒处理动作">
                  {(['remind-again', 'arrived', 'no-show', 'refused', 'revoke'] as VisitAction[]).map((action) => {
                    const key = getDraftKey(reminder.id, action);
                    const disabledByTime = (action === 'no-show' || action === 'refused') && !overdue;
                    return (
                      <button
                        key={action}
                        type="button"
                        className={currentActiveKey === key ? 'visit-action-card active' : 'visit-action-card'}
                        onClick={() => setActiveForm(currentActiveKey === key ? null : { kind: 'action', reminderId: reminder.id, action })}
                        disabled={disabledByTime || Boolean(submittingAction?.startsWith(`${reminder.id}:`))}
                        title={disabledByTime ? '到院提醒发出未满两天，暂不能登记。' : undefined}
                      >
                        <span>{actionLabelMap[action]}</span>
                        <small>{action === 'remind-again' ? '刷新通知' : action === 'arrived' ? '闭环结果' : action === 'revoke' ? '撤销提醒' : '两天后登记'}</small>
                      </button>
                    );
                  })}
                </div>

                {activeForm?.kind === 'action' && activeForm.reminderId === reminder.id && renderActionForm(reminder, activeForm.action)}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
