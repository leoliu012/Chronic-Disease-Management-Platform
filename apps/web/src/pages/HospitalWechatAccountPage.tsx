/**
 * HospitalWechatAccountPage
 * --------------------------
 * 后台配置页, 一个医院一份服务号配置.
 *
 * - GET 当前医院的配置 (脱敏)
 * - POST 保存 appId / appSecret / templates / enabled
 * - 测试 access_token / test send
 *
 * ADMIN 可以通过 ?hospitalTenantId=xxx 切换到其它医院.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  fetchHospitalWechatAccount,
  saveHospitalWechatAccount,
  testHospitalWechatAccessToken,
  testHospitalWechatSend,
  type HospitalWechatAccountSummary,
  type UpsertHospitalWechatAccountInput,
} from '../api/hospital-wechat';
import { getApiErrorMessage } from '../api/client';

type Toast = { kind: 'success' | 'error'; message: string } | null;

function emptyForm(s: HospitalWechatAccountSummary | null): UpsertHospitalWechatAccountInput {
  return {
    accountName: s?.accountName ?? '',
    originalId: s?.originalId ?? '',
    appId: '',
    appSecret: '',
    qrCodeUrl: s?.qrCodeUrl ?? '',
    h5BaseUrl: s?.h5BaseUrl ?? '',
    oauthCallbackDomain: s?.oauthCallbackDomain ?? '',
    templateQuestionnaireId: s?.templateQuestionnaireId ?? '',
    templateVitalId: s?.templateVitalId ?? '',
    templateMedicationId: s?.templateMedicationId ?? '',
    templateHospitalVisitId: s?.templateHospitalVisitId ?? '',
    isEnabled: s?.isEnabled ?? false,
  };
}

export default function HospitalWechatAccountPage() {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const hospitalTenantId = params.get('hospitalTenantId') || undefined;

  const [summary, setSummary] = useState<HospitalWechatAccountSummary | null>(null);
  const [form, setForm] = useState<UpsertHospitalWechatAccountInput>(emptyForm(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [testing, setTesting] = useState<'token' | 'send' | null>(null);
  const [testPatientId, setTestPatientId] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setToast(null);
    try {
      const s = await fetchHospitalWechatAccount(hospitalTenantId);
      setSummary(s);
      setForm(emptyForm(s));
    } catch (err: any) {
      setToast({ kind: 'error', message: getApiErrorMessage(err) || '加载失败' });
    } finally {
      setLoading(false);
    }
  }, [hospitalTenantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.appId || form.appId.trim().length === 0) {
      setToast({ kind: 'error', message: '请填写 appId' });
      return;
    }
    if (!summary?.configured && (!form.appSecret || form.appSecret.length === 0)) {
      setToast({ kind: 'error', message: '首次配置时必须填写 appSecret' });
      return;
    }
    setSaving(true);
    setToast(null);
    try {
      const payload: UpsertHospitalWechatAccountInput = {
        ...form,
        hospitalTenantId,
        appSecret: form.appSecret && form.appSecret.length > 0 ? form.appSecret : undefined,
      };
      const updated = await saveHospitalWechatAccount(payload);
      setSummary(updated);
      setForm((cur) => ({ ...cur, appSecret: '' }));
      setToast({ kind: 'success', message: '已保存' });
    } catch (err: any) {
      setToast({ kind: 'error', message: getApiErrorMessage(err) || '保存失败' });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestToken() {
    setTesting('token');
    setToast(null);
    try {
      const r = await testHospitalWechatAccessToken(hospitalTenantId);
      setToast({
        kind: r.ok ? 'success' : 'error',
        message: `${r.ok ? '✓' : '✗'} ${r.message}${r.mocked ? ' (mock)' : ''}`,
      });
    } catch (err: any) {
      setToast({ kind: 'error', message: getApiErrorMessage(err) || '请求失败' });
    } finally {
      setTesting(null);
    }
  }

  async function handleTestSend() {
    if (!testPatientId.trim()) {
      setToast({ kind: 'error', message: '请填写 patientId' });
      return;
    }
    setTesting('send');
    setToast(null);
    try {
      const r = await testHospitalWechatSend({ hospitalTenantId, patientId: testPatientId.trim() });
      setToast({
        kind: r.ok ? 'success' : 'error',
        message: `${r.ok ? '✓ 已发送' : '✗ 发送失败'}${(r as any).mocked ? ' (mock)' : ''}${(r as any).errorMessage ? ' — ' + (r as any).errorMessage : ''}`,
      });
    } catch (err: any) {
      setToast({ kind: 'error', message: getApiErrorMessage(err) || '请求失败' });
    } finally {
      setTesting(null);
    }
  }

  return (
    <div className="pe-hospital-wechat-page" style={{ maxWidth: 880, margin: '32px auto', padding: '0 16px' }}>
      <h2>本院微信服务号配置</h2>
      <p style={{ color: '#666' }}>
        每家医院使用 *自己* 的服务号 (appId / appSecret 由医院申请, 平台不持有).
        appSecret 加密存储 (AES-256-GCM), 后台只显示 ****.
      </p>

      {loading && <p>加载中…</p>}

      {!loading && summary && (
        <section style={{ background: '#f6f7f8', padding: 16, borderRadius: 8, margin: '16px 0' }}>
          <h3 style={{ marginTop: 0 }}>当前状态</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: 1.8 }}>
            <li>hospitalTenantId: <code>{summary.hospitalTenantId}</code></li>
            <li>配置状态: <strong>{summary.configured ? '✓ 已配置' : '✗ 未配置'}</strong></li>
            <li>已启用: <strong>{summary.isEnabled ? '是' : '否'}</strong></li>
            <li>已认证 (服务号 isVerified): <strong>{summary.isVerified ? '是' : '否'}</strong></li>
            <li>appId: <code>{summary.appIdMasked}</code></li>
            <li>appSecret: <code>{summary.hasAppSecret ? '已保存 (****)' : '未设置'}</code></li>
            <li>最近 token 刷新: {summary.lastTokenRefreshAt ?? '-'}</li>
          </ul>
        </section>
      )}

      <form onSubmit={handleSave} style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12, alignItems: 'center' }}>
        <label>服务号名称</label>
        <input value={form.accountName ?? ''} onChange={(e) => setForm({ ...form, accountName: e.target.value })} placeholder="例如: XX医院 · 健康随访" />

        <label>原始 ID</label>
        <input value={form.originalId ?? ''} onChange={(e) => setForm({ ...form, originalId: e.target.value })} placeholder="gh_xxxxxxxx" />

        <label>App ID *</label>
        <input value={form.appId ?? ''} onChange={(e) => setForm({ ...form, appId: e.target.value })} placeholder="wx..." required />

        <label>App Secret *</label>
        <input
          type="password"
          value={form.appSecret ?? ''}
          onChange={(e) => setForm({ ...form, appSecret: e.target.value })}
          placeholder={summary?.hasAppSecret ? '留空 = 保留之前值' : '首次配置必填'}
        />

        <label>H5 base URL</label>
        <input value={form.h5BaseUrl ?? ''} onChange={(e) => setForm({ ...form, h5BaseUrl: e.target.value })} placeholder="https://wx.your-hospital.com" />

        <label>OAuth 回调域</label>
        <input value={form.oauthCallbackDomain ?? ''} onChange={(e) => setForm({ ...form, oauthCallbackDomain: e.target.value })} placeholder="wx.your-hospital.com" />

        <label>问卷模板 ID</label>
        <input value={form.templateQuestionnaireId ?? ''} onChange={(e) => setForm({ ...form, templateQuestionnaireId: e.target.value })} />

        <label>复测模板 ID</label>
        <input value={form.templateVitalId ?? ''} onChange={(e) => setForm({ ...form, templateVitalId: e.target.value })} />

        <label>用药模板 ID</label>
        <input value={form.templateMedicationId ?? ''} onChange={(e) => setForm({ ...form, templateMedicationId: e.target.value })} />

        <label>到院模板 ID</label>
        <input value={form.templateHospitalVisitId ?? ''} onChange={(e) => setForm({ ...form, templateHospitalVisitId: e.target.value })} />

        <label>启用</label>
        <label style={{ justifySelf: 'start' }}>
          <input type="checkbox" checked={Boolean(form.isEnabled)} onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })} /> 已启用 (取消则停止本院微信触达)
        </label>

        <div />
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</button>
          <button type="button" disabled={testing !== null} onClick={handleTestToken}>
            {testing === 'token' ? '请求中…' : '测试 access_token'}
          </button>
        </div>
      </form>

      <section style={{ marginTop: 32, background: '#f6f7f8', padding: 16, borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>测试发送</h3>
        <p style={{ color: '#666' }}>把测试模板消息发给该患者 (必须已在本院服务号关注过, 即有 openId).</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            placeholder="patientId (e.g. demo-patient-001)"
            value={testPatientId}
            onChange={(e) => setTestPatientId(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="button" disabled={testing !== null} onClick={handleTestSend}>
            {testing === 'send' ? '发送中…' : '测试发送'}
          </button>
        </div>
      </section>

      {toast && (
        <div
          style={{
            marginTop: 24,
            padding: 12,
            borderRadius: 6,
            background: toast.kind === 'success' ? '#e6f7e6' : '#fde7e7',
            color: toast.kind === 'success' ? '#1f7a1f' : '#a31212',
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
