/**
 * PublicFormPage
 * ---------------
 * 患者一次性 H5 链接落地页：
 *   - 仅通过 URL 中的 :token 访问
 *   - 与 Web 后台共用同一域名 / 同一 React 应用，但完全位于 AuthenticatedShell 之外
 *   - 不依赖患者绑定 session、不需要登录
 *   - 移动端优先；大字号；表单宽度铺满
 *
 * 路由: /wx/form/:token
 *
 * 后端: /public-forms/:token (GET)
 *      /public-forms/:token/identity-check (POST)
 *      /public-forms/:token/questionnaire (POST)
 *      /public-forms/:token/vitals (POST)
 *      /public-forms/:token/medication-checkin (POST)
 *      /public-forms/:token/hospital-visit-confirm (POST)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE_URL } from '../api/client';
import '../patient-engagement-public-form.css';

type FormType =
  | 'QUESTIONNAIRE'
  | 'VITAL_RECHECK'
  | 'MEDICATION_CHECKIN'
  | 'HOSPITAL_VISIT_CONFIRM'
  | 'CONSENT_ONLY'
  | 'GENERIC_NOTICE'
  | 'GENERAL_MESSAGE';

type FormMeta = {
  valid: boolean;
  status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED';
  // patient_engagement_v3_2 — nurse-entered reason shown on a revoked link
  revokeReason?: string | null;
  type: FormType;
  title: string;
  description: string | null;
  expiresAt: string | null;
  requiresIdentityCheck: boolean;
  payload: Record<string, unknown> | null;
  patientMaskedName: string;
  patientGender: 'MALE' | 'FEMALE' | null;
  hospitalDisplayName: string;
  // patient_engagement_hospital_wechat_v2
  hospital?: {
    id: string;
    name: string;
    displayName: string;
    serviceAccountName: string | null;
  } | null;
};

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

const STATUS_LABEL: Record<FormMeta['status'], string> = {
  ACTIVE: '可填写',
  USED: '已提交',
  EXPIRED: '已过期',
  REVOKED: '已撤销',
};

async function publicGet<T>(path: string): Promise<{ ok: boolean; status: number; body: T | { code?: string; message?: string } }> {
  const res = await fetch(`${API_BASE_URL}${path}`, { credentials: 'omit' });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

async function publicPost<T>(path: string, payload: unknown): Promise<{ ok: boolean; status: number; body: T | { code?: string; message?: string } }> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

function describeError(body: any, fallback: string): string {
  if (!body) return fallback;
  if (typeof body === 'string') return body || fallback;
  if (typeof body.message === 'string') return body.message;
  if (Array.isArray(body.message)) return body.message.join('；');
  return fallback;
}

export function PublicFormPage() {
  const { token } = useParams();
  const [meta, setMeta] = useState<FormMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formSessionToken, setFormSessionToken] = useState<string | null>(null);
  const [identityState, setIdentityState] = useState<SubmitState>({ kind: 'idle' });
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: 'idle' });

  const requiresIdentity = useMemo(() => {
    return meta?.requiresIdentityCheck === true && !formSessionToken;
  }, [meta, formSessionToken]);

  // ---- initial load ----
  useEffect(() => {
    let alive = true;
    if (!token) {
      setLoadError('链接无效');
      return;
    }
    (async () => {
      const res = await publicGet<FormMeta>(`/public-forms/${encodeURIComponent(token)}`);
      if (!alive) return;
      if (res.status === 200 && (res.body as any)?.status) {
        setMeta(res.body as FormMeta);
        return;
      }
      setLoadError(describeError(res.body, '链接无效或已被撤销'));
    })();
    return () => { alive = false; };
  }, [token]);

  if (!token) return <FullPageNotice title="链接无效" body="未携带访问令牌。" />;
  if (loadError) return <FullPageNotice title="链接不可用" body={loadError} />;
  if (!meta) return <FullPageNotice title="正在加载" body="正在确认随访任务…" />;

  if (meta.status !== 'ACTIVE') {
    const label = STATUS_LABEL[meta.status];
    // v3.2: a REVOKED link means the nurse intentionally canceled this
    // reminder. Show a friendly message with their reason — never a raw
    // token error.
    if (meta.status === 'REVOKED') {
      const reason = (meta.revokeReason || '').trim();
      const revokedBody =
        '医院工作人员已取消本次提醒。' +
        (reason ? `\n原因：${reason}` : '') +
        '\n如有疑问，请联系医院慢病管理团队。';
      return <FullPageNotice title="该提醒已失效" body={revokedBody} />;
    }
    const body =
      meta.status === 'USED'
        ? '本链接对应的随访任务已经提交过。如果有疑问，请联系医院慢病管理团队。'
        : meta.status === 'EXPIRED'
          ? '链接已过期。请联系医院慢病管理团队重新发送新链接。'
          : '链接已被医院撤销。请等待新的链接，或直接联系医院。';
    return <FullPageNotice title={`链接${label}`} body={body} />;
  }

  return (
    <div className="pe-public-shell">
      <header className="pe-public-header">
        <div className="pe-public-hospital">{meta.hospitalDisplayName}</div>
        <h1 className="pe-public-title">{meta.title}</h1>
        <p className="pe-public-greeting">
          {meta.patientMaskedName || '您好'} {meta.patientGender === 'FEMALE' ? '女士' : meta.patientGender === 'MALE' ? '先生' : ''}，您本次的随访任务如下：
        </p>
        {meta.description && <p className="pe-public-description">{meta.description}</p>}
        {meta.expiresAt && (
          <p className="pe-public-deadline">
            请在 <strong>{new Date(meta.expiresAt).toLocaleString('zh-CN', { hour12: false })}</strong> 前完成填写。
          </p>
        )}
      </header>

      <main className="pe-public-main">
        {requiresIdentity ? (
          <IdentityCheckBlock
            token={token}
            state={identityState}
            onResult={(result) => {
              if (result.ok) {
                setFormSessionToken(result.formSessionToken!);
                setIdentityState({ kind: 'success', message: '校验通过，请继续填写。' });
              } else {
                setIdentityState({ kind: 'error', message: result.message });
              }
            }}
            onSubmitting={() => setIdentityState({ kind: 'submitting' })}
          />
        ) : (
          <FormBody
            token={token}
            meta={meta}
            formSessionToken={formSessionToken}
            submitState={submitState}
            setSubmitState={setSubmitState}
          />
        )}
      </main>

      <footer className="pe-public-footer">
        <p>本链接仅用于本次随访任务，提交一次后自动失效。</p>
        <p className="pe-public-mp-hint">
          您也可以在微信中搜索本院的慢病管理服务号，开通后即可在服务号中查看日常打卡与随访任务。
        </p>
      </footer>
    </div>
  );
}

function FullPageNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="pe-public-shell pe-public-notice">
      <div className="pe-public-notice-card">
        <h1>{title}</h1>
        <p>{body}</p>
        <button type="button" className="pe-public-close-button" onClick={() => window.close?.()}>
          关闭页面
        </button>
      </div>
    </div>
  );
}

// ===========================================================================
// IdentityCheckBlock
// ===========================================================================

function IdentityCheckBlock(props: {
  token: string;
  state: SubmitState;
  onResult: (r: { ok: true; formSessionToken: string } | { ok: false; message: string }) => void;
  onSubmitting: () => void;
}) {
  const [phoneLast4, setPhoneLast4] = useState('');
  const [idCardLast4, setIdCardLast4] = useState('');
  const [birthDate, setBirthDate] = useState('');

  async function submit() {
    if (!phoneLast4 && !idCardLast4 && !birthDate) {
      props.onResult({ ok: false, message: '请至少填写一项校验信息。' });
      return;
    }
    props.onSubmitting();
    const res = await publicPost<{ passed: boolean; formSessionToken: string }>(
      `/public-forms/${encodeURIComponent(props.token)}/identity-check`,
      { phoneLast4, idCardLast4, birthDate },
    );
    if (res.ok && (res.body as any)?.passed) {
      props.onResult({ ok: true, formSessionToken: (res.body as any).formSessionToken });
    } else {
      props.onResult({ ok: false, message: describeError(res.body, '校验未通过，请确认填写信息。') });
    }
  }

  return (
    <section className="pe-public-section">
      <h2>身份校验</h2>
      <p className="pe-public-hint">为了保护您的隐私，请补充以下任一信息以确认身份。</p>
      <label className="pe-public-field">
        <span>手机号末 4 位</span>
        <input
          type="tel"
          inputMode="numeric"
          maxLength={4}
          value={phoneLast4}
          onChange={(e) => setPhoneLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="例如：8888"
        />
      </label>
      <label className="pe-public-field">
        <span>身份证末 4 位</span>
        <input
          type="text"
          maxLength={4}
          value={idCardLast4}
          onChange={(e) => setIdCardLast4(e.target.value.toUpperCase().slice(0, 4))}
          placeholder="例如：123X"
        />
      </label>
      <label className="pe-public-field">
        <span>出生日期</span>
        <input
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
        />
      </label>

      {props.state.kind === 'error' && <p className="pe-public-error">{props.state.message}</p>}
      {props.state.kind === 'success' && <p className="pe-public-success">{props.state.message}</p>}

      <button
        type="button"
        className="pe-public-primary-button"
        disabled={props.state.kind === 'submitting'}
        onClick={submit}
      >
        {props.state.kind === 'submitting' ? '校验中…' : '确认校验'}
      </button>
    </section>
  );
}

// ===========================================================================
// FormBody — switches by type
// ===========================================================================

function FormBody(props: {
  token: string;
  meta: FormMeta;
  formSessionToken: string | null;
  submitState: SubmitState;
  setSubmitState: (s: SubmitState) => void;
}) {
  const { token, meta, formSessionToken, submitState, setSubmitState } = props;

  const doSubmit = useCallback(
    async (path: string, payload: any) => {
      setSubmitState({ kind: 'submitting' });
      const res = await publicPost<{ ok: boolean; message: string }>(
        `/public-forms/${encodeURIComponent(token)}/${path}`,
        { ...payload, formSessionToken },
      );
      if (res.ok && (res.body as any)?.ok) {
        setSubmitState({ kind: 'success', message: (res.body as any).message || '提交成功' });
      } else {
        setSubmitState({ kind: 'error', message: describeError(res.body, '提交失败，请稍后再试。') });
      }
    },
    [token, formSessionToken, setSubmitState],
  );

  if (submitState.kind === 'success') {
    return <SuccessPanel message={submitState.message} />;
  }

  if (meta.type === 'QUESTIONNAIRE') {
    return <QuestionnaireForm meta={meta} submit={(p) => doSubmit('questionnaire', p)} state={submitState} />;
  }
  if (meta.type === 'VITAL_RECHECK') {
    return <VitalRecheckForm meta={meta} submit={(p) => doSubmit('vitals', p)} state={submitState} />;
  }
  if (meta.type === 'MEDICATION_CHECKIN') {
    return <MedicationCheckInForm meta={meta} submit={(p) => doSubmit('medication-checkin', p)} state={submitState} />;
  }
  if (meta.type === 'HOSPITAL_VISIT_CONFIRM') {
    return <HospitalVisitForm meta={meta} submit={(p) => doSubmit('hospital-visit-confirm', p)} state={submitState} />;
  }
  if (meta.type === 'GENERAL_MESSAGE') {
    return <GeneralMessageForm meta={meta} submit={(p) => doSubmit('general-message-ack', p)} state={submitState} />;
  }
  return <FullPageNotice title="暂不支持的任务类型" body="请联系医院慢病管理团队。" />;
}

function SuccessPanel({ message }: { message: string }) {
  return (
    <section className="pe-public-section pe-public-success-card">
      <h2>提交成功</h2>
      <p>{message}</p>
      <p className="pe-public-hint">
        您的信息已提交给医院慢病管理团队。若数据提示异常，医护人员可能会主动与您联系。
      </p>
      <button type="button" className="pe-public-primary-button" onClick={() => window.close?.()}>
        关闭页面
      </button>
    </section>
  );
}

// ----- QuestionnaireForm -----

type QuestionnaireScoringItem = {
  answerKey: string;
  label: string;
  required?: boolean;
  allowedValues: number[];
  hints?: string[];
};

function QuestionnaireForm({
  meta,
  submit,
  state,
}: {
  meta: FormMeta;
  submit: (payload: any) => void;
  state: SubmitState;
}) {
  const payload = (meta.payload ?? {}) as Record<string, any>;
  const questionnaireType: string = payload.questionnaireType || 'GENERIC';
  const scoringRule = payload.questionnaireRuleSnapshot?.scoringRule;
  const items: QuestionnaireScoringItem[] = Array.isArray(scoringRule?.items)
    ? scoringRule.items.filter(
        (item: any) =>
          item &&
          typeof item.answerKey === 'string' &&
          typeof item.label === 'string' &&
          Array.isArray(item.allowedValues) &&
          item.allowedValues.length > 0,
      )
    : [];
  const [answers, setAnswers] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      items.map((item) => [item.answerKey, Number(item.allowedValues[0])]),
    ),
  );
  const [note, setNote] = useState('');

  if (!items.length) {
    return (
      <section className="pe-public-section">
        <h2>{questionnaireLabel(questionnaireType)}</h2>
        <p className="pe-public-error">
          该问卷链接签发于安全升级前，请联系医院慢病管理团队重新发送。
        </p>
      </section>
    );
  }

  return (
    <section className="pe-public-section">
      <h2>{questionnaireLabel(questionnaireType)}</h2>
      <p className="pe-public-hint">请根据实际情况填写。问卷评分由医院服务端按照签发时固化的规则计算。</p>
      {items.map((item) => (
        <ScoreField
          key={item.answerKey}
          label={item.label}
          value={answers[item.answerKey] ?? Number(item.allowedValues[0])}
          onChange={(value) => setAnswers((current) => ({ ...current, [item.answerKey]: value }))}
          values={item.allowedValues}
          hints={item.hints ?? item.allowedValues.map((value) => String(value))}
        />
      ))}
      <label className="pe-public-field">
        <span>其他需要医护知道的情况（选填）</span>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：最近偶有头晕、夜间睡眠差等" />
      </label>

      {state.kind === 'error' && <p className="pe-public-error">{state.message}</p>}
      <button
        type="button"
        className="pe-public-primary-button"
        disabled={state.kind === 'submitting'}
        onClick={() => submit({ answers, note })}
      >
        {state.kind === 'submitting' ? '提交中…' : '提交问卷'}
      </button>
    </section>
  );
}

function ScoreField({
  label,
  value,
  onChange,
  hints,
  values,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hints: string[];
  values: number[];
}) {
  return (
    <div className="pe-public-field pe-public-score-field">
      <span>{label}</span>
      <div className="pe-public-score-options">
        {values.map((optionValue, index) => (
          <button
            key={optionValue}
            type="button"
            className={value === optionValue ? 'pe-public-score-option active' : 'pe-public-score-option'}
            onClick={() => onChange(optionValue)}
          >
            <strong>{optionValue}</strong>
            <small>{hints[index] ?? String(optionValue)}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function questionnaireLabel(t: string): string {
  const map: Record<string, string> = {
    HYPERTENSION_FOLLOWUP: '高血压随访问卷',
    HYPERTENSION_MONTHLY: '高血压月度随访问卷',
    DIABETES_FOLLOWUP: '糖尿病随访问卷',
    DIABETES_MONTHLY: '糖尿病月度随访问卷',
    COPD_FOLLOWUP: '慢阻肺随访问卷',
    COPD_CAT: '慢阻肺 CAT 症状评估',
    LIPID_LIFESTYLE: '血脂生活方式问卷',
    OBESITY_LIFESTYLE: '体重管理生活方式问卷',
  };
  return map[t] || `随访问卷：${t}`;
}

// ----- VitalRecheckForm -----

function VitalRecheckForm({
  meta,
  submit,
  state,
}: {
  meta: FormMeta;
  submit: (payload: any) => void;
  state: SubmitState;
}) {
  const payload = (meta.payload ?? {}) as Record<string, any>;
  const vitalType: string = payload.expectedVitalType || payload.vitalType || 'BLOOD_PRESSURE';
  const canonicalUnit: string = payload.canonicalUnit || payload.unit || defaultUnit(vitalType);
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');

  function handleSubmit() {
    if (vitalType === 'BLOOD_PRESSURE') {
      submit({
        systolic: Number(systolic),
        diastolic: Number(diastolic),
        note,
      });
    } else {
      submit({
        value: Number(value),
        note,
      });
    }
  }

  return (
    <section className="pe-public-section">
      <h2>提交：{vitalLabel(vitalType)} 复测</h2>
      <p className="pe-public-hint">请填写最近一次测量结果，建议测量后立即录入。</p>
      {vitalType === 'BLOOD_PRESSURE' ? (
        <>
          <label className="pe-public-field">
            <span>收缩压 ({canonicalUnit})</span>
            <input
              type="number"
              inputMode="decimal"
              value={systolic}
              onChange={(e) => setSystolic(e.target.value)}
              placeholder="例如：138"
              min={50}
              max={260}
            />
          </label>
          <label className="pe-public-field">
            <span>舒张压 ({canonicalUnit})</span>
            <input
              type="number"
              inputMode="decimal"
              value={diastolic}
              onChange={(e) => setDiastolic(e.target.value)}
              placeholder="例如：88"
              min={30}
              max={160}
            />
          </label>
        </>
      ) : (
        <label className="pe-public-field">
          <span>{vitalLabel(vitalType)} ({canonicalUnit})</span>
          <input
            type="number"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`例如：${vitalType === 'BLOOD_GLUCOSE' ? '7.2' : '95'}`}
          />
        </label>
      )}
      <label className="pe-public-field">
        <span>说明（选填）</span>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：测量前剧烈运动 / 空腹 / 饭后等" />
      </label>

      {state.kind === 'error' && <p className="pe-public-error">{state.message}</p>}
      <button
        type="button"
        className="pe-public-primary-button"
        disabled={state.kind === 'submitting'}
        onClick={handleSubmit}
      >
        {state.kind === 'submitting' ? '提交中…' : '提交复测结果'}
      </button>
    </section>
  );
}

function vitalLabel(type: string): string {
  const map: Record<string, string> = {
    BLOOD_PRESSURE: '血压',
    SYSTOLIC_BP: '血压',
    DIASTOLIC_BP: '血压',
    BLOOD_GLUCOSE: '血糖',
    WEIGHT: '体重',
    HEART_RATE: '心率',
    SPO2: '血氧',
  };
  return map[type] || type;
}

function defaultUnit(type: string): string {
  const map: Record<string, string> = {
    BLOOD_PRESSURE: 'mmHg',
    BLOOD_GLUCOSE: 'mmol/L',
    WEIGHT: 'kg',
    HEART_RATE: 'bpm',
    SPO2: '%',
  };
  return map[type] || '';
}

// ----- MedicationCheckInForm -----

function MedicationCheckInForm({
  meta,
  submit,
  state,
}: {
  meta: FormMeta;
  submit: (payload: any) => void;
  state: SubmitState;
}) {
  const payload = (meta.payload ?? {}) as Record<string, any>;
  const [taken, setTaken] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const medName = payload.medicationName || '本药品';

  function handleSubmit() {
    if (taken === null) return;
    submit({
      taken,
      checkedAt: new Date().toISOString(),
      scheduledAt: payload.scheduledAt || undefined,
      note,
    });
  }

  return (
    <section className="pe-public-section">
      <h2>用药打卡：{medName}</h2>
      {payload.dosage && <p className="pe-public-hint">剂量：{payload.dosage} {payload.frequency ? '· 频次：' + payload.frequency : ''}</p>}
      <div className="pe-public-toggle-group">
        <button
          type="button"
          className={taken === true ? 'pe-public-toggle-option active' : 'pe-public-toggle-option'}
          onClick={() => setTaken(true)}
        >
          已按时服用
        </button>
        <button
          type="button"
          className={taken === false ? 'pe-public-toggle-option active danger' : 'pe-public-toggle-option danger'}
          onClick={() => setTaken(false)}
        >
          未服用 / 漏服
        </button>
      </div>
      <label className="pe-public-field">
        <span>说明（选填）</span>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：因外出忘记服药，下次会按时" />
      </label>
      {state.kind === 'error' && <p className="pe-public-error">{state.message}</p>}
      <button
        type="button"
        className="pe-public-primary-button"
        disabled={state.kind === 'submitting' || taken === null}
        onClick={handleSubmit}
      >
        {state.kind === 'submitting' ? '提交中…' : '提交打卡'}
      </button>
    </section>
  );
}

// ----- HospitalVisitForm -----

function HospitalVisitForm({
  meta,
  submit,
  state,
}: {
  meta: FormMeta;
  submit: (payload: any) => void;
  state: SubmitState;
}) {
  const payload = (meta.payload ?? {}) as Record<string, any>;
  const [action, setAction] = useState<'WILL_VISIT' | 'ARRIVED' | 'CANNOT_VISIT' | 'REFUSED' | null>(null);
  const [note, setNote] = useState('');

  function handleSubmit() {
    if (!action) return;
    submit({ action, note });
  }

  return (
    <section className="pe-public-section">
      <h2>到院安排反馈</h2>
      {payload.reason && <p className="pe-public-hint">医院备注：{payload.reason}</p>}
      <p className="pe-public-hint">请选择您当前的情况：</p>
      <div className="pe-public-action-grid">
        <ActionTile label="我会尽快到院" active={action === 'WILL_VISIT'} onClick={() => setAction('WILL_VISIT')} />
        <ActionTile label="我已到院" active={action === 'ARRIVED'} onClick={() => setAction('ARRIVED')} />
        <ActionTile label="暂时无法到院" active={action === 'CANNOT_VISIT'} onClick={() => setAction('CANNOT_VISIT')} danger />
        <ActionTile label="不愿到院" active={action === 'REFUSED'} onClick={() => setAction('REFUSED')} danger />
      </div>
      <label className="pe-public-field">
        <span>说明（选填）</span>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：本周出差，下周可到院" />
      </label>
      {state.kind === 'error' && <p className="pe-public-error">{state.message}</p>}
      <button
        type="button"
        className="pe-public-primary-button"
        disabled={state.kind === 'submitting' || !action}
        onClick={handleSubmit}
      >
        {state.kind === 'submitting' ? '提交中…' : '提交反馈'}
      </button>
    </section>
  );
}

function ActionTile({
  label,
  active,
  onClick,
  danger,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  const cls = [
    'pe-public-action-tile',
    active ? 'active' : '',
    danger ? 'danger' : '',
  ].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} onClick={onClick}>
      {label}
    </button>
  );
}

export default PublicFormPage;




// =============================================================================
// care-reminders v3 — GENERAL_MESSAGE H5 (senior-friendly)
// =============================================================================
function GeneralMessageForm({
  meta,
  submit,
  state,
}: {
  meta: FormMeta;
  submit: (payload: any) => void;
  state: SubmitState;
}) {
  const requiresAck = Boolean((meta.payload as any)?.requiresAck);
  const priority = String((meta.payload as any)?.priority || 'NORMAL');
  const priorityLabel: Record<string, string> = {
    NORMAL: '',
    IMPORTANT: '【重要】',
    URGENT: '【紧急】',
  };
  return (
    <section className="pe-public-section pe-public-senior">
      <h2>{priorityLabel[priority] || ''}{meta.title}</h2>
      <p className="pe-public-hint">{meta.hospitalDisplayName}</p>
      <p style={{ whiteSpace: 'pre-wrap', fontSize: 18, marginTop: 12 }}>
        {meta.description || ''}
      </p>
      {state.kind === 'error' && (
        <p className="pe-public-error" role="alert">
          {state.message}
        </p>
      )}
      {requiresAck ? (
        <button
          type="button"
          className="pe-public-primary-button"
          disabled={state.kind === 'submitting'}
          onClick={() => submit({})}
        >
          {state.kind === 'submitting' ? '提交中…' : '我已知晓'}
        </button>
      ) : (
        <p className="pe-public-hint" style={{ marginTop: 16 }}>
          您已查看此消息。无需操作。
        </p>
      )}
    </section>
  );
}
