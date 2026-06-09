import { useCallback, useEffect, useState } from 'react';
import {
  fetchAdminOpsSummary,
  type AdminOpsSummary,
  type DataIntegrityOps,
  type GatewayOps,
  type ReminderWorkerOps,
} from '../api/admin-ops';
import { getApiErrorMessage } from '../api/client';

const AUTO_REFRESH_MS = 30_000;

export function AdminOpsPage() {
  const [summary, setSummary] = useState<AdminOpsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSummary(await fetchAdminOpsSummary());
    } catch (err) {
      setError(getApiErrorMessage(err, '系统健康信息加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div className="ops-page">
      <header className="page-header ops-page-header">
        <div>
          <p className="eyebrow">医院信息科 · 管理员专用</p>
          <h1>系统健康 / 运维中心</h1>
          <p className="page-subtitle">
            查看核心依赖、提醒 Worker、患者触达链路、网关同步与数据完整性。
          </p>
        </div>
        <button type="button" className="primary-btn" onClick={() => void load()} disabled={loading}>
          {loading ? '刷新中…' : '立即刷新'}
        </button>
      </header>

      {error ? <div className="ops-alert ops-alert-danger">{error}</div> : null}
      {!summary && loading ? <div className="ops-panel">正在读取系统状态…</div> : null}
      {summary ? (
        <>
          <SystemHealthSection summary={summary} />
          <ReminderWorkerSection worker={summary.reminderWorker} />
          <GatewaySection gateway={summary.gateway} />
          <DataIntegritySection integrity={summary.dataIntegrity} />
          <AuditSection summary={summary} />
          <p className="ops-updated-at">最近刷新：{formatDateTime(summary.checkedAt)} · 页面每 30 秒自动刷新</p>
        </>
      ) : null}
    </div>
  );
}

function SystemHealthSection({ summary }: { summary: AdminOpsSummary }) {
  const { system } = summary;
  return (
    <section className="ops-section">
      <SectionHeading title="系统健康" hint="API、数据库与 Redis 就绪状态" />
      <div className="ops-card-grid">
        <MetricCard label="API 状态" value="运行中" tone="ok" note="GET /health/live" />
        <MetricCard
          label="数据库"
          value={system.dependencies.db.status === 'UP' ? '正常' : '异常'}
          tone={system.dependencies.db.status === 'UP' ? 'ok' : 'danger'}
          note={`${system.dependencies.db.latencyMs} ms`}
        />
        <MetricCard
          label="Redis"
          value={system.dependencies.redis.status === 'UP' ? '正常' : '异常'}
          tone={system.dependencies.redis.status === 'UP' ? 'ok' : 'danger'}
          note={`${system.dependencies.redis.latencyMs} ms`}
        />
        <MetricCard
          label="整体就绪"
          value={system.status === 'UP' ? '可接收流量' : '需要处理'}
          tone={system.status === 'UP' ? 'ok' : 'danger'}
          note="GET /health/ready"
        />
      </div>
    </section>
  );
}

function ReminderWorkerSection({ worker }: { worker: ReminderWorkerOps }) {
  const m = worker.metrics24h;
  return (
    <section className="ops-section">
      <SectionHeading title="提醒 Worker" hint="最近 24 小时运行情况与当前积压" />
      <div className="ops-card-grid ops-card-grid-wide">
        <MetricCard label="最近成功运行" value={worker.latestSuccessfulRunAt ? formatDateTime(worker.latestSuccessfulRunAt) : '暂无'} tone={worker.latestSuccessfulRunAt ? 'ok' : 'warn'} />
        <MetricCard label="已生成提醒" value={String(m.generated ?? 0)} />
        <MetricCard label="成功发送" value={String(m.dispatched ?? 0)} tone="ok" />
        <MetricCard label="发送失败" value={String(m.dispatchFailed ?? 0)} tone={(m.dispatchFailed ?? 0) > 0 ? 'danger' : 'ok'} />
        <MetricCard label="判定未完成" value={String(m.missed ?? 0)} tone={(m.missed ?? 0) > 0 ? 'warn' : 'ok'} />
        <MetricCard label="已升级任务" value={String(m.escalated ?? 0)} tone={(m.escalated ?? 0) > 0 ? 'warn' : 'ok'} />
        <MetricCard label="等待重试" value={String(worker.backlog.retryScheduled)} tone={worker.backlog.retryScheduled > 0 ? 'warn' : 'ok'} />
        <MetricCard label="长期发送中" value={String(worker.backlog.stuckSending)} tone={worker.backlog.stuckSending > 0 ? 'danger' : 'ok'} />
      </div>

      <div className="ops-panel">
        <h3>Worker 实例</h3>
        <table className="ops-table">
          <thead>
            <tr><th>实例</th><th>最近 heartbeat</th><th>状态</th></tr>
          </thead>
          <tbody>
            {worker.instances.map((instance) => (
              <tr key={instance.instanceId}>
                <td>{instance.instanceId}</td>
                <td>{formatDateTime(instance.heartbeatAt)}</td>
                <td><StatusTag tone={instance.active ? 'ok' : 'danger'}>{instance.active ? '在线' : 'heartbeat 中断'}</StatusTag></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GatewaySection({ gateway }: { gateway: GatewayOps }) {
  return (
    <section className="ops-section">
      <SectionHeading title="网关接入" hint="HIS / EMR / LIS 入库、冲突与重试耗尽" />
      <div className="ops-card-grid">
        <MetricCard label="启用来源" value={String(gateway.enabledSources)} />
        <MetricCard label="待人工核验冲突" value={String(gateway.conflictCount)} tone={gateway.conflictCount > 0 ? 'warn' : 'ok'} />
        <MetricCard label="重试耗尽" value={String(gateway.retryExhaustedCount)} tone={gateway.retryExhaustedCount > 0 ? 'danger' : 'ok'} />
        <MetricCard label="等待自动重试" value={String(gateway.retryScheduledCount)} tone={gateway.retryScheduledCount > 0 ? 'warn' : 'ok'} />
        <MetricCard label="24 小时失败批次" value={String(gateway.failedBatches24h)} tone={gateway.failedBatches24h > 0 ? 'danger' : 'ok'} />
        <MetricCard label="最近同步" value={gateway.latestBatch ? formatDateTime(gateway.latestBatch.startedAt) : '暂无'} note={gateway.latestBatch?.source?.name || gateway.latestBatch?.status || ''} />
      </div>

      <div className="ops-panel">
        <h3>最近网关冲突</h3>
        {gateway.recentConflicts.length ? (
          <table className="ops-table">
            <thead>
              <tr><th>时间</th><th>类型</th><th>外部记录</th><th>说明</th></tr>
            </thead>
            <tbody>
              {gateway.recentConflicts.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>{item.externalRecordType}</td>
                  <td>{item.externalRecordId}</td>
                  <td>{item.promotionMessage || '等待人工核验'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="ops-empty">当前没有待人工核验的网关冲突。</p>}
      </div>
    </section>
  );
}

function DataIntegritySection({ integrity }: { integrity: DataIntegrityOps }) {
  return (
    <section className="ops-section">
      <SectionHeading title="数据完整性" hint="需要医院信息科或慢病中心关注的异常数量" />
      <div className="ops-card-grid ops-card-grid-wide">
        <MetricCard label="SLA 超时开放任务" value={String(integrity.staleOpenTasks)} tone={integrity.staleOpenTasks > 0 ? 'danger' : 'ok'} />
        <MetricCard label="孤儿开放预警" value={String(integrity.orphanOpenAlerts)} tone={integrity.orphanOpenAlerts > 0 ? 'danger' : 'ok'} />
        <MetricCard label="开放 episode 无任务" value={String(integrity.openEpisodesWithoutTask)} tone={integrity.openEpisodesWithoutTask > 0 ? 'warn' : 'ok'} />
        <MetricCard label="重复提醒计划" value={String(integrity.duplicateScheduleGroups)} tone={integrity.duplicateScheduleGroups > 0 ? 'danger' : 'ok'} />
        <MetricCard label="提醒计划缺少来源" value={String(integrity.sourceLessBoundSchedules)} tone={integrity.sourceLessBoundSchedules > 0 ? 'warn' : 'ok'} />
        <MetricCard label="患者缺少责任护士" value={String(integrity.patientsWithoutResponsibleNurse)} tone={integrity.patientsWithoutResponsibleNurse > 0 ? 'warn' : 'ok'} />
        <MetricCard label="患者缺少医院归属" value={String(integrity.patientsWithoutTenant)} tone={integrity.patientsWithoutTenant > 0 ? 'danger' : 'ok'} />
        <MetricCard label="24 小时内链接到期" value={String(integrity.activeLinksExpiringSoon)} tone={integrity.activeLinksExpiringSoon > 0 ? 'warn' : 'ok'} />
        <MetricCard label="已过期但仍 ACTIVE" value={String(integrity.activeLinksAlreadyExpired)} tone={integrity.activeLinksAlreadyExpired > 0 ? 'danger' : 'ok'} />
        <MetricCard label="重复外部记录" value={String(integrity.duplicateExternalRecordGroups)} tone={integrity.duplicateExternalRecordGroups > 0 ? 'warn' : 'ok'} />
      </div>
    </section>
  );
}

function AuditSection({ summary }: { summary: AdminOpsSummary }) {
  const rows = summary.audit.recentHighRiskActions;
  return (
    <section className="ops-section">
      <SectionHeading title="高风险操作留痕" hint="跨医院访问、API key 管理与人工重放" />
      <div className="ops-panel">
        {rows.length ? (
          <table className="ops-table">
            <thead>
              <tr><th>时间</th><th>动作</th><th>对象</th><th>操作人</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td>{row.action}</td>
                  <td>{row.targetType}{row.targetId ? ` · ${row.targetId}` : ''}</td>
                  <td>{row.operatorId || '系统'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="ops-empty">近期没有高风险操作。</p>}
      </div>
    </section>
  );
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="ops-section-heading">
      <div>
        <h2>{title}</h2>
        <p>{hint}</p>
      </div>
    </div>
  );
}

function MetricCard({ label, value, note, tone = 'neutral' }: { label: string; value: string; note?: string; tone?: 'neutral' | 'ok' | 'warn' | 'danger' }) {
  return (
    <article className={`ops-metric-card ops-tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </article>
  );
}

function StatusTag({ tone, children }: { tone: 'ok' | 'warn' | 'danger'; children: string }) {
  return <span className={`ops-status-tag ops-status-${tone}`}>{children}</span>;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
