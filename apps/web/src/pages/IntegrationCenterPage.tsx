import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { getRoleLabel, type CurrentUser } from './LoginPage';
import { useFeedbackInferredBridge } from '../utils/feedbackMessage';

type IntegrationSource = {
  id: string;
  code: string;
  name: string;
  systemType: string;
  description?: string | null;
  isEnabled: boolean;
};

type IntegrationSyncBatch = {
  id: string;
  batchType: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  totalCount: number;
  successCount: number;
  failedCount: number;
  message?: string | null;
  source?: IntegrationSource;
};

type IntegrationSyncRecord = {
  id: string;
  externalRecordType: string;
  externalRecordId: string;
  localTargetType?: string | null;
  localTargetId?: string | null;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
  source?: IntegrationSource;
  batch?: IntegrationSyncBatch;
};

type IntegrationFieldMapping = {
  id: string;
  source: IntegrationSource;
  targetModel: string;
  externalField: string;
  localField: string;
  displayName?: string | null;
  isRequired: boolean;
  isActive: boolean;
};

type IntegrationDashboard = {
  sourceCount: number;
  enabledSourceCount: number;
  mappingsCount: number;
  recentBatches: IntegrationSyncBatch[];
  failedRecords: IntegrationSyncRecord[];
  sources: IntegrationSource[];
};

const statusLabelMap: Record<string, string> = {
  PENDING: '待同步',
  RUNNING: '同步中',
  SUCCESS: '成功',
  PARTIAL_FAILED: '部分失败',
  FAILED: '失败',
};

const systemTypeLabelMap: Record<string, string> = {
  HIS: 'HIS 患者主索引',
  EMR: 'EMR 电子病历',
  LIS: 'LIS 检验系统',
  PHARMACY: '药房处方',
  CHECKUP: '体检系统',
  MESSAGE: '消息平台',
  OTHER: '其他系统',
};

const mockActions = [
  {
    key: 'his-patients',
    title: '同步 HIS 患者',
    desc: '同步患者主索引、院内号、手机号、身份证和基础信息。',
    url: '/integrations/mock-sync/his-patients',
  },
  {
    key: 'emr-diagnoses',
    title: '同步 EMR 诊断',
    desc: '同步慢病诊断、确诊日期、风险等级、并发症和合并症。',
    url: '/integrations/mock-sync/emr-diagnoses',
  },
  {
    key: 'lis-results',
    title: '同步 LIS 检验',
    desc: '同步血糖、血氧、血压等关键指标，并触发规则引擎生成预警。',
    url: '/integrations/mock-sync/lis-results',
  },
  {
    key: 'prescriptions',
    title: '同步药房处方',
    desc: '同步药品、剂量、频次和医嘱说明，写入用药计划。',
    url: '/integrations/mock-sync/prescriptions',
  },
];

