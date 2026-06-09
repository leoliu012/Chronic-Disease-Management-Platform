import { useCallback, useEffect, useState } from 'react';
import {
  listMissedOccurrences,
  resendOccurrence,
  sendOccurrenceNow,
  type CareReminderOccurrence,
} from '../api/care-reminders';
import { GroupedCareReminderOccurrences } from '../components/CareReminderGroupedViews';
import '../patient-engagement-admin-tab.css';

export default function CareRemindersPage() {
  const [missed, setMissed] = useState<CareReminderOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const items = await listMissedOccurrences();
      setMissed(items);
    } catch (error: any) {
      setErr(error?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const send = useCallback(
    async (id: string) => {
      setBusyId(id);
      setErr(null);
      setNotice(null);
      try {
        await sendOccurrenceNow(id);
        setNotice('已尝试立即发送。');
        await refresh();
      } catch (error: any) {
        setErr(error?.message || '发送失败');
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const resend = useCallback(
    async (id: string) => {
      setBusyId(id);
      setErr(null);
      setNotice(null);
      try {
        const result = await resendOccurrence(id);
        setNotice(result.reusedLink ? '已再次发送（复用原链接）。' : '已再次发送。');
        await refresh();
      } catch (error: any) {
        setErr(error?.message || '再次发送失败');
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  return (
    <div className="pe-admin-tab" style={{ padding: 24 }}>
      <div className="pe-admin-page-header">
        <div>
          <h2>慢病提醒中心</h2>
          <p className="pe-admin-page-subtitle">
            按业务类型和具体计划归类展示未完成事项，便于护士快速定位需要跟进的患者。
          </p>
        </div>
        <div className="pe-admin-page-header-actions">
          {loading ? <span className="pe-admin-muted">载入中…</span> : null}
          <button type="button" className="pe-admin-secondary" onClick={() => void refresh()}>
            刷新
          </button>
        </div>
      </div>

      {err ? <div className="pe-admin-banner pe-admin-banner-error">{err}</div> : null}
      {notice ? <div className="pe-admin-banner pe-admin-banner-ok">{notice}</div> : null}

      <section className="pe-admin-messages">
        <div className="pe-admin-section-head pe-admin-section-head-with-copy">
          <div>
            <h3>未完成 / 已升级</h3>
            <p className="pe-admin-muted">最近 30 天，共 {missed.length} 条。点击类型或子类型可展开和收起。</p>
          </div>
        </div>

        <GroupedCareReminderOccurrences
          rows={missed}
          showPatient
          showActions
          actions={{
            busyId,
            onSend: (id) => void send(id),
            onResend: (id) => void resend(id),
          }}
        />
      </section>
    </div>
  );
}
