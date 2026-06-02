import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { showFeedbackError, showRequiredFieldMissing } from '../utils/feedbackMessage';
import {
  BloodPressureTrendChart,
  MiniBloodPressureTrendPreview,
  MiniVitalTrendPreview,
  VitalTrendChart,
} from './VitalTrendChart';
import '../closed-loop-events.css';
import '../task-clinical-context.css';

type ClinicalContext = {
  patientSummary: {
    name: string;
    gender: string;
    age: number;
    diseases: string[];
    riskLevel: string;
    responsibleDoctor?: string;
    responsibleNurse?: string;
  };
  taskRelevantData: {
    vitalType?: string;
    recentTrend?: any[];
    systolicTrend?: any[];
    diastolicTrend?: any[];
    latestValue?: string;
    abnormalCount: number;
    trendDirection: 'RISING' | 'FALLING' | 'STABLE' | 'FLUCTUATING';
  };
  recentHistory: Array<{
    date: string;
    type: string;
    description: string;
  }>;
  currentMedications: Array<{
    name: string;
    dosage: string;
    adherence: { taken: number; total: number };
    lastMissed?: string;
  }>;
};

type ExpandedContext = {
  taskRelated: any;
  vitalTrends: Record<string, any[]>;
  riskAlerts: any[];
  followUps: any[];
  medications: {
    active: any[];
    inactive: any[];
  };
  hospitalRecords: {
    encounters: any[];
    examReports: any[];
    summaries: any[];
    medications: any[];
  };
};

const riskLabelMap: Record<string, string> = {
  LOW: '低危',
  MEDIUM: '中危',
  HIGH: '高危',
  VERY_HIGH: '极高危',
};

