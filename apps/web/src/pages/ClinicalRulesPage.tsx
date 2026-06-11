import { useEffect, useMemo, useState } from 'react';
import { api, getApiErrorMessage } from '../api/client';
import { getRoleLabel, type CurrentUser } from './LoginPage';
import { useFeedbackInferredBridge } from '../utils/feedbackMessage';

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
type LifecycleStatus = 'DRAFT' | 'PHYSICIAN_REVIEW' | 'PUBLISHED' | 'EFFECTIVE' | 'DEACTIVATED';

type VitalThresholdRule = {
  id: string;
  vitalType: string;
  displayName: string;
  unit: string;
  operator: string;
  thresholdValue: number;
  thresholdValueMax?: number | null;
  riskLevel: RiskLevel;
  alertTitle: string;
  alertDescription?: string | null;
  followUpAction?: string | null;
  sortOrder: number;
  isActive: boolean;
};

type FollowUpPolicy = {
  id: string;
  riskLevel: RiskLevel;
  followUpType: string;
  dueWithinHours: number;
  frequencyDescription: string;
  taskTitle: string;
  instruction?: string | null;
  isActive: boolean;
};

type QuestionnaireTemplate = {
  id: string;
  questionnaireType: string;
  title: string;
  description?: string | null;
  isActive: boolean;
};

type Approval = {
  id: string;
  reviewerId: string;
  reviewerRole: string;
  decision: string;
  note?: string | null;
  createdAt: string;
};

type DiseaseRuleTemplate = {
  id: string;
  diseaseType: string;
  templateName: string;
  description?: string | null;
  managementGoal?: string | null;
  riskBasis?: string | null;
  evidenceBasis?: string | null;
  version: string;
  lifecycleStatus: LifecycleStatus;
  isActive: boolean;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  approvals: Approval[];
  vitalThresholdRules: VitalThresholdRule[];
  followUpPolicies: FollowUpPolicy[];
  questionnaireTemplates: QuestionnaireTemplate[];
};

type DraftThreshold = Pick<
  VitalThresholdRule,
  | 'displayName'
  | 'unit'
  | 'operator'
  | 'thresholdValue'
  | 'thresholdValueMax'
  | 'riskLevel'
  | 'alertTitle'
  | 'alertDescription'
  | 'followUpAction'
  | 'sortOrder'
  | 'isActive'
>;

const diseaseTypeLabelMap: Record<string, string> = {
  HYPERTENSION: '高血压',
  TYPE_2_DIABETES: '2 型糖尿病',
  COPD: '慢阻肺',
  CORONARY_HEART_DISEASE: '冠心病',
  HYPERLIPIDEMIA: '高脂血症',
  OBESITY: '肥胖/代谢综合征',
  OTHER: '其他',
};

const lifecycleLabelMap: Record<LifecycleStatus, string> = {
  DRAFT: '草稿',
  PHYSICIAN_REVIEW: '医生审核中',
  PUBLISHED: '已发布待生效',
  EFFECTIVE: '生效中',
  DEACTIVATED: '已停用',
};

const riskLabelMap: Record<RiskLevel, string> = {
  LOW: '低危',
  MEDIUM: '中危',
  HIGH: '高危',
  VERY_HIGH: '极高危',
};

const operatorLabelMap: Record<string, string> = {
  GTE: '≥',
  GT: '>',
  LTE: '≤',
  LT: '<',
  BETWEEN: '介于',
  OUTSIDE_RANGE: '超出区间',
};

const operatorOptions = ['GTE', 'GT', 'LTE', 'LT', 'BETWEEN', 'OUTSIDE_RANGE'];
const riskOptions: RiskLevel[] = ['MEDIUM', 'HIGH', 'VERY_HIGH', 'LOW'];

function getDraft(rule: VitalThresholdRule): DraftThreshold {
  return {
    displayName: rule.displayName,
    unit: rule.unit,
    operator: rule.operator,
    thresholdValue: rule.thresholdValue,
    thresholdValueMax: rule.thresholdValueMax ?? null,
    riskLevel: rule.riskLevel,
    alertTitle: rule.alertTitle,
    alertDescription: rule.alertDescription ?? '',
    followUpAction: rule.followUpAction ?? '',
    sortOrder: rule.sortOrder,
    isActive: rule.isActive,
  };
}

