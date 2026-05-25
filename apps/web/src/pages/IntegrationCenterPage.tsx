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
  autoPromote?: boolean;
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

type PromotionStatus = 'NOT_REQUIRED' | 'PENDING' | 'PROMOTED' | 'CONFLICT' | 'FAILED';

type IntegrationSyncRecord = {
  id: string;
  externalRecordType: string;
  externalRecordId: string;
  localTargetType?: string | null;
  localTargetId?: string | null;
  status: string;
  errorMessage?: string | null;
  promotionStatus?: PromotionStatus;
  promotionMessage?: string | null;
  promotedAt?: string | null;
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

type PromoteSummary = {
  counts: Record<PromotionStatus, number>;
  sources: Array<{
    id: string;
    code: string;
    name: string;
    autoPromote: boolean;
    counts: Record<PromotionStatus, number>;
  }>;
};

type PromoteResult = {
  recordId: string;
  outcome: 'PROMOTED' | 'ALREADY_PROMOTED' | 'CONFLICT' | 'FAILED' | 'SKIPPED';
  localTargetType?: string;
  localTargetId?: string;
  message?: string;
  generatedRiskAlertId?: string;
  generatedTaskId?: string;
};

type PromoteBatchResult = {
  total: number;
  promoted: number;
  alreadyPromoted: number;
  conflicts: number;
  failed: number;
  skipped: number;
  records: PromoteResult[];
};

// conflict-resolution-ux-v1: structured per-field diff returned by
// GET /gateway/promote/:recordId/conflict.
type ConflictReason =
  | 'PATIENT_NOT_FOUND'
  | 'PATIENT_IDENTITY_MISMATCH'
  | 'DUPLICATE_PROMOTION_TARGET'
  | 'MISSING_REQUIRED_FIELDS'
  | 'REJECTED_BY_OPERATOR'
  | 'UNKNOWN';

type ConflictFieldDiff = {
  label: string;
  field: string;
  local?: string;
  upstream?: string;
  changed: boolean;
};

type ConflictDetail = {
  recordId: string;
  promotionStatus: PromotionStatus;
  reason: ConflictReason;
  reasonLabel: string;
  resourceType: string;
  sourceName: string;
  sourceCode: string;
  externalRecordId: string;
  receivedAt: string;
  promotionMessage: string;
  localPatient?: { id: string; name: string; hospitalPatientId: string | null };
  upstreamIdentifier: {
    hospitalPatientId?: string;
    idCardNo?: string;
    phone?: string;
    externalPatientId?: string;
  };
  fieldDiffs: ConflictFieldDiff[];
  rawPayloadPreview?: string;
};

const resourceTypeLabelMap: Record<string, string> = {
  PATIENT: '患者档案变更',
  DIAGNOSIS: '诊断 / 慢病',
  OBSERVATION: '体征 / 检验',
  MEDICATION: '药品 / 医嘱',
  ENCOUNTER: '就诊记录',
  DISCHARGE: '出院记录',
  DOCUMENT: '病历文档',
};

const reasonToneMap: Record<ConflictReason, 'danger' | 'warning' | 'info'> = {
  PATIENT_NOT_FOUND: 'warning',
  PATIENT_IDENTITY_MISMATCH: 'danger',
  DUPLICATE_PROMOTION_TARGET: 'info',
  MISSING_REQUIRED_FIELDS: 'warning',
  REJECTED_BY_OPERATOR: 'info',
  UNKNOWN: 'info',
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

const promotionTabLabel: Record<PromotionStatus, string> = {
  NOT_REQUIRED: '直写主表（旧 mock-sync）',
  PENDING: '待入库',
  PROMOTED: '已入库',
  CONFLICT: '冲突 · 待人工核验',
  FAILED: '失败',
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

function PromotionBadge({ status }: { status?: PromotionStatus | null }) {
  if (!status || status === 'NOT_REQUIRED') {
    return <span className="integration-status status-pending">直写主表</span>;
  }
  if (status === 'PENDING') return <span className="integration-status status-pending">待入库</span>;
  if (status === 'PROMOTED') return <span className="integration-status status-success">已入库</span>;
  if (status === 'CONFLICT') return <span className="integration-status status-warning">冲突 · 待人工核验</span>;
  return <span className="integration-status status-danger">失败</span>;
}

/**
 * conflict-resolution-ux-v1 — 冲突详情侧拉抽屉
 *
 * 取代之前在表格「说明」列里塞一长串中文文字 + 一个孤零零的「强制覆盖」按钮的做法。
 * 现在每条 CONFLICT 行打开抽屉后能看到：
 *   - 冲突原因（带颜色标签）
 *   - 本地档案 vs 上游事件 的逐字段对比表
 *   - 原始 payload（折叠区，方便排查少量字段时不暴露 JSON）
 *   - 三个动作按钮：强制采纳上游 / 保留本地（驳回上游）/ 取消
 */
function GatewayConflictDrawer({
  detail,
  isAdminOrClinical,
  isWorking,
  onForceOverwrite,
  onReject,
  onClose,
}: {
  detail: ConflictDetail;
  isAdminOrClinical: boolean;
  isWorking: boolean;
  onForceOverwrite: () => void;
  onReject: (note: string) => void;
  onClose: () => void;
}) {
  const [rejectNote, setRejectNote] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [confirming, setConfirming] = useState<'force' | 'reject' | null>(null);

  const tone = reasonToneMap[detail.reason] ?? 'info';
  const isConflict = detail.promotionStatus === 'CONFLICT';

  return (
    <div className="gateway-conflict-drawer-overlay" role="dialog" aria-modal="true">
      <div className="gateway-conflict-drawer-backdrop" onClick={onClose} />
      <aside className="gateway-conflict-drawer" aria-label="网关入库冲突详情">
        <header className="gateway-conflict-header">
          <div className="gateway-conflict-header-row">
            <span className={`gateway-conflict-reason-pill tone-${tone}`}>
              {detail.reasonLabel}
            </span>
            <span className="gateway-conflict-resource-pill">
              {resourceTypeLabelMap[detail.resourceType] ?? detail.resourceType}
            </span>
            <button
              type="button"
              className="gateway-conflict-close"
              onClick={onClose}
              aria-label="关闭冲突详情"
            >
              ×
            </button>
          </div>
          <h3>{detail.localPatient?.name ?? '未匹配到本地患者'}</h3>
          <p className="gateway-conflict-subtitle">
            来自 <strong>{detail.sourceName}</strong>
            <span className="gateway-conflict-meta-dot">·</span>
            外部 ID <code>{detail.externalRecordId}</code>
            <span className="gateway-conflict-meta-dot">·</span>
            接收时间 {formatTime(detail.receivedAt)}
          </p>
        </header>

        {detail.promotionMessage && (
          <section className="gateway-conflict-section">
            <div className="gateway-conflict-section-title">冲突说明</div>
            <p className="gateway-conflict-message">{detail.promotionMessage}</p>
          </section>
        )}

        <section className="gateway-conflict-section">
          <div className="gateway-conflict-section-title">本地档案 vs 上游事件</div>
          {detail.fieldDiffs.length === 0 ? (
            <p className="gateway-conflict-empty">
              此事件没有可对比的字段（通常是「本地未找到对应患者」或「关键字段缺失」），
              请查看下方的原始数据。
            </p>
          ) : (
            <table className="gateway-conflict-diff-table">
              <thead>
                <tr>
                  <th>字段</th>
                  <th>本地</th>
                  <th>上游</th>
                </tr>
              </thead>
              <tbody>
                {detail.fieldDiffs.map((diff) => (
                  <tr
                    key={diff.field}
                    className={diff.changed ? 'gateway-conflict-diff-changed' : ''}
                  >
                    <th scope="row">{diff.label}</th>
                    <td>{diff.local ?? <em className="gateway-conflict-empty-cell">未填写</em>}</td>
                    <td>
                      {diff.upstream ?? <em className="gateway-conflict-empty-cell">未携带</em>}
                      {diff.changed && (
                        <span className="gateway-conflict-changed-tag">不一致</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {detail.localPatient && (
          <section className="gateway-conflict-section">
            <div className="gateway-conflict-section-title">本地患者档案</div>
            <ul className="gateway-conflict-meta-list">
              <li>姓名：{detail.localPatient.name}</li>
              <li>院内号：{detail.localPatient.hospitalPatientId ?? '—'}</li>
            </ul>
          </section>
        )}

        {detail.rawPayloadPreview && (
          <section className="gateway-conflict-section">
            <div className="gateway-conflict-section-title">
              <span>原始 payload</span>
              <button
                type="button"
                className="gateway-conflict-link-btn"
                onClick={() => setShowRaw((v) => !v)}
              >
                {showRaw ? '收起' : '展开'}
              </button>
            </div>
            {showRaw && <pre className="gateway-conflict-raw">{detail.rawPayloadPreview}</pre>}
          </section>
        )}

        {isConflict ? (
          <footer className="gateway-conflict-footer">
            {confirming === null && (
              <>
                <p className="gateway-conflict-helper">
                  请基于上面的对比表选择处理方式 —— 操作会记录到审计日志。
                </p>
                <div className="gateway-conflict-actions">
                  <button
                    type="button"
                    className="gateway-conflict-btn danger"
                    disabled={!isAdminOrClinical || isWorking}
                    onClick={() => setConfirming('force')}
                  >
                    强制采纳上游（覆盖本地）
                  </button>
                  <button
                    type="button"
                    className="gateway-conflict-btn primary"
                    disabled={!isAdminOrClinical || isWorking}
                    onClick={() => setConfirming('reject')}
                  >
                    保留本地（驳回上游）
                  </button>
                  <button
                    type="button"
                    className="gateway-conflict-btn ghost"
                    onClick={onClose}
                    disabled={isWorking}
                  >
                    暂不处理
                  </button>
                </div>
              </>
            )}

            {confirming === 'force' && (
              <div className="gateway-conflict-confirm">
                <p>
                  <strong>确认采纳上游？</strong>
                  本地档案的不一致字段将被上游值覆盖，且会产出主数据更新记录。
                </p>
                <div className="gateway-conflict-actions">
                  <button
                    type="button"
                    className="gateway-conflict-btn danger"
                    disabled={isWorking}
                    onClick={onForceOverwrite}
                  >
                    {isWorking ? '处理中...' : '确认覆盖'}
                  </button>
                  <button
                    type="button"
                    className="gateway-conflict-btn ghost"
                    onClick={() => setConfirming(null)}
                    disabled={isWorking}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {confirming === 'reject' && (
              <div className="gateway-conflict-confirm">
                <p>
                  <strong>确认保留本地？</strong>
                  上游变更将被驳回并标记为 FAILED；主数据不变；备注会写入审计日志。
                </p>
                <label className="gateway-conflict-note-label">
                  备注（可选，建议写明核实过程）
                  <textarea
                    className="gateway-conflict-note-input"
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="例如：已电话核实张三本人身份证未变更，上游 LIS 录入有误。"
                    maxLength={500}
                    rows={3}
                  />
                </label>
                <div className="gateway-conflict-actions">
                  <button
                    type="button"
                    className="gateway-conflict-btn primary"
                    disabled={isWorking}
                    onClick={() => onReject(rejectNote.trim())}
                  >
                    {isWorking ? '处理中...' : '确认驳回'}
                  </button>
                  <button
                    type="button"
                    className="gateway-conflict-btn ghost"
                    onClick={() => setConfirming(null)}
                    disabled={isWorking}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </footer>
        ) : (
          <footer className="gateway-conflict-footer">
            <p className="gateway-conflict-helper">
              该记录当前状态为 <PromotionBadge status={detail.promotionStatus} />，不需要冲突处理。
            </p>
            <div className="gateway-conflict-actions">
              <button
                type="button"
                className="gateway-conflict-btn ghost"
                onClick={onClose}
              >
                关闭
              </button>
            </div>
          </footer>
        )}
      </aside>
    </div>
  );
}

export function IntegrationCenterPage({ user }: { user: CurrentUser }) {
  const [dashboard, setDashboard] = useState<IntegrationDashboard | null>(null);
  const [batches, setBatches] = useState<IntegrationSyncBatch[]>([]);
  const [records, setRecords] = useState<IntegrationSyncRecord[]>([]);
  const [mappings, setMappings] = useState<IntegrationFieldMapping[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  // gateway-promote-pipeline state
  const [promoteSummary, setPromoteSummary] = useState<PromoteSummary | null>(null);
  const [promoteTab, setPromoteTab] = useState<PromotionStatus>('PENDING');
  const [promoteItems, setPromoteItems] = useState<IntegrationSyncRecord[]>([]);
  const [promoteFilterSource, setPromoteFilterSource] = useState<string>('');

  // conflict-resolution-ux-v1 — 抽屉
  const [conflictDetail, setConflictDetail] = useState<ConflictDetail | null>(null);
  const [conflictWorking, setConflictWorking] = useState(false);

  // prominent-feedback-bridge-v1
  useFeedbackInferredBridge(message);
  const [runningAction, setRunningAction] = useState('');
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>({});

  const isAdmin = user.role === 'ADMIN';
  // conflict-resolution-ux-v1: 临床角色（医生 / 护士）也允许在冲突队列里
  // 「强制覆盖」或「保留本地」—— 他们最了解患者，操作会落审计日志。
  // 仅「一键批量入库」「autoPromote 开关」「字段映射保存」「初始化接口配置」
  // 等配置类动作仍保持 isAdmin。
  const isAdminOrClinical =
    user.role === 'ADMIN' ||
    user.role === 'MANAGER' ||
    user.role === 'DOCTOR' ||
    user.role === 'NURSE';

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

  async function loadPromoteQueue(status = promoteTab, sourceId = promoteFilterSource) {
    try {
      const [summaryRes, queueRes] = await Promise.all([
        api.get<PromoteSummary>('/gateway/promote/queue/summary'),
        api.get<{ status: PromotionStatus; total: number; items: IntegrationSyncRecord[] }>(
          '/gateway/promote/queue',
          { params: { status, limit: 50, ...(sourceId ? { sourceId } : {}) } },
        ),
      ]);
      setPromoteSummary(summaryRes.data);
      setPromoteItems(queueRes.data.items);
    } catch {
      // 网关 promote 接口尚未启用（首次部署、未跑 migrate 等），静默不打扰
    }
  }

  useEffect(() => {
    loadAll('');
    loadPromoteQueue('PENDING', '');
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
      await loadPromoteQueue();
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

  async function selectPromoteTab(status: PromotionStatus) {
    setPromoteTab(status);
    await loadPromoteQueue(status, promoteFilterSource);
  }

  async function selectPromoteSourceFilter(sourceId: string) {
    setPromoteFilterSource(sourceId);
    await loadPromoteQueue(promoteTab, sourceId);
  }

  async function promoteOne(recordId: string, forceOverwrite = false) {
    setRunningAction(`promote-${recordId}`);
    setMessage('');
    try {
      const res = await api.post<PromoteResult>(
        `/gateway/promote/${recordId}`,
        { forceOverwrite },
      );
      const outcome = res.data.outcome;
      if (outcome === 'PROMOTED') {
        setMessage(
          `入库成功：${res.data.localTargetType} / ${res.data.localTargetId ?? ''}${
            res.data.generatedRiskAlertId ? '；已自动生成风险预警和任务。' : ''
          }`,
        );
      } else if (outcome === 'CONFLICT') {
        setMessage(`命中冲突，已进入人工核验：${res.data.message ?? ''}`);
      } else if (outcome === 'ALREADY_PROMOTED') {
        setMessage('该记录之前已入库，无需重复 promote。');
      } else {
        setMessage(`入库失败：${res.data.message ?? outcome}`);
      }
      await loadPromoteQueue();
    } catch {
      setMessage('入库失败，请确认当前账号是管理员或管理者。');
    } finally {
      setRunningAction('');
    }
  }

  async function promoteBatch() {
    setRunningAction('promote-batch');
    setMessage('');
    try {
      const res = await api.post<PromoteBatchResult>('/gateway/promote/batch', {
        sourceId: promoteFilterSource || undefined,
      });
      setMessage(
        `一键安全入库完成：共 ${res.data.total} 条，成功 ${res.data.promoted}，冲突 ${res.data.conflicts}，失败 ${res.data.failed}。`,
      );
      await loadPromoteQueue();
    } catch {
      setMessage('批量入库失败。');
    } finally {
      setRunningAction('');
    }
  }

  async function toggleAutoPromote(sourceId: string, next: boolean) {
    setRunningAction(`autopromote-${sourceId}`);
    setMessage('');
    try {
      await api.post(`/gateway/promote/sources/${sourceId}/auto-promote`, {
        autoPromote: next,
      });
      setMessage(next ? '已开启自动入库。新事件将立刻 promote。' : '已关闭自动入库。后续仅手动 promote。');
      await loadPromoteQueue();
    } catch {
      setMessage('切换自动入库失败。');
    } finally {
      setRunningAction('');
    }
  }

  /**
   * conflict-resolution-ux-v1 — 打开冲突详情抽屉。
   * 对 CONFLICT 行调用 / 对 FAILED 行也能调用（前端只读展示）。
   */
  async function openConflict(recordId: string) {
    setMessage('');
    try {
      const res = await api.get<ConflictDetail>(`/gateway/promote/${recordId}/conflict`);
      setConflictDetail(res.data);
    } catch {
      setMessage('加载冲突详情失败。');
    }
  }

  function closeConflict() {
    if (conflictWorking) return; // 操作进行中不关
    setConflictDetail(null);
  }

  async function handleForceOverwriteFromDrawer() {
    if (!conflictDetail) return;
    setConflictWorking(true);
    setMessage('');
    try {
      const res = await api.post<PromoteResult>(
        `/gateway/promote/${conflictDetail.recordId}`,
        { forceOverwrite: true },
      );
      const o = res.data.outcome;
      if (o === 'PROMOTED') {
        setMessage(
          `已采纳上游数据：${res.data.localTargetType} / ${res.data.localTargetId ?? ''}${
            res.data.generatedRiskAlertId ? '；自动生成风险预警和任务。' : ''
          }`,
        );
        setConflictDetail(null);
      } else if (o === 'ALREADY_PROMOTED') {
        setMessage('该记录已入库，无需再次操作。');
        setConflictDetail(null);
      } else if (o === 'CONFLICT') {
        setMessage(`仍存在冲突：${res.data.message ?? ''}`);
        // 刷新详情让用户看到新原因
        await openConflict(conflictDetail.recordId);
      } else {
        setMessage(`处理失败：${res.data.message ?? o}`);
      }
      await loadPromoteQueue();
    } catch {
      setMessage('采纳上游失败。请稍后重试。');
    } finally {
      setConflictWorking(false);
    }
  }

  async function handleRejectFromDrawer(note: string) {
    if (!conflictDetail) return;
    setConflictWorking(true);
    setMessage('');
    try {
      await api.post(
        `/gateway/promote/${conflictDetail.recordId}/reject`,
        { note: note || undefined },
      );
      setMessage('已驳回上游变更，本地数据保留。');
      setConflictDetail(null);
      await loadPromoteQueue();
    } catch {
      setMessage('驳回上游失败。请稍后重试。');
    } finally {
      setConflictWorking(false);
    }
  }

  const promoteCounts = promoteSummary?.counts;

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
          <button className="ghost-btn" onClick={() => { void loadAll(selectedBatchId); void loadPromoteQueue(); }} disabled={loading}>刷新</button>
          <button className="primary-btn" onClick={seedDefaults} disabled={!isAdmin || runningAction === 'seed-defaults'}>
            {runningAction === 'seed-defaults' ? '初始化中...' : '初始化接口配置'}
          </button>
        </div>
      </section>
      {!isAdmin && (
        <div className="integration-readonly-banner">
          管理者账号可只读查看接口来源、同步批次和异常日志；模拟同步、字段映射编辑、手动 promote 仅管理员可执行。
        </div>
      )}

      <section className="integration-kpi-grid">
        <div className="stat-card"><span>接口来源</span><strong>{dashboard?.sourceCount ?? '—'}</strong><em>已启用 {dashboard?.enabledSourceCount ?? '—'} 个</em></div>
        <div className="stat-card"><span>字段映射</span><strong>{dashboard?.mappingsCount ?? '—'}</strong><em>Patient / Disease / Vital / Medication</em></div>
        <div className="stat-card"><span>最近同步</span><strong>{lastBatch ? statusLabelMap[lastBatch.status] ?? lastBatch.status : '—'}</strong><em>{lastBatch?.source?.name ?? '暂无批次'}</em></div>
        <div className="stat-card"><span>失败记录</span><strong>{failedCount}</strong><em>用于接口追溯和字段修正</em></div>
      </section>

      <section className="panel-card">
        <div className="section-header-row">
          <div>
            <h2>网关入库队列（gateway-promote-pipeline）</h2>
            <p>
              所有 FHIR / HIS Event / HL7 / 中间表入站事件先落到审计层，再由这里推进到正式业务表
              (Patient / DiseaseProfile / VitalRecord / EncounterRecord / MedicalRecordSummary / HospitalMedicationOrder)。
              冲突数据自动进入人工核验队列，不会污染主数据。
            </p>
          </div>
          <div className="integration-hero-actions">
            <button
              className="primary-btn"
              disabled={!isAdmin || runningAction === 'promote-batch'}
              onClick={() => void promoteBatch()}
            >
              {runningAction === 'promote-batch' ? '入库中...' : '一键安全入库 PENDING'}
            </button>
          </div>
        </div>

        <div className="integration-kpi-grid">
          {(['PENDING', 'PROMOTED', 'CONFLICT', 'FAILED'] as PromotionStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`stat-card ${promoteTab === s ? 'selected-row' : ''}`}
              onClick={() => void selectPromoteTab(s)}
              style={{ textAlign: 'left', cursor: 'pointer' }}
            >
              <span>{promotionTabLabel[s]}</span>
              <strong>{promoteCounts ? promoteCounts[s] ?? 0 : '—'}</strong>
              <em>点击查看明细</em>
            </button>
          ))}
        </div>

        <div className="integration-readonly-banner" style={{ marginTop: 12 }}>
          <strong>按来源过滤：</strong>{' '}
          <button
            type="button"
            className={`ghost-btn table-action ${promoteFilterSource === '' ? 'selected-row' : ''}`}
            onClick={() => void selectPromoteSourceFilter('')}
          >
            全部
          </button>{' '}
          {promoteSummary?.sources?.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`ghost-btn table-action ${promoteFilterSource === s.id ? 'selected-row' : ''}`}
              onClick={() => void selectPromoteSourceFilter(s.id)}
              style={{ marginLeft: 6 }}
            >
              {s.name} · {s.counts[promoteTab] ?? 0}
              {s.autoPromote ? '（auto）' : ''}
            </button>
          ))}
        </div>

        {promoteSummary?.sources && promoteSummary.sources.length > 0 && (
          <div className="record-list" style={{ marginTop: 12 }}>
            {promoteSummary.sources.map((s) => (
              <div className="record-card" key={`auto-${s.id}`}>
                <div className="record-card-main">
                  <strong>{s.name}</strong>
                  <span>{s.code}</span>
                </div>
                <div className="record-card-target">
                  <span>自动入库开关</span>
                  <button
                    type="button"
                    className={s.autoPromote ? 'primary-btn' : 'ghost-btn'}
                    disabled={!isAdmin || runningAction === `autopromote-${s.id}`}
                    onClick={() => void toggleAutoPromote(s.id, !s.autoPromote)}
                  >
                    {s.autoPromote ? '已开启 · 点击关闭' : '已关闭 · 点击开启'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="hospital-table integration-table">
            <thead>
              <tr>
                <th>接收时间</th>
                <th>来源</th>
                <th>资源</th>
                <th>外部 ID</th>
                <th>状态</th>
                <th>说明</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {promoteItems.map((r) => (
                <tr key={r.id}>
                  <td>{formatTime(r.createdAt)}</td>
                  <td>{r.source?.name ?? '—'}</td>
                  <td>{resourceTypeLabelMap[r.externalRecordType] ?? r.externalRecordType}</td>
                  <td><code>{r.externalRecordId}</code></td>
                  <td><PromotionBadge status={r.promotionStatus} /></td>
                  <td>
                    {r.promotionStatus === 'PROMOTED' ? (
                      <span className="gateway-conflict-cell-summary">
                        已落 <code>{r.localTargetType ?? ''}</code>
                      </span>
                    ) : r.promotionStatus === 'CONFLICT' ? (
                      <button
                        type="button"
                        className="gateway-conflict-link-btn"
                        onClick={() => void openConflict(r.id)}
                      >
                        查看冲突详情 →
                      </button>
                    ) : r.promotionStatus === 'FAILED' ? (
                      <span className="gateway-conflict-cell-failed">
                        {r.promotionMessage?.slice(0, 60) || r.errorMessage?.slice(0, 60) || '处理失败'}
                        {(r.promotionMessage || r.errorMessage || '').length > 60 && '…'}
                      </span>
                    ) : (
                      <span className="gateway-conflict-cell-pending">等待入库</span>
                    )}
                  </td>
                  <td>
                    {r.promotionStatus === 'PENDING' && (
                      <button
                        className="primary-btn table-action"
                        disabled={!isAdmin || runningAction === `promote-${r.id}`}
                        onClick={() => void promoteOne(r.id, false)}
                      >
                        入库
                      </button>
                    )}
                    {r.promotionStatus === 'FAILED' && (
                      <>
                        <button
                          className="ghost-btn table-action"
                          onClick={() => void openConflict(r.id)}
                        >
                          查看
                        </button>
                        <button
                          className="primary-btn table-action"
                          style={{ marginLeft: 6 }}
                          disabled={!isAdminOrClinical || runningAction === `promote-${r.id}`}
                          onClick={() => void promoteOne(r.id, false)}
                        >
                          重试
                        </button>
                      </>
                    )}
                    {r.promotionStatus === 'CONFLICT' && (
                      <button
                        className="primary-btn table-action"
                        disabled={!isAdminOrClinical}
                        onClick={() => void openConflict(r.id)}
                      >
                        处理冲突
                      </button>
                    )}
                    {r.promotionStatus === 'PROMOTED' && (
                      <button
                        className="ghost-btn table-action"
                        onClick={() => void openConflict(r.id)}
                      >
                        查看
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!promoteItems.length && (
                <tr>
                  <td colSpan={7}>{promoteTab === 'PENDING' ? '当前 PENDING 队列为空 — 所有网关事件均已入库。' : '当前队列为空。'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
                <PromotionBadge status={record.promotionStatus} />
                <span>{record.localTargetType ? `${record.localTargetType} / ${record.localTargetId}` : record.errorMessage || record.promotionMessage || '未写入本地对象'}</span>
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

      {conflictDetail && (
        <GatewayConflictDrawer
          detail={conflictDetail}
          isAdminOrClinical={isAdminOrClinical}
          isWorking={conflictWorking}
          onForceOverwrite={() => void handleForceOverwriteFromDrawer()}
          onReject={(note) => void handleRejectFromDrawer(note)}
          onClose={closeConflict}
        />
      )}
    </div>
  );
}
