import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';

type TimelineEvent = {
  type: string;
  time: string;
  title: string;
  description: string;
  data: any;
};

type PatientTimelineResponse = {
  patient: {
    id: string;
    hospitalPatientId?: string;
    name: string;
    gender: string;
    birthDate?: string;
    phone?: string;
    address?: string;
    responsibleDoctorId?: string;
    responsibleNurseId?: string;
  };
  timeline: TimelineEvent[];
};

const nurseId = 'nurse-001';

const genderLabelMap: Record<string, string> = {
  MALE: '男',
  FEMALE: '女',
  UNKNOWN: '未知',
};

const diseaseLabelMap: Record<string, string> = {
  HYPERTENSION: '高血压',
  TYPE_2_DIABETES: '2型糖尿病',
  COPD: '慢阻肺',
  CORONARY_HEART_DISEASE: '冠心病',
  HYPERLIPIDEMIA: '高脂血症',
  OBESITY: '肥胖',
  OTHER: '其他',
};

const riskLabelMap: Record<string, string> = {
  LOW: '低危',
  MEDIUM: '中危',
  HIGH: '高危',
  VERY_HIGH: '极高危',
};

const dataSourceLabelMap: Record<string, string> = {
  HIS: 'HIS',
  EMR: 'EMR',
  LIS: 'LIS',
  MINI_PROGRAM: '患者小程序',
  NURSE_INPUT: '护士录入',
  MANUAL_IMPORT: '人工导入',
};

const timelineTypeLabelMap: Record<string, string> = {
  ALL: '全部记录',
  DISEASE_PROFILE: '慢病档案',
  VITAL_RECORD: '健康指标',
  RISK_ALERT: '风险预警',
  FOLLOW_UP: '随访记录',
  TASK: '待办任务',
};

const vitalTypeLabelMap: Record<string, string> = {
  SYSTOLIC_BP: '收缩压',
  DIASTOLIC_BP: '舒张压',
  BLOOD_GLUCOSE: '血糖',
  WEIGHT: '体重',
  HEART_RATE: '心率',
  SPO2: '血氧',
};

const taskTypeLabelMap: Record<string, string> = {
  FOLLOW_UP: '随访任务',
  RISK_ALERT_FOLLOW_UP: '风险预警处理',
  RECHECK_REMINDER: '复查提醒',
  MEDICATION_REMINDER: '用药提醒',
  LAB_TEST_REMINDER: '检查提醒',
};

const followUpTypeLabelMap: Record<string, string> = {
  PHONE: '电话随访',
  WECHAT: '微信随访',
  OUTPATIENT: '门诊随访',
  HOME_VISIT: '上门随访',
};

const statusLabelMap: Record<string, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '处理中',
  DONE: '已完成',
  CANCELED: '已取消',
  OPEN: '未处理',
  RESOLVED: '已处理',
  DISMISSED: '已忽略',
};

const timelineTabs = [
  'ALL',
  'DISEASE_PROFILE',
  'VITAL_RECORD',
  'RISK_ALERT',
  'FOLLOW_UP',
  'TASK',
];