function ThresholdEditor({
  rule,
  readOnly,
  draft,
  onDraftChange,
  onSave,
  saving,
}: {
  rule: VitalThresholdRule;
  readOnly: boolean;
  draft: DraftThreshold;
  onDraftChange: (next: DraftThreshold) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className={rule.isActive ? 'rule-row' : 'rule-row muted-rule'}>
      <div className="rule-row-main">
        <div className="rule-vital-name"><strong>{rule.displayName}</strong><span>{rule.vitalType}</span></div>
        <div className={`risk-badge risk-${rule.riskLevel.toLowerCase()}`}>{riskLabelMap[rule.riskLevel]}</div>
      </div>

      {readOnly ? (
        <div className="rule-readonly-grid">
          <div><span>触发条件</span>{operatorLabelMap[rule.operator] ?? rule.operator} {rule.thresholdValue}{rule.thresholdValueMax ? `–${rule.thresholdValueMax}` : ''} {rule.unit}</div>
          <div><span>预警标题</span>{rule.alertTitle}</div>
          <div><span>随访动作</span>{rule.followUpAction || '未配置'}</div>
          <div><span>状态</span>{rule.isActive ? '启用' : '停用'}</div>
        </div>
      ) : (
        <div className="rule-edit-grid">
          <label>指标名称<input value={draft.displayName} onChange={(e) => onDraftChange({ ...draft, displayName: e.target.value })} /></label>
          <label>单位<input value={draft.unit} onChange={(e) => onDraftChange({ ...draft, unit: e.target.value })} /></label>
          <label>条件<select value={draft.operator} onChange={(e) => onDraftChange({ ...draft, operator: e.target.value })}>{operatorOptions.map((op) => <option key={op} value={op}>{operatorLabelMap[op]}</option>)}</select></label>
          <label>阈值<input type="number" value={draft.thresholdValue} onChange={(e) => onDraftChange({ ...draft, thresholdValue: Number(e.target.value) })} /></label>
          <label>上限<input type="number" value={draft.thresholdValueMax ?? ''} onChange={(e) => onDraftChange({ ...draft, thresholdValueMax: e.target.value ? Number(e.target.value) : null })} /></label>
          <label>风险等级<select value={draft.riskLevel} onChange={(e) => onDraftChange({ ...draft, riskLevel: e.target.value as RiskLevel })}>{riskOptions.map((risk) => <option key={risk} value={risk}>{riskLabelMap[risk]}</option>)}</select></label>
          <label className="wide-field">预警标题<input value={draft.alertTitle} onChange={(e) => onDraftChange({ ...draft, alertTitle: e.target.value })} /></label>
          <label className="wide-field">处理建议<input value={draft.followUpAction || ''} onChange={(e) => onDraftChange({ ...draft, followUpAction: e.target.value })} /></label>
          <label className="rule-toggle-field"><input type="checkbox" checked={draft.isActive} onChange={(e) => onDraftChange({ ...draft, isActive: e.target.checked })} />启用规则</label>
          <button className="primary-btn" type="button" onClick={onSave} disabled={saving}>{saving ? '保存中...' : '保存草稿规则'}</button>
        </div>
      )}
    </div>
  );
}