const vitalTypeLabelMap: Record<string, string> = {
  BLOOD_PRESSURE: '血压',
  SYSTOLIC_BP: '血压',
  DIASTOLIC_BP: '血压',
  BLOOD_GLUCOSE: '血糖',
  SPO2: '血氧',
  HEART_RATE: '心率',
  WEIGHT: '体重',
};

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateTime(dateString: string) {
  const date = new Date(dateString);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getTrendLabel(direction: string) {
  switch (direction) {
    case 'RISING': return '持续升高';
    case 'FALLING': return '持续下降';
    case 'STABLE': return '基本稳定';
    case 'FLUCTUATING': return '波动较大';
    default: return '数据不足';
  }
}

function getUnitForVitalType(vitalType: string): string {
  switch (vitalType) {
    case 'BLOOD_PRESSURE':
    case 'SYSTOLIC_BP':
    case 'DIASTOLIC_BP':
      return 'mmHg';
    case 'BLOOD_GLUCOSE':
      return 'mmol/L';
    case 'SPO2':
      return '%';
    case 'HEART_RATE':
      return 'bpm';
    case 'WEIGHT':
      return 'kg';
    default:
      return '';
  }
}

function getTrendThresholds(vitalType: string) {
  switch (vitalType) {
    case 'BLOOD_GLUCOSE':
      return { thresholdHigh: 10, thresholdLow: 3.9 };
    case 'SPO2':
      return { thresholdLow: 95 };
    case 'HEART_RATE':
      return { thresholdHigh: 120, thresholdLow: 50 };
    default:
      return {};
  }
}

function buildChartTimeFormatter() {
  return (time?: string) => {
    if (!time) return '';
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };
}

function filterByRange(vitals: any[], rangeDays: string): any[] {
  const days = parseInt(rangeDays, 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return vitals.filter((v) => new Date(v.time) >= cutoff);
}

export function TaskClinicalContextPanel({
  taskId,
  patientId,
  taskType,
}: {
  taskId: string;
  patientId: string;
  taskType: string;
}) {
  const [context, setContext] = useState<ClinicalContext | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [expandedData, setExpandedData] = useState<ExpandedContext | null>(null);
  const [activeTab, setActiveTab] = useState<
    'trends' | 'alerts' | 'followups' | 'medications' | 'medical-records' | 'exam-reports'
  >('trends');
  const [loading, setLoading] = useState(true);
  const [trendRange, setTrendRange] = useState<string>('7');
  const [selectedVitalType, setSelectedVitalType] = useState<string>('BLOOD_PRESSURE');
  const [editingFollowUpId, setEditingFollowUpId] = useState<string | null>(null);

  useEffect(() => {
    loadClinicalContext();
  }, [taskId, patientId]);

  async function loadClinicalContext() {
    setLoading(true);
    try {
      const response = await api.get(`/tasks/${taskId}/clinical-context`);
      setContext(response.data);
    } catch (error) {
      console.error('Failed to load clinical context:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadExpandedContext() {
    if (expandedData) return;

    try {
      const response = await api.get(`/patients/${patientId}/clinical-timeline`, {
        params: { taskType },
      });
      setExpandedData(response.data);
    } catch (error) {
      console.error('Failed to load expanded context:', error);
    }
  }

  function handleExpand() {
    setExpanded(true);
    loadExpandedContext();
  }

  function renderExpandedVitalTrendChart(vitalType: string) {
    if (!expandedData) return null;

    const formatChartTime = buildChartTimeFormatter();

    if (vitalType === 'BLOOD_PRESSURE' || vitalType === 'SYSTOLIC_BP' || vitalType === 'DIASTOLIC_BP') {
      const systolicVitals = filterByRange(expandedData.vitalTrends.SYSTOLIC_BP || [], trendRange);
      const diastolicVitals = filterByRange(expandedData.vitalTrends.DIASTOLIC_BP || [], trendRange);

      if (systolicVitals.length === 0 && diastolicVitals.length === 0) {
        return <div className="clinical-trend-empty">当前时间范围内暂无血压趋势数据。</div>;
      }

      return (
        <BloodPressureTrendChart
          systolicVitals={systolicVitals}
          diastolicVitals={diastolicVitals}
          unit="mmHg"
          formatTime={formatChartTime}
        />
      );
    }

    const vitals = filterByRange(expandedData.vitalTrends[vitalType] || [], trendRange);

    if (vitals.length === 0) {
      return <div className="clinical-trend-empty">当前时间范围内暂无{vitalTypeLabelMap[vitalType] || '该指标'}趋势数据。</div>;
    }

    const thresholds = getTrendThresholds(vitalType);

    return (
      <VitalTrendChart
        vitals={vitals}
        vitalType={vitalType}
        vitalTypeName={vitalTypeLabelMap[vitalType] || vitalType}
        unit={getUnitForVitalType(vitalType)}
        formatTime={formatChartTime}
        {...thresholds}
      />
    );
  }

  if (loading) {
    return (
      <div className="clinical-context-panel">
        <div className="context-loading">加载患者临床背景...</div>
      </div>
    );
  }

  if (!context) {
    return null;
  }

  if (!expanded) {
    // Compact view - 4 cards
    return (
      <div className="clinical-context-panel compact">
        <div className="context-header">
          <div className="context-title">患者临床背景</div>
          <Link to={`/patients/${patientId}`} className="context-link">
            查看完整档案 →
          </Link>
        </div>

        {/* Card 1: Patient Disease Tags */}
        <div className="context-card">
          <div className="card-label">当前慢病标签</div>
          <div className="disease-tags">
            {context.patientSummary.diseases.map((disease, i) => (
              <span key={i} className="disease-tag">{disease}</span>
            ))}
          </div>
          <div className="card-meta">
            <span className={`risk-badge risk-${context.patientSummary.riskLevel.toLowerCase()}`}>
              当前风险：{riskLabelMap[context.patientSummary.riskLevel]}
            </span>
          </div>
          {context.patientSummary.responsibleDoctor && (
            <div className="card-detail">
              责任医生：{context.patientSummary.responsibleDoctor}
            </div>
          )}
          {context.patientSummary.responsibleNurse && (
            <div className="card-detail">
              责任护士：{context.patientSummary.responsibleNurse}
            </div>
          )}
        </div>

        {/* Card 2: Task-Relevant Vital Trend */}
        {context.taskRelevantData.vitalType && (
          <div className="context-card">
            <div className="card-label">当前任务相关指标</div>
            <div className="card-value">
              近7天{vitalTypeLabelMap[context.taskRelevantData.vitalType]}：
              {getTrendLabel(context.taskRelevantData.trendDirection)}
            </div>
            {context.taskRelevantData.latestValue && (
              <div className="card-highlight">
                最近一次：{context.taskRelevantData.latestValue}
              </div>
            )}
            <div className="card-detail">
              近7天异常：{context.taskRelevantData.abnormalCount}次
            </div>
            {((context.taskRelevantData.recentTrend && context.taskRelevantData.recentTrend.length > 0) ||
              (context.taskRelevantData.systolicTrend && context.taskRelevantData.systolicTrend.length > 0)) && (
              <div className="mini-trend">
                {context.taskRelevantData.vitalType === 'SYSTOLIC_BP' &&
                context.taskRelevantData.systolicTrend &&
                context.taskRelevantData.diastolicTrend ? (
                  <MiniBloodPressureTrendPreview
                    systolicVitals={context.taskRelevantData.systolicTrend}
                    diastolicVitals={context.taskRelevantData.diastolicTrend}
                    unit="mmHg"
                    formatTime={(time) => {
                      if (!time) return '';
                      const d = new Date(time);
                      return `${d.getMonth() + 1}/${d.getDate()}`;
                    }}
                  />
                ) : context.taskRelevantData.recentTrend && context.taskRelevantData.recentTrend.length > 0 ? (
                  <MiniVitalTrendPreview
                    vitals={context.taskRelevantData.recentTrend}
                    unit={context.taskRelevantData.recentTrend[0]?.data?.unit || ''}
                    formatTime={(time) => {
                      if (!time) return '';
                      const d = new Date(time);
                      return `${d.getMonth() + 1}/${d.getDate()}`;
                    }}
                  />
                ) : null}
              </div>
            )}
          </div>
        )}

        {/* Card 3: Recent History */}
        <div className="context-card">
          <div className="card-label">最近处理历史</div>
          {context.recentHistory.slice(0, 3).map((item, i) => (
            <div key={i} className="history-item">
              <span className="history-date">{formatDate(item.date)}</span>
              <span className="history-type">{item.type}：</span>
              <span className="history-desc">{item.description}</span>
            </div>
          ))}
        </div>

        {/* Card 4: Current Medications */}
        {context.currentMedications.length > 0 && (
          <div className="context-card">
            <div className="card-label">当前用药 / 依从性</div>
            {context.currentMedications.map((med, i) => (
              <div key={i} className="medication-item">
                <div className="med-name">{med.name} {med.dosage}</div>
                <div className="med-adherence">
                  近7天用药打卡：{med.adherence.taken}/{med.adherence.total}
                  {med.lastMissed && (
                    <span className="med-missed">最近漏服：{formatDate(med.lastMissed)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <button className="expand-context-btn" onClick={handleExpand}>
          展开完整临床背景
        </button>
      </div>
    );
  }

  // Expanded view - Tabs
  return (
    <div className="clinical-context-panel expanded">
      <div className="context-header">
        <div className="context-title">患者临床背景</div>
        <div className="context-actions">
          <Link to={`/patients/${patientId}`} className="context-link">
            查看完整档案 →
          </Link>
          <button className="collapse-btn" onClick={() => setExpanded(false)}>
            收起
          </button>
        </div>
      </div>

      <div className="context-tabs">
        <button
          className={activeTab === 'trends' ? 'context-tab active' : 'context-tab'}
          onClick={() => setActiveTab('trends')}
        >
          指标趋势
        </button>
        <button
          className={activeTab === 'alerts' ? 'context-tab active' : 'context-tab'}
          onClick={() => setActiveTab('alerts')}
        >
          过往预警
        </button>
        <button
          className={activeTab === 'followups' ? 'context-tab active' : 'context-tab'}
          onClick={() => setActiveTab('followups')}
        >
          随访记录
        </button>
        <button
          className={activeTab === 'medications' ? 'context-tab active' : 'context-tab'}
          onClick={() => setActiveTab('medications')}
        >
          用药记录
        </button>
        <button
          className={activeTab === 'medical-records' ? 'context-tab active' : 'context-tab'}
          onClick={() => setActiveTab('medical-records')}
        >
          病历
        </button>
        <button
          className={activeTab === 'exam-reports' ? 'context-tab active' : 'context-tab'}
          onClick={() => setActiveTab('exam-reports')}
        >
          检查报告
        </button>
      </div>

      <div className="context-tab-content">
        {activeTab === 'trends' && expandedData && (
          <div className="tab-panel">
            <div className="panel-hint">
              查看各项健康指标的长期趋势，支持切换时间范围。
            </div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <select
                value={trendRange}
                onChange={(e) => setTrendRange(e.target.value)}
                style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }}
              >
                <option value="7">近 7 天</option>
                <option value="30">近 30 天</option>
                <option value="90">近 90 天</option>
              </select>
              <select
                value={selectedVitalType}
                onChange={(e) => setSelectedVitalType(e.target.value)}
                style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }}
              >
                <option value="BLOOD_PRESSURE">血压</option>
                <option value="BLOOD_GLUCOSE">血糖</option>
                <option value="SPO2">血氧</option>
                <option value="HEART_RATE">心率</option>
                <option value="WEIGHT">体重</option>
              </select>
            </div>
            <div className="clinical-trend-summary">
              {selectedVitalType === 'BLOOD_PRESSURE' ? (
                <>
                  血压趋势：收缩压 {filterByRange(expandedData.vitalTrends.SYSTOLIC_BP || [], trendRange).length} 条 ·
                  舒张压 {filterByRange(expandedData.vitalTrends.DIASTOLIC_BP || [], trendRange).length} 条
                </>
              ) : (
                <>
                  {vitalTypeLabelMap[selectedVitalType]}趋势：
                  {filterByRange(expandedData.vitalTrends[selectedVitalType] || [], trendRange).length} 条记录
                </>
              )}
            </div>
            <div className="clinical-trend-chart-section">
              {renderExpandedVitalTrendChart(selectedVitalType)}
            </div>
          </div>
        )}

        {activeTab === 'alerts' && expandedData && (
          <div className="tab-panel">
            <div className="panel-hint">
              历史风险预警记录，重点关注重复发生和处理结果。
            </div>
            <div className="alerts-timeline">
              {expandedData.riskAlerts.map((alert: any) => (
                <div key={alert.id} style={{ marginBottom: '16px', padding: '12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', color: '#6b7280', minWidth: '80px' }}>
                      {formatDate(alert.createdAt)}
                    </span>
                    <span className={`risk-badge risk-${alert.riskLevel.toLowerCase()}`}>
                      {alert.riskLevel}
                    </span>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#111827', flex: 1 }}>
                      {alert.title}
                    </span>
                    <span style={{ fontSize: '12px', padding: '2px 8px', background: alert.status === 'RESOLVED' ? '#d1fae5' : alert.status === 'IN_PROGRESS' ? '#fef3c7' : '#fee2e2', color: alert.status === 'RESOLVED' ? '#065f46' : alert.status === 'IN_PROGRESS' ? '#92400e' : '#991b1b', borderRadius: '12px' }}>
                      {alert.status === 'OPEN' ? '待处理' : alert.status === 'IN_PROGRESS' ? '处理中' : alert.status === 'RESOLVED' ? '已处理' : '已忽略'}
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '6px' }}>
                    {alert.description}
                  </div>
                  {alert.handlingNote && (
                    <div style={{ fontSize: '12px', color: '#059669', padding: '6px 10px', background: '#f0fdf4', borderRadius: '4px' }}>
                      处理记录：{alert.handlingNote}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'followups' && expandedData && (
          <div className="tab-panel">
            <div className="panel-hint">
              随访记录默认只读，如需修改请点击编辑并填写修改原因。
            </div>
            <div className="followups-list">
              {expandedData.followUps.map((followUp: any) => (
                <div key={followUp.id} style={{ marginBottom: '16px', padding: '12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#111827' }}>
                        {formatDateTime(followUp.followUpTime)}
                      </span>
                      <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '12px' }}>
                        {followUp.followUpType}
                      </span>
                    </div>
                    {editingFollowUpId !== followUp.id && (
                      <button
                        onClick={() => setEditingFollowUpId(followUp.id)}
                        style={{ padding: '4px 12px', fontSize: '12px', color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        编辑
                      </button>
                    )}
                  </div>
                  {editingFollowUpId === followUp.id ? (
                    <FollowUpEditForm
                      followUp={followUp}
                      onSave={async (updates) => {
                        try {
                          await api.patch(`/follow-ups/${followUp.id}`, updates);
                          setEditingFollowUpId(null);
                          setExpandedData(null);
                          loadExpandedContext();
                        } catch (error) {
                          console.error('Failed to update follow-up:', error);
                          showFeedbackError('更新失败，请重试');
                        }
                      }}
                      onCancel={() => setEditingFollowUpId(null)}
                    />
                  ) : (
                    <div style={{ fontSize: '13px', color: '#374151' }}>
                      {followUp.content && (
                        <div style={{ marginBottom: '6px' }}>
                          <strong>内容：</strong>{followUp.content}
                        </div>
                      )}
                      {followUp.result && (
                        <div style={{ marginBottom: '6px' }}>
                          <strong>结果：</strong>{followUp.result}
                        </div>
                      )}
                      {followUp.suggestion && (
                        <div style={{ marginBottom: '6px' }}>
                          <strong>建议：</strong>{followUp.suggestion}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'medications' && expandedData && (
          <div className="tab-panel">
            <div className="panel-hint">
              当前用药和历史调整，关注依从性和漏服情况。
            </div>
            <div className="medications-section" style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', marginBottom: '12px' }}>
                当前用药
              </div>
              {expandedData.medications.active.map((med: any) => (
                <div key={med.id} style={{ marginBottom: '12px', padding: '12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: '#111827', marginBottom: '4px' }}>
                    {med.medicationName} {med.dosage}
                  </div>
                  <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '6px' }}>
                    {med.frequency}
                  </div>
                  {med.adherenceSummary && (
                    <div style={{ fontSize: '13px', color: '#374151' }}>
                      近 30 天用药依从性：
                      <span style={{ fontWeight: 600, color: med.adherenceSummary.adherenceRate >= 80 ? '#059669' : '#dc2626', marginLeft: '6px' }}>
                        {med.adherenceSummary.adherenceRate}%
                      </span>
                      <span style={{ color: '#6b7280', marginLeft: '6px' }}>
                        （打卡 {med.adherenceSummary.recentTakenCount}/{med.adherenceSummary.recentCheckInCount} 次）
                      </span>
                    </div>
                  )}
                  {med.lastMissedCheckIn && (
                    <div style={{ fontSize: '12px', color: '#dc2626', marginTop: '4px' }}>
                      最近漏服：{formatDate(med.lastMissedCheckIn.checkedAt)}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {expandedData.medications.inactive.length > 0 && (
              <div className="medications-section">
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', marginBottom: '12px' }}>
                  历史调整
                </div>
                {expandedData.medications.inactive.map((med: any) => (
                  <div key={med.id} style={{ marginBottom: '8px', padding: '8px', background: '#f9fafb', borderRadius: '4px', fontSize: '13px', color: '#6b7280' }}>
                    <span style={{ fontWeight: 500, color: '#374151' }}>{med.medicationName}</span>
                    <span style={{ marginLeft: '12px' }}>
                      {formatDate(med.startDate || med.createdAt)} - {formatDate(med.endDate || med.updatedAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'medical-records' && expandedData && (
          <div className="tab-panel">
            <div className="panel-hint">
              院内就诊与病历摘要，不展示完整病历原文；如需完整文档请到 HIS 内查阅。
            </div>
            {expandedData.hospitalRecords.encounters.length === 0 &&
              expandedData.hospitalRecords.summaries.length === 0 && (
                <div className="clinical-trend-empty">暂无就诊记录或病历摘要。</div>
              )}
            {expandedData.hospitalRecords.encounters.length > 0 && (
              <div className="medical-records-section">
                <div className="medical-records-section-title">就诊记录</div>
                {expandedData.hospitalRecords.encounters.map((encounter: any) => (
                  <div key={encounter.id} className="medical-record-card">
                    <div className="medical-record-card-head">
                      <span className="medical-record-card-title">
                        {encounter.departmentName || '未知科室'}
                      </span>
                      <span className="medical-record-card-date">
                        {formatDate(encounter.visitTime)}
                      </span>
                    </div>
                    {encounter.chiefComplaint && (
                      <div className="medical-record-card-line">
                        <em>主诉</em>
                        <span>{encounter.chiefComplaint}</span>
                      </div>
                    )}
                    {encounter.diagnosisSummary && (
                      <div className="medical-record-card-line">
                        <em>诊断</em>
                        <span>{encounter.diagnosisSummary}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {expandedData.hospitalRecords.summaries.length > 0 && (
              <div className="medical-records-section">
                <div className="medical-records-section-title">病历摘要</div>
                {expandedData.hospitalRecords.summaries.map((summary: any) => (
                  <div key={summary.id} className="medical-record-card">
                    <div className="medical-record-card-head">
                      <span className="medical-record-card-title">
                        {summary.title}
                      </span>
                      <span className="medical-record-card-date">
                        {formatDate(summary.recordTime)}
                      </span>
                    </div>
                    {summary.summary && (
                      <div className="medical-record-card-summary">
                        {summary.summary}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'exam-reports' && expandedData && (
          <div className="tab-panel">
            <div className="panel-hint">
              检验、影像、心电等检查报告，包含结论和异常提示。
            </div>
            {expandedData.hospitalRecords.examReports.length === 0 ? (
              <div className="clinical-trend-empty">暂无检查报告。</div>
            ) : (
              <div className="medical-records-section">
                {expandedData.hospitalRecords.examReports.map((report: any) => (
                  <div key={report.id} className="medical-record-card exam-report-card">
                    <div className="medical-record-card-head">
                      <span className="medical-record-card-title">
                        {report.examName}
                      </span>
                      <span className="medical-record-card-date">
                        {formatDate(report.examTime)}
                      </span>
                    </div>
                    {report.conclusion && (
                      <div className="medical-record-card-summary">
                        {report.conclusion}
                      </div>
                    )}
                    {report.abnormalFlag && (
                      <div className="medical-record-card-flag">异常提示</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FollowUpEditForm({
  followUp,
  onSave,
  onCancel,
}: {
  followUp: any;
  onSave: (updates: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [content, setContent] = useState(followUp.content || '');
  const [result, setResult] = useState(followUp.result || '');
  const [suggestion, setSuggestion] = useState(followUp.suggestion || '');
  const [editReason, setEditReason] = useState('');
  const [electronicSignature, setElectronicSignature] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editReason || !electronicSignature) {
      showRequiredFieldMissing('请填写修改原因和电子签名');
      return;
    }
    setSubmitting(true);
    try {
      await onSave({ content, result, suggestion, editReason, electronicSignature });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ padding: '12px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '6px' }}>
      <div style={{ marginBottom: '10px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>
          内容：
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={{ width: '100%', padding: '6px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', minHeight: '60px' }}
        />
      </div>
      <div style={{ marginBottom: '10px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>
          结果：
        </label>
        <textarea
          value={result}
          onChange={(e) => setResult(e.target.value)}
          style={{ width: '100%', padding: '6px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', minHeight: '60px' }}
        />
      </div>
      <div style={{ marginBottom: '10px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>
          建议：
        </label>
        <textarea
          value={suggestion}
          onChange={(e) => setSuggestion(e.target.value)}
          style={{ width: '100%', padding: '6px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', minHeight: '60px' }}
        />
      </div>
      <div style={{ marginBottom: '10px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#dc2626', marginBottom: '4px' }}>
          修改原因（必填）：
        </label>
        <input
          type="text"
          value={editReason}
          onChange={(e) => setEditReason(e.target.value)}
          required
          style={{ width: '100%', padding: '6px', border: '1px solid #fca5a5', borderRadius: '4px', fontSize: '13px' }}
        />
      </div>
      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#dc2626', marginBottom: '4px' }}>
          电子签名（必填）：
        </label>
        <input
          type="text"
          value={electronicSignature}
          onChange={(e) => setElectronicSignature(e.target.value)}
          required
          style={{ width: '100%', padding: '6px', border: '1px solid #fca5a5', borderRadius: '4px', fontSize: '13px' }}
        />
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          type="submit"
          disabled={submitting}
          style={{ padding: '6px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', fontSize: '13px', fontWeight: 500, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}
        >
          {submitting ? '提交中...' : '提交修改'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          style={{ padding: '6px 16px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', fontWeight: 500, cursor: submitting ? 'not-allowed' : 'pointer' }}
        >
          取消
        </button>
      </div>
    </form>
  );
}