function formatTime(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatDate(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('zh-CN');
}

function getTimelineCardClass(type: string) {
  if (type === 'RISK_ALERT') return 'timeline-card timeline-card-risk';
  if (type === 'FOLLOW_UP') return 'timeline-card timeline-card-follow-up';
  if (type === 'TASK') return 'timeline-card timeline-card-task';
  if (type === 'DISEASE_PROFILE') return 'timeline-card timeline-card-disease';
  return 'timeline-card';
}

function isLowPriorityHistory(item: TimelineEvent) {
  const status = item.data?.status;

  return (
    (item.type === 'TASK' && (status === 'DONE' || status === 'CANCELED')) ||
    (item.type === 'RISK_ALERT' && (status === 'RESOLVED' || status === 'DISMISSED'))
  );
}

function toIsoDateTime(value: string) {
  return value ? new Date(value).toISOString() : undefined;
}

export function PatientDetailPage() {
  const { patientId } = useParams();

  const [data, setData] = useState<PatientTimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeTimelineType, setActiveTimelineType] = useState('ALL');
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [showAllTaskHistory, setShowAllTaskHistory] = useState(false);
  const [cleaningTestData, setCleaningTestData] = useState(false);

  const [savingDiseaseProfile, setSavingDiseaseProfile] = useState(false);
  const [diseaseType, setDiseaseType] = useState('HYPERTENSION');
  const [diagnosisDate, setDiagnosisDate] = useState('');
  const [diseaseStage, setDiseaseStage] = useState('');
  const [complications, setComplications] = useState('');
  const [comorbidities, setComorbidities] = useState('');
  const [riskLevel, setRiskLevel] = useState('MEDIUM');
  const [diseaseDataSource, setDiseaseDataSource] = useState('NURSE_INPUT');

  const [savingVital, setSavingVital] = useState(false);
  const [vitalType, setVitalType] = useState('SYSTOLIC_BP');
  const [vitalValue, setVitalValue] = useState('');
  const [vitalUnit, setVitalUnit] = useState('mmHg');
  const [vitalMeasuredAt, setVitalMeasuredAt] = useState('');
  const [manualAbnormal, setManualAbnormal] = useState(false);
  const [vitalNote, setVitalNote] = useState('');

  const [savingTask, setSavingTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskType, setTaskType] = useState('FOLLOW_UP');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [processingActionId, setProcessingActionId] = useState<string | null>(null);

  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [followUpType, setFollowUpType] = useState('PHONE');
  const [content, setContent] = useState('');
  const [result, setResult] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [nextFollowUpTime, setNextFollowUpTime] = useState('');

  async function loadTimeline() {
    if (!patientId) return;

    setLoading(true);
    try {
      const res = await api.get(`/patients/${patientId}/timeline`);
      setData(res.data);
    } catch (err) {
      console.error(err);
      setError('患者档案加载失败，请确认后端服务是否正常运行。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTimeline();
  }, [patientId]);

  const visibleTimeline = useMemo(() => {
    if (!data) return [];

    if (showAllHistory) {
      return data.timeline;
    }

    return data.timeline.filter((item) => !isLowPriorityHistory(item));
  }, [data, showAllHistory]);

  const hiddenHistoryCount = useMemo(() => {
    if (!data) return 0;
    return data.timeline.filter((item) => isLowPriorityHistory(item)).length;
  }, [data]);

  const taskTimeline = useMemo(() => {
    if (!data) return [];
    return data.timeline.filter((item) => item.type === 'TASK');
  }, [data]);

  const visibleTaskTimeline = useMemo(() => {
    if (showAllTaskHistory) return taskTimeline;
    return taskTimeline.filter((item) => item.data?.status !== 'DONE' && item.data?.status !== 'CANCELED');
  }, [showAllTaskHistory, taskTimeline]);

  const hiddenTaskHistoryCount = useMemo(
    () => taskTimeline.filter((item) => item.data?.status === 'DONE' || item.data?.status === 'CANCELED').length,
    [taskTimeline],
  );

  const filteredTimeline = useMemo(() => {
    if (activeTimelineType === 'ALL') return visibleTimeline;
    return visibleTimeline.filter((item) => item.type === activeTimelineType);
  }, [activeTimelineType, visibleTimeline]);

  function countByType(type: string) {
    if (type === 'ALL') return visibleTimeline.length;
    return visibleTimeline.filter((item) => item.type === type).length;
  }

  function handleVitalTypeChange(nextType: string) {
    setVitalType(nextType);

    if (nextType === 'SYSTOLIC_BP' || nextType === 'DIASTOLIC_BP') {
      setVitalUnit('mmHg');
    } else if (nextType === 'BLOOD_GLUCOSE') {
      setVitalUnit('mmol/L');
    } else if (nextType === 'WEIGHT') {
      setVitalUnit('kg');
    } else if (nextType === 'HEART_RATE') {
      setVitalUnit('bpm');
    } else if (nextType === 'SPO2') {
      setVitalUnit('%');
    }
  }

  function resetNotice() {
    setMessage('');
    setError('');
  }

  async function submitDiseaseProfile(event: FormEvent) {
    event.preventDefault();
    if (!patientId) return;

    resetNotice();
    setSavingDiseaseProfile(true);

    try {
      await api.post(`/patients/${patientId}/disease-profiles`, {
        diseaseType,
        diagnosisDate: diagnosisDate ? new Date(diagnosisDate).toISOString() : undefined,
        diseaseStage,
        complications,
        comorbidities,
        riskLevel,
        dataSource: diseaseDataSource,
      });

      setDiseaseType('HYPERTENSION');
      setDiagnosisDate('');
      setDiseaseStage('');
      setComplications('');
      setComorbidities('');
      setRiskLevel('MEDIUM');
      setDiseaseDataSource('NURSE_INPUT');
      setMessage('慢病档案已保存。');
      setActiveTimelineType('DISEASE_PROFILE');

      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError('慢病档案保存失败，请检查必填项或稍后重试。');
    } finally {
      setSavingDiseaseProfile(false);
    }
  }

  async function submitVitalRecord(event: FormEvent) {
    event.preventDefault();
    if (!patientId) return;

    resetNotice();
    setSavingVital(true);

    try {
      const res = await api.post(`/patients/${patientId}/vital-records`, {
        type: vitalType,
        value: Number(vitalValue),
        unit: vitalUnit,
        measuredAt: toIsoDateTime(vitalMeasuredAt) ?? new Date().toISOString(),
        dataSource: 'NURSE_INPUT',
        isAbnormal: manualAbnormal,
        note: vitalNote,
      });

      setVitalValue('');
      setVitalMeasuredAt('');
      setManualAbnormal(false);
      setVitalNote('');
      if (res.data?.generatedRiskAlert && res.data?.generatedTask) {
        setMessage('健康指标已保存：系统已自动生成风险预警和护士待办任务。');
        setActiveTimelineType('RISK_ALERT');
      } else if (res.data?.generatedRiskAlert) {
        setMessage('健康指标已保存：系统已自动生成风险预警。');
        setActiveTimelineType('RISK_ALERT');
      } else {
        setMessage('健康指标已保存，本次未触发异常预警。');
        setActiveTimelineType('VITAL_RECORD');
      }

      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError('健康指标保存失败，请检查数值和单位。');
    } finally {
      setSavingVital(false);
    }
  }

  async function submitTask(event: FormEvent) {
    event.preventDefault();
    if (!patientId) return;

    resetNotice();
    setSavingTask(true);

    try {
      await api.post(`/patients/${patientId}/tasks`, {
        title: taskTitle,
        type: taskType,
        dueAt: toIsoDateTime(taskDueAt),
        assigneeId: nurseId,
      });

      setTaskTitle('');
      setTaskType('FOLLOW_UP');
      setTaskDueAt('');
      setMessage('待办任务已创建。');
      setActiveTimelineType('TASK');

      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError('任务创建失败，请稍后重试。');
    } finally {
      setSavingTask(false);
    }
  }

  async function handleRiskAlertAction(alertId: string, action: 'in-progress' | 'resolve' | 'dismiss') {
    resetNotice();
    setProcessingActionId(`risk-${alertId}-${action}`);

    try {
      await api.patch(`/risk-alerts/${alertId}/${action}`, {
        handledBy: nurseId,
        handlingNote:
          action === 'resolve'
            ? '护士已完成复核/随访处理。'
            : action === 'dismiss'
              ? '护士判断该预警暂不需要继续处理。'
              : '护士已开始处理该风险预警。',
      });

      setMessage(
        action === 'resolve'
          ? '风险预警已处理，关联待办任务已同步完成。'
          : action === 'dismiss'
            ? '风险预警已忽略，关联待办任务已同步取消。'
            : '风险预警已进入处理中，关联待办任务已同步更新。',
      );
      setActiveTimelineType('RISK_ALERT');
      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError('风险预警状态更新失败，请稍后重试。');
    } finally {
      setProcessingActionId(null);
    }
  }

  async function handleTaskStatus(taskId: string, status: 'IN_PROGRESS' | 'DONE' | 'CANCELED') {
    resetNotice();
    setProcessingActionId(`task-${taskId}-${status}`);

    try {
      await api.patch(`/tasks/${taskId}/status`, { status });
      setMessage(
        status === 'DONE'
          ? '待办任务已完成；如任务关联风险预警，预警也已同步处理。'
          : status === 'CANCELED'
            ? '待办任务已取消；如任务关联风险预警，预警也已同步忽略。'
            : '待办任务已进入处理中。',
      );
      setActiveTimelineType('TASK');
      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError('待办任务状态更新失败，请稍后重试。');
    } finally {
      setProcessingActionId(null);
    }
  }

  async function submitFollowUp(event: FormEvent) {
    event.preventDefault();
    if (!patientId) return;

    resetNotice();
    setSavingFollowUp(true);

    try {
      await api.post(`/patients/${patientId}/follow-ups`, {
        followUpType,
        followUpTime: new Date().toISOString(),
        content,
        result,
        suggestion,
        nextFollowUpTime: toIsoDateTime(nextFollowUpTime),
        operatorId: nurseId,
      });

      setContent('');
      setResult('');
      setSuggestion('');
      setNextFollowUpTime('');
      setMessage('随访记录已保存。');
      setActiveTimelineType('FOLLOW_UP');

      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError('随访记录保存失败，请稍后重试。');
    } finally {
      setSavingFollowUp(false);
    }
  }

  async function cleanupTestData() {
    if (!patientId) return;

    const confirmed = window.confirm(
      '确认清理当前患者的测试流水？这会删除健康指标、风险预警、任务和随访记录，但会保留患者主档案和慢病档案。',
    );

    if (!confirmed) return;

    resetNotice();
    setCleaningTestData(true);

    try {
      const res = await api.delete('/dev-tools/test-data', {
        params: { patientId },
      });

      setMessage(res.data?.message ?? '测试流水已清理。');
      setActiveTimelineType('ALL');
      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError('测试流水清理失败。请确认后端已启动，且 NODE_ENV 不是 production。');
    } finally {
      setCleaningTestData(false);
    }
  }

  if (loading && !data) {
    return <div className="loading-state">正在加载患者长期健康档案...</div>;
  }

  if (!data) {
    return <div className="empty-state">Patient not found</div>;
  }

  const { patient } = data;

  return (
    <div className="business-page patient-detail-page">
      <div className="page-header">
        <div>
          <Link className="action-link" to="/patients">← 返回患者档案</Link>
          <div className="page-kicker">PATIENT LONGITUDINAL RECORD</div>
          <h1>{patient.name}</h1>
          <p className="page-subtitle">
            院内 ID：{patient.hospitalPatientId ?? '-'} · 责任医生：{patient.responsibleDoctorId ?? '-'} · 责任护士：
            {patient.responsibleNurseId ?? '-'}
          </p>
        </div>
        <div className="patient-hero-actions">
          {import.meta.env.DEV && (
            <button
              className="danger-outline-button"
              type="button"
              onClick={cleanupTestData}
              disabled={cleaningTestData}
            >
              {cleaningTestData ? '清理中...' : '清理测试流水'}
            </button>
          )}
          <button className="secondary-btn" type="button" onClick={loadTimeline} disabled={loading}>
            {loading ? '刷新中...' : '刷新档案'}
          </button>
        </div>
      </div>

      {message && <div className="notice-success">{message}</div>}
      {error && <div className="notice-error">{error}</div>}

      <section className="panel patient-info-card">
        <div className="hospital-section-header">
          <div>
            <span>PATIENT MASTER INDEX</span>
            <h2>患者基本信息</h2>
          </div>
        </div>

        <div className="detail-grid patient-info-grid">
          <div><span className="label">院内 ID</span><strong>{patient.hospitalPatientId ?? '-'}</strong></div>
          <div><span className="label">性别</span><strong>{genderLabelMap[patient.gender] ?? patient.gender}</strong></div>
          <div><span className="label">出生日期</span><strong>{formatDate(patient.birthDate)}</strong></div>
          <div><span className="label">联系电话</span><strong>{patient.phone ?? '-'}</strong></div>
          <div><span className="label">责任医生</span><strong>{patient.responsibleDoctorId ?? '-'}</strong></div>
          <div><span className="label">责任护士</span><strong>{patient.responsibleNurseId ?? '-'}</strong></div>
        </div>
      </section>

      <section className="panel form-panel">
        <div className="hospital-section-header">
          <div>
            <span>CHRONIC DISEASE PROFILE</span>
            <h2>新增慢病档案</h2>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setDiseaseDataSource('EMR');
              setDiseaseStage('HIS/EMR 诊断同步预留：待接入医院诊断接口');
            }}
          >
            从 HIS/EMR 同步诊断
          </button>
        </div>

        <form className="hospital-form" onSubmit={submitDiseaseProfile}>
          <div className="form-grid">
            <div className="form-row">
              <label>疾病类型</label>
              <select value={diseaseType} onChange={(event) => setDiseaseType(event.target.value)}>
                <option value="HYPERTENSION">高血压</option>
                <option value="TYPE_2_DIABETES">2型糖尿病</option>
                <option value="COPD">慢阻肺</option>
                <option value="CORONARY_HEART_DISEASE">冠心病</option>
                <option value="HYPERLIPIDEMIA">高脂血症</option>
                <option value="OBESITY">肥胖</option>
                <option value="OTHER">其他</option>
              </select>
            </div>
            <div className="form-row">
              <label>风险等级</label>
              <select value={riskLevel} onChange={(event) => setRiskLevel(event.target.value)}>
                <option value="LOW">低危</option>
                <option value="MEDIUM">中危</option>
                <option value="HIGH">高危</option>
                <option value="VERY_HIGH">极高危</option>
              </select>
            </div>
            <div className="form-row">
              <label>确诊日期</label>
              <input type="date" value={diagnosisDate} onChange={(event) => setDiagnosisDate(event.target.value)} />
            </div>
            <div className="form-row">
              <label>数据来源</label>
              <select value={diseaseDataSource} onChange={(event) => setDiseaseDataSource(event.target.value)}>
                <option value="NURSE_INPUT">护士录入</option>
                <option value="HIS">HIS</option>
                <option value="EMR">EMR</option>
                <option value="MANUAL_IMPORT">人工导入</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <label>疾病分期 / 病情说明</label>
            <input value={diseaseStage} onChange={(event) => setDiseaseStage(event.target.value)} placeholder="例如：2级高血压、糖尿病病程 5 年" />
          </div>

          <div className="form-grid form-grid-two">
            <div className="form-row">
              <label>并发症</label>
              <textarea value={complications} onChange={(event) => setComplications(event.target.value)} placeholder="例如：糖尿病视网膜病变、肾功能异常等" />
            </div>
            <div className="form-row">
              <label>合并症</label>
              <textarea value={comorbidities} onChange={(event) => setComorbidities(event.target.value)} placeholder="例如：高脂血症、肥胖、冠心病" />
            </div>
          </div>

          <div className="form-actions">
            <button className="button" type="submit" disabled={savingDiseaseProfile}>
              {savingDiseaseProfile ? '保存中...' : '保存慢病档案'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel form-panel">
        <div className="hospital-section-header">
          <div>
            <span>VITAL SIGN RECORD</span>
            <h2>新增健康指标</h2>
          </div>
          <p className="section-hint">系统会按阈值自动判定异常并生成风险预警，通常无需手动勾选异常。</p>
        </div>

        <form className="hospital-form" onSubmit={submitVitalRecord}>
          <div className="form-grid">
            <div className="form-row">
              <label>指标类型</label>
              <select value={vitalType} onChange={(event) => handleVitalTypeChange(event.target.value)}>
                <option value="SYSTOLIC_BP">收缩压</option>
                <option value="DIASTOLIC_BP">舒张压</option>
                <option value="BLOOD_GLUCOSE">血糖</option>
                <option value="WEIGHT">体重</option>
                <option value="HEART_RATE">心率</option>
                <option value="SPO2">血氧</option>
              </select>
            </div>
            <div className="form-row">
              <label>数值</label>
              <input type="number" step="0.1" value={vitalValue} onChange={(event) => setVitalValue(event.target.value)} required />
            </div>
            <div className="form-row">
              <label>单位</label>
              <input value={vitalUnit} onChange={(event) => setVitalUnit(event.target.value)} required />
            </div>
            <div className="form-row">
              <label>测量时间</label>
              <input type="datetime-local" value={vitalMeasuredAt} onChange={(event) => setVitalMeasuredAt(event.target.value)} />
            </div>
          </div>

          <div className="form-row checkbox-row">
            <label>
              <input type="checkbox" checked={manualAbnormal} onChange={(event) => setManualAbnormal(event.target.checked)} />
              人工强制标记异常
            </label>
            <span className="auto-rule-note">自动规则：收缩压 ≥140、舒张压 ≥90、血糖 ≥7.0、血氧 &lt;95 等会自动标记异常并生成预警。</span>
          </div>

          <div className="form-row">
            <label>备注</label>
            <textarea value={vitalNote} onChange={(event) => setVitalNote(event.target.value)} placeholder="例如：门诊录入，患者自述近期血压偏高" />
          </div>

          <div className="form-actions">
            <button className="button" type="submit" disabled={savingVital}>
              {savingVital ? '保存中...' : '保存健康指标'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel form-panel">
        <div className="hospital-section-header">
          <div>
            <span>TASK MANAGEMENT</span>
            <h2>新增任务</h2>
          </div>
        </div>

        <form className="hospital-form" onSubmit={submitTask}>
          <div className="form-grid form-grid-three">
            <div className="form-row">
              <label>任务标题</label>
              <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="例如：明日电话随访患者血压情况" required />
            </div>
            <div className="form-row">
              <label>任务类型</label>
              <select value={taskType} onChange={(event) => setTaskType(event.target.value)}>
                <option value="FOLLOW_UP">随访任务</option>
                <option value="RISK_ALERT_FOLLOW_UP">风险预警处理</option>
                <option value="RECHECK_REMINDER">复查提醒</option>
                <option value="MEDICATION_REMINDER">用药提醒</option>
                <option value="LAB_TEST_REMINDER">检查提醒</option>
              </select>
            </div>
            <div className="form-row">
              <label>截止时间</label>
              <input type="datetime-local" value={taskDueAt} onChange={(event) => setTaskDueAt(event.target.value)} />
            </div>
          </div>

          <div className="form-actions">
            <button className="button" type="submit" disabled={savingTask}>
              {savingTask ? '保存中...' : '保存任务'}
            </button>
          </div>
        </form>

        <div className="task-inline-list">
          <div className="task-inline-list-header">
            <div>
              <h3>当前待办任务</h3>
              {!showAllTaskHistory && hiddenTaskHistoryCount > 0 && (
                <p className="muted small">已默认隐藏 {hiddenTaskHistoryCount} 条已完成或已取消任务。</p>
              )}
            </div>
            <label className="history-toggle task-history-toggle">
              <input
                type="checkbox"
                checked={showAllTaskHistory}
                onChange={(event) => setShowAllTaskHistory(event.target.checked)}
              />
              显示已完成/已取消任务
            </label>
          </div>

          {visibleTaskTimeline.length === 0 ? (
            <div className="empty-state task-empty-state">
              {taskTimeline.length === 0 ? '当前患者暂无待办任务。' : '当前没有未完成任务，打开右侧开关可查看历史任务。'}
            </div>
          ) : (
            <div className="task-inline-grid">
              {visibleTaskTimeline.map((item) => {
                const isTaskHistory = item.data?.status === 'DONE' || item.data?.status === 'CANCELED';

                return (
                  <article className={`task-inline-card${isTaskHistory ? ' task-inline-card-history' : ''}`} key={item.data?.id ?? `${item.time}-${item.title}`}>
                    <div className="task-inline-card-topline">
                      <span className="badge">{taskTypeLabelMap[item.data?.type] ?? item.data?.type ?? '任务'}</span>
                      <span className="task-status-chip">{statusLabelMap[item.data?.status] ?? item.data?.status}</span>
                    </div>
                    <h4>{item.title}</h4>
                    <p>{item.description}</p>
                    <div className="timeline-extra">
                      截止时间：{formatTime(item.data?.dueAt)}
                      {item.data?.relatedAlertId ? ' · 已关联风险预警' : ''}
                    </div>
                    {(item.data?.status === 'PENDING' || item.data?.status === 'IN_PROGRESS') && (
                      <div className="timeline-actions">
                        {item.data?.status === 'PENDING' && (
                          <button
                            className="timeline-action-button"
                            type="button"
                            disabled={processingActionId !== null}
                            onClick={() => handleTaskStatus(item.data.id, 'IN_PROGRESS')}
                          >
                            开始处理
                          </button>
                        )}
                        <button
                          className="timeline-action-button primary"
                          type="button"
                          disabled={processingActionId !== null}
                          onClick={() => handleTaskStatus(item.data.id, 'DONE')}
                        >
                          完成任务
                        </button>
                        <button
                          className="timeline-action-button danger"
                          type="button"
                          disabled={processingActionId !== null}
                          onClick={() => handleTaskStatus(item.data.id, 'CANCELED')}
                        >
                          取消任务
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="panel form-panel">
        <div className="hospital-section-header">
          <div>
            <span>FOLLOW-UP RECORD</span>
            <h2>新增随访记录</h2>
          </div>
        </div>

        <form className="hospital-form" onSubmit={submitFollowUp}>
          <div className="form-grid form-grid-two">
            <div className="form-row">
              <label>随访类型</label>
              <select value={followUpType} onChange={(event) => setFollowUpType(event.target.value)}>
                <option value="PHONE">电话随访</option>
                <option value="WECHAT">微信随访</option>
                <option value="OUTPATIENT">门诊随访</option>
                <option value="HOME_VISIT">上门随访</option>
              </select>
            </div>
            <div className="form-row">
              <label>下次随访时间</label>
              <input type="datetime-local" value={nextFollowUpTime} onChange={(event) => setNextFollowUpTime(event.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <label>随访内容</label>
            <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="例如：电话询问患者近期血压、用药和症状情况" required />
          </div>
          <div className="form-row">
            <label>随访结果</label>
            <textarea value={result} onChange={(event) => setResult(event.target.value)} placeholder="例如：患者复测后血压下降，无明显不适" />
          </div>
          <div className="form-row">
            <label>护理建议</label>
            <textarea value={suggestion} onChange={(event) => setSuggestion(event.target.value)} placeholder="例如：继续监测家庭血压，规律服药，异常时及时复诊" />
          </div>

          <div className="form-actions">
            <button className="button" type="submit" disabled={savingFollowUp}>
              {savingFollowUp ? '保存中...' : '保存随访记录'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel timeline-panel">
        <div className="hospital-section-header timeline-header">
          <div>
            <span>PATIENT FULL-PROCESS RECORD</span>
            <h2>患者全流程记录</h2>
            {!showAllHistory && hiddenHistoryCount > 0 && (
              <p className="muted small">已默认隐藏 {hiddenHistoryCount} 条已完成任务或已处理预警。</p>
            )}
          </div>
          <label className="history-toggle">
            <input
              type="checkbox"
              checked={showAllHistory}
              onChange={(event) => setShowAllHistory(event.target.checked)}
            />
            显示全部历史记录
          </label>
        </div>

        <div className="timeline-filter-tabs">
          {timelineTabs.map((type) => (
            <button
              key={type}
              type="button"
              className={activeTimelineType === type ? 'timeline-tab active' : 'timeline-tab'}
              onClick={() => setActiveTimelineType(type)}
            >
              {timelineTypeLabelMap[type]} <span>{countByType(type)}</span>
            </button>
          ))}
        </div>

        {filteredTimeline.length === 0 ? (
          <div className="empty-state">当前筛选下暂无记录。</div>
        ) : (
          <div className="timeline">
            {filteredTimeline.map((item, index) => (
              <div
                className={`timeline-item${isLowPriorityHistory(item) ? ' low-priority-history' : ''}`}
                key={`${item.type}-${item.time}-${index}`}
              >
                <div className="timeline-time">{formatTime(item.time)}</div>
                <div className={getTimelineCardClass(item.type)}>
                  <div className="timeline-card-topline">
                    <div className="badge">{timelineTypeLabelMap[item.type] ?? item.type}</div>
                    {isLowPriorityHistory(item) && <span className="history-status-pill">历史记录</span>}
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  {item.type === 'VITAL_RECORD' && (
                    <div className="timeline-extra">
                      指标：{vitalTypeLabelMap[item.data?.type] ?? item.data?.type} · 数据来源：
                      {dataSourceLabelMap[item.data?.dataSource] ?? item.data?.dataSource ?? '-'}
                    </div>
                  )}
                  {item.type === 'RISK_ALERT' && (
                    <div className="timeline-extra">
                      风险等级：{riskLabelMap[item.data?.riskLevel] ?? item.data?.riskLevel} · 状态：
                      {statusLabelMap[item.data?.status] ?? item.data?.status}
                      {item.data?.triggerRule ? ` · 触发规则：${item.data.triggerRule}` : ''}
                    </div>
                  )}
                  {item.type === 'RISK_ALERT' &&
                    (item.data?.status === 'OPEN' || item.data?.status === 'IN_PROGRESS') && (
                      <div className="timeline-actions">
                        {item.data?.status === 'OPEN' && (
                          <button
                            className="timeline-action-button"
                            type="button"
                            disabled={processingActionId !== null}
                            onClick={() => handleRiskAlertAction(item.data.id, 'in-progress')}
                          >
                            标记处理中
                          </button>
                        )}
                        <button
                          className="timeline-action-button primary"
                          type="button"
                          disabled={processingActionId !== null}
                          onClick={() => handleRiskAlertAction(item.data.id, 'resolve')}
                        >
                          已处理预警
                        </button>
                        <button
                          className="timeline-action-button danger"
                          type="button"
                          disabled={processingActionId !== null}
                          onClick={() => handleRiskAlertAction(item.data.id, 'dismiss')}
                        >
                          忽略/误报
                        </button>
                      </div>
                    )}
                  {item.type === 'TASK' && (
                    <div className="timeline-extra">
                      任务类型：{taskTypeLabelMap[item.data?.type] ?? item.data?.type} · 状态：
                      {statusLabelMap[item.data?.status] ?? item.data?.status}
                      {item.data?.relatedAlertId ? ' · 已关联风险预警' : ''}
                    </div>
                  )}
                  {item.type === 'TASK' &&
                    (item.data?.status === 'PENDING' || item.data?.status === 'IN_PROGRESS') && (
                      <div className="timeline-actions">
                        {item.data?.status === 'PENDING' && (
                          <button
                            className="timeline-action-button"
                            type="button"
                            disabled={processingActionId !== null}
                            onClick={() => handleTaskStatus(item.data.id, 'IN_PROGRESS')}
                          >
                            开始处理
                          </button>
                        )}
                        <button
                          className="timeline-action-button primary"
                          type="button"
                          disabled={processingActionId !== null}
                          onClick={() => handleTaskStatus(item.data.id, 'DONE')}
                        >
                          完成任务
                        </button>
                        <button
                          className="timeline-action-button danger"
                          type="button"
                          disabled={processingActionId !== null}
                          onClick={() => handleTaskStatus(item.data.id, 'CANCELED')}
                        >
                          取消任务
                        </button>
                      </div>
                    )}
                  {item.type === 'FOLLOW_UP' && (
                    <div className="timeline-extra">
                      随访方式：{followUpTypeLabelMap[item.data?.followUpType] ?? item.data?.followUpType}
                    </div>
                  )}
                  {item.type === 'DISEASE_PROFILE' && (
                    <div className="timeline-extra">
                      疾病：{diseaseLabelMap[item.data?.diseaseType] ?? item.data?.diseaseType} · 风险：
                      {riskLabelMap[item.data?.riskLevel] ?? item.data?.riskLevel} · 数据来源：
                      {dataSourceLabelMap[item.data?.dataSource] ?? item.data?.dataSource ?? '-'} · 确诊日期：
                      {formatDate(item.data?.diagnosisDate)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}