export function ClinicalRulesPage({ user }: { user: CurrentUser }) {
  const [templates, setTemplates] = useState<DiseaseRuleTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, DraftThreshold>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [message, setMessage] = useState('');

  useFeedbackInferredBridge(message);
  const isAdmin = user.role === 'ADMIN';
  const canApprove = user.role === 'ADMIN' || user.role === 'DOCTOR';

  async function loadRules(selectId?: string) {
    setLoading(true);
    try {
      const res = await api.get<DiseaseRuleTemplate[]>('/clinical-rules/summary');
      setTemplates(res.data);
      setSelectedTemplateId((current) => selectId || current || res.data[0]?.id || '');
      const nextDrafts: Record<string, DraftThreshold> = {};
      res.data.forEach((template) => template.vitalThresholdRules.forEach((rule) => { nextDrafts[rule.id] = getDraft(rule); }));
      setDrafts(nextDrafts);
    } catch (err) {
      setMessage(getApiErrorMessage(err, '规则读取失败。请确认已执行数据库迁移。'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadRules(); }, []);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || templates[0],
    [templates, selectedTemplateId],
  );
  const canEditSelected = Boolean(isAdmin && selectedTemplate?.lifecycleStatus === 'DRAFT');

  async function seedDefaults() {
    setSavingId('seed-defaults');
    setMessage('');
    try {
      await api.post('/clinical-rules/seed-defaults');
      setMessage('默认规则已初始化。后续调整请克隆草稿并走审核发布流程。');
      await loadRules();
    } catch (err) {
      setMessage(getApiErrorMessage(err, '刷新默认规则失败。只有系统管理员可以执行。'));
    } finally {
      setSavingId('');
    }
  }

  async function saveRule(ruleId: string) {
    const draft = drafts[ruleId];
    if (!draft) return;
    setSavingId(ruleId);
    setMessage('');
    try {
      await api.patch(`/clinical-rules/vital-threshold-rules/${ruleId}`, draft);
      setMessage('草稿规则已保存。生效前仍需医生审核、发布和激活。');
      await loadRules(selectedTemplate?.id);
    } catch (err) {
      setMessage(getApiErrorMessage(err, '保存失败。只有 Draft 版本可编辑。'));
    } finally {
      setSavingId('');
    }
  }

  async function runTemplateAction(action: string, body: Record<string, unknown> = {}) {
    if (!selectedTemplate) return;
    setSavingId(action);
    setMessage('');
    try {
      const res = await api.post(`/clinical-rules/templates/${selectedTemplate.id}/${action}`, body);
      setMessage('规则版本状态已更新。');
      await loadRules(res.data?.id || selectedTemplate.id);
    } catch (err) {
      setMessage(getApiErrorMessage(err, '规则版本操作失败，请检查当前状态和审核人数。'));
    } finally {
      setSavingId('');
    }
  }

  async function cloneDraft() {
    const version = window.prompt('请输入新规则版本号，例如 v2 或 2026-06-pilot：', `draft-${Date.now()}`);
    if (!version) return;
    await runTemplateAction('clone-draft', { version });
  }

  return (
    <div className="page clinical-rules-page clinical-rules-release-v9-page">
      <div className="header-actions clinical-rules-compact-actions">
        <span className="topbar-pill">当前角色：{getRoleLabel(user.role)}</span>
        {isAdmin && <button className="secondary-btn" type="button" onClick={() => void seedDefaults()} disabled={savingId === 'seed-defaults'}>{savingId === 'seed-defaults' ? '刷新中...' : '初始化默认规则'}</button>}
      </div>

      {message && <div className="notice-card">{message}</div>}

      {loading ? (
        <div className="hospital-card">规则加载中...</div>
      ) : templates.length === 0 ? (
        <div className="hospital-card empty-rule-state"><h2>尚未初始化慢病规则</h2><p>使用管理员账号点击“初始化默认规则”。</p></div>
      ) : (
        <div className="rules-layout">
          <aside className="rules-template-list hospital-card">
            <div className="section-title-row compact"><div><h2>规则版本</h2><p className="muted">生效版本只读；修改必须新建草稿。</p></div></div>
            {templates.map((template) => (
              <button key={template.id} className={template.id === selectedTemplate?.id ? 'template-tab active' : 'template-tab'} type="button" onClick={() => setSelectedTemplateId(template.id)}>
                <strong>{diseaseTypeLabelMap[template.diseaseType] ?? template.diseaseType}</strong>
                <span>{template.version} · {lifecycleLabelMap[template.lifecycleStatus]}</span>
              </button>
            ))}
          </aside>

          {selectedTemplate && (
            <section className="rules-detail hospital-card">
              <div className="section-title-row">
                <div><h2>{selectedTemplate.templateName}</h2><p>{selectedTemplate.description}</p></div>
                <span className={`status-pill lifecycle-${selectedTemplate.lifecycleStatus.toLowerCase()}`}>{lifecycleLabelMap[selectedTemplate.lifecycleStatus]}</span>
              </div>

              <div className="rule-release-actionbar">
                {isAdmin && selectedTemplate.lifecycleStatus !== 'DRAFT' && <button className="secondary-btn" type="button" onClick={() => void cloneDraft()} disabled={Boolean(savingId)}>克隆为新草稿</button>}
                {isAdmin && selectedTemplate.lifecycleStatus === 'DRAFT' && <button className="primary-btn" type="button" onClick={() => void runTemplateAction('submit-review', { note: '提交医生审核' })} disabled={Boolean(savingId)}>提交医生审核</button>}
                {canApprove && selectedTemplate.lifecycleStatus === 'PHYSICIAN_REVIEW' && <button className="primary-btn" type="button" onClick={() => void runTemplateAction('approve', { note: '审核通过' })} disabled={Boolean(savingId)}>审核通过</button>}
                {isAdmin && selectedTemplate.lifecycleStatus === 'PHYSICIAN_REVIEW' && <button className="secondary-btn" type="button" onClick={() => void runTemplateAction('publish')} disabled={Boolean(savingId)}>发布版本</button>}
                {isAdmin && selectedTemplate.lifecycleStatus === 'PUBLISHED' && <button className="primary-btn" type="button" onClick={() => void runTemplateAction('activate')} disabled={Boolean(savingId)}>激活生效</button>}
                {isAdmin && selectedTemplate.lifecycleStatus === 'EFFECTIVE' && <button className="secondary-btn" type="button" onClick={() => void runTemplateAction('deactivate')} disabled={Boolean(savingId)}>停用版本</button>}
              </div>

              <div className="rules-meta-grid">
                <div><span>版本</span>{selectedTemplate.version}</div>
                <div><span>规则依据</span>{selectedTemplate.evidenceBasis || selectedTemplate.riskBasis || '未配置'}</div>
                <div><span>审核记录</span>{selectedTemplate.approvals.length} 人已批准</div>
                <div><span>权限说明</span>{canEditSelected ? '当前为草稿，可编辑阈值' : '当前版本只读，请克隆新草稿后修改'}</div>
              </div>

              <div className="rule-section-block">
                <div className="section-title-row compact"><div><h3>指标阈值规则</h3><p className="muted">风险预警会保存规则 ID、版本、快照、输入和匹配条件。</p></div></div>
                <div className="rule-row-list">
                  {selectedTemplate.vitalThresholdRules.map((rule) => (
                    <ThresholdEditor
                      key={rule.id}
                      rule={rule}
                      readOnly={!canEditSelected}
                      draft={drafts[rule.id] || getDraft(rule)}
                      onDraftChange={(next) => setDrafts((current) => ({ ...current, [rule.id]: next }))}
                      onSave={() => void saveRule(rule.id)}
                      saving={savingId === rule.id}
                    />
                  ))}
                </div>
              </div>

              <div className="rules-two-column">
                <div className="rule-section-block compact-card"><h3>随访策略</h3>{selectedTemplate.followUpPolicies.map((policy) => <div className="policy-item" key={policy.id}><div><strong>{riskLabelMap[policy.riskLevel]}</strong><span>{policy.followUpType}</span></div><p>{policy.taskTitle} · {policy.dueWithinHours} 小时内</p></div>)}</div>
                <div className="rule-section-block compact-card"><h3>问卷模板</h3>{selectedTemplate.questionnaireTemplates.map((questionnaire) => <div className="policy-item" key={questionnaire.id}><div><strong>{questionnaire.title}</strong><span>{questionnaire.questionnaireType}</span></div><p>{questionnaire.description || '未配置说明'}</p></div>)}</div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}