function formatTime(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function BatchStatusBadge({ status }: { status: string }) {
  const className = status === 'SUCCESS'
    ? 'integration-status status-success'
    : status === 'PARTIAL_FAILED'
      ? 'integration-status status-warning'
      : status === 'FAILED'
        ? 'integration-status status-danger'
        : 'integration-status status-pending';

  return <span className={className}>{statusLabelMap[status] ?? status}</span>;
}

export function IntegrationCenterPage({ user }: { user: CurrentUser }) {
  const [dashboard, setDashboard] = useState<IntegrationDashboard | null>(null);
  const [batches, setBatches] = useState<IntegrationSyncBatch[]>([]);
  const [records, setRecords] = useState<IntegrationSyncRecord[]>([]);
  const [mappings, setMappings] = useState<IntegrationFieldMapping[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  // prominent-feedback-bridge-v1
  useFeedbackInferredBridge(message);
  const [runningAction, setRunningAction] = useState('');
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>({});

  const isAdmin = user.role === 'ADMIN';

  async function loadAll(batchId = selectedBatchId) {
    setLoading(true);
    try {
      const [dashboardRes, batchesRes, mappingsRes, recordsRes] = await Promise.all([
        api.get<IntegrationDashboard>('/integrations/dashboard'),
        api.get<IntegrationSyncBatch[]>('/integrations/sync-batches'),
        api.get<IntegrationFieldMapping[]>('/integrations/field-mappings'),
        api.get<IntegrationSyncRecord[]>('/integrations/sync-records', {
          params: batchId ? { batchId } : undefined,
        }),
      ]);
      setDashboard(dashboardRes.data);
      setBatches(batchesRes.data);
      setMappings(mappingsRes.data);
      setRecords(recordsRes.data);

      const nextDrafts: Record<string, string> = {};
      mappingsRes.data.forEach((mapping) => {
        nextDrafts[mapping.id] = mapping.localField;
      });
      setMappingDrafts(nextDrafts);
    } catch {
      setMessage('接口中心数据读取失败。请确认已执行 prisma migrate / seed-integrations，并使用管理员或管理者账号登录。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastBatch = useMemo(() => batches[0], [batches]);
  const failedCount = useMemo(
    () => batches.reduce((sum, batch) => sum + batch.failedCount, 0),
    [batches],
  );

  async function seedDefaults() {
    setRunningAction('seed-defaults');
    setMessage('');
    try {
      await api.post('/integrations/seed-defaults');
      setMessage('接口来源和字段映射已初始化。');
      await loadAll('');
    } catch {
      setMessage('初始化失败。只有管理员可以执行该操作。');
    } finally {
      setRunningAction('');
    }
  }

  async function runMockSync(action: typeof mockActions[number]) {
    setRunningAction(action.key);
    setMessage('');
    try {
      const res = await api.post<IntegrationSyncBatch>(action.url);
      setSelectedBatchId(res.data.id);
      setMessage(`${action.title}完成：成功 ${res.data.successCount} 条，失败 ${res.data.failedCount} 条。`);
      await loadAll(res.data.id);
    } catch {
      setMessage(`${action.title}失败。请先执行接口来源初始化，并确认当前账号是管理员。`);
    } finally {
      setRunningAction('');
    }
  }

  async function saveMapping(mapping: IntegrationFieldMapping) {
    setRunningAction(mapping.id);
    setMessage('');
    try {
      await api.patch(`/integrations/field-mappings/${mapping.id}`, {
        localField: mappingDrafts[mapping.id] ?? mapping.localField,
        isActive: mapping.isActive,
      });
      setMessage('字段映射已保存。');
      await loadAll(selectedBatchId);
    } catch {
      setMessage('字段映射保存失败。只有管理员可以编辑。');
    } finally {
      setRunningAction('');
    }
  }

  async function selectBatch(batchId: string) {
    setSelectedBatchId(batchId);
    await loadAll(batchId);
  }

  return (
    <div className="integration-page hospital-page">
      <section className="page-hero integration-hero">
        <div>
          <p className="eyebrow">医院接口中心 v1</p>
          <h1>HIS / EMR / LIS 数据同步与字段映射</h1>
          <p>
            将原来的 HIS 模拟导入升级为接口来源、同步批次、同步日志、字段映射和外部数据暂存的医院接口中心。
          </p>
        </div>
        <div className="integration-hero-actions">
          <span className="topbar-pill">当前角色：{getRoleLabel(user.role)}</span>
          <button className="ghost-btn" onClick={() => loadAll(selectedBatchId)} disabled={loading}>刷新</button>
          <button className="primary-btn" onClick={seedDefaults} disabled={!isAdmin || runningAction === 'seed-defaults'}>
            {runningAction === 'seed-defaults' ? '初始化中...' : '初始化接口配置'}
          </button>
        </div>
      </section>
      {!isAdmin && (
        <div className="integration-readonly-banner">
          管理者账号可只读查看接口来源、同步批次和异常日志；模拟同步和字段映射编辑仅管理员可执行。
        </div>
      )}

      <section className="integration-kpi-grid">
        <div className="stat-card"><span>接口来源</span><strong>{dashboard?.sourceCount ?? '—'}</strong><em>已启用 {dashboard?.enabledSourceCount ?? '—'} 个</em></div>
        <div className="stat-card"><span>字段映射</span><strong>{dashboard?.mappingsCount ?? '—'}</strong><em>Patient / Disease / Vital / Medication</em></div>
        <div className="stat-card"><span>最近同步</span><strong>{lastBatch ? statusLabelMap[lastBatch.status] ?? lastBatch.status : '—'}</strong><em>{lastBatch?.source?.name ?? '暂无批次'}</em></div>
        <div className="stat-card"><span>失败记录</span><strong>{failedCount}</strong><em>用于接口追溯和字段修正</em></div>
      </section>

      <section className="integration-two-column">
        <div className="panel-card">
          <div className="section-header-row">
            <div><h2>接口来源</h2><p>模拟院内系统来源，后续可替换为真实 WebService / HL7 / FHIR / 中间库。</p></div>
          </div>
          <div className="source-grid">
            {(dashboard?.sources ?? []).map((source) => (
              <div className="source-card" key={source.id}>
                <div className="source-card-head">
                  <strong>{source.name}</strong>
                  <span>{systemTypeLabelMap[source.systemType] ?? source.systemType}</span>
                </div>
                <p>{source.description}</p>
                <div className="source-footer"><code>{source.code}</code><em>{source.isEnabled ? '已启用' : '已停用'}</em></div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel-card">
          <div className="section-header-row">
            <div><h2>模拟批量同步</h2><p>按推荐顺序执行：HIS 患者 → EMR 诊断 → LIS 检验 → 药房处方。</p></div>
          </div>
          <div className="mock-sync-list">
            {mockActions.map((action) => (
              <div className="mock-sync-card" key={action.key}>
                <div><strong>{action.title}</strong><p>{action.desc}</p></div>
                <button className="primary-btn" onClick={() => runMockSync(action)} disabled={!isAdmin || Boolean(runningAction)}>
                  {runningAction === action.key ? '同步中...' : '执行同步'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel-card">
        <div className="section-header-row">
          <div><h2>同步批次</h2><p>每次 mock sync 都会形成批次，记录成功/失败数量和来源系统。</p></div>
        </div>
        <div className="table-wrap">
          <table className="hospital-table integration-table">
            <thead><tr><th>时间</th><th>来源</th><th>类型</th><th>状态</th><th>成功</th><th>失败</th><th>操作</th></tr></thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id} className={selectedBatchId === batch.id ? 'selected-row' : ''}>
                  <td>{formatTime(batch.startedAt)}</td>
                  <td>{batch.source?.name ?? '—'}</td>
                  <td>{batch.batchType}</td>
                  <td><BatchStatusBadge status={batch.status} /></td>
                  <td>{batch.successCount}/{batch.totalCount}</td>
                  <td>{batch.failedCount}</td>
                  <td><button className="ghost-btn table-action" onClick={() => selectBatch(batch.id)}>查看日志</button></td>
                </tr>
              ))}
              {!batches.length && <tr><td colSpan={7}>暂无同步批次。请先初始化接口配置并执行模拟同步。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel-card">
        <div className="section-header-row">
          <div><h2>同步日志</h2><p>记录每条外部数据映射到本地 Patient / DiseaseProfile / VitalRecord / MedicationRecord 的结果。</p></div>
        </div>
        <div className="record-list">
          {records.map((record) => (
            <div className="record-card" key={record.id}>
              <div className="record-card-main">
                <strong>{record.externalRecordType} · {record.externalRecordId}</strong>
                <span>{record.source?.name ?? '未知来源'} · {formatTime(record.createdAt)}</span>
              </div>
              <div className="record-card-target">
                <BatchStatusBadge status={record.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED'} />
                <span>{record.localTargetType ? `${record.localTargetType} / ${record.localTargetId}` : record.errorMessage || '未写入本地对象'}</span>
              </div>
            </div>
          ))}
          {!records.length && <div className="empty-state">暂无同步日志。</div>}
        </div>
      </section>

      <section className="panel-card">
        <div className="section-header-row">
          <div><h2>字段映射</h2><p>用于说明外部系统字段如何映射到平台核心表，管理员可调整本地字段名。</p></div>
        </div>
        <div className="mapping-grid">
          {mappings.map((mapping) => (
            <div className="mapping-card" key={mapping.id}>
              <div className="mapping-title-row">
                <strong>{mapping.displayName || mapping.externalField}</strong>
                <span>{mapping.source.code}</span>
              </div>
              <div className="mapping-meta">{mapping.targetModel} · 外部字段 <code>{mapping.externalField}</code></div>
              <label>
                本地字段
                <input
                  value={mappingDrafts[mapping.id] ?? mapping.localField}
                  disabled={!isAdmin}
                  onChange={(e) => setMappingDrafts((current) => ({ ...current, [mapping.id]: e.target.value }))}
                />
              </label>
              <div className="mapping-footer">
                <span>{mapping.isRequired ? '必填字段' : '可选字段'} · {mapping.isActive ? '启用' : '停用'}</span>
                <button className="ghost-btn" disabled={!isAdmin || runningAction === mapping.id} onClick={() => saveMapping(mapping)}>
                  保存
                </button>
              </div>
            </div>
          ))}
          {!mappings.length && <div className="empty-state">暂无字段映射。请点击“初始化接口配置”。</div>}
        </div>
      </section>
    </div>
  );
}
