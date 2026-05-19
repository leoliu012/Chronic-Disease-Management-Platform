import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, getApiErrorMessage } from '../api/client';

type Patient = {
  id: string;
  hospitalPatientId?: string;
  name: string;
  gender?: string;
  birthDate?: string;
  phone?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  responsibleDoctorId?: string;
  responsibleNurseId?: string;
};

type Task = {
  id: string;
  patientId: string;
  title: string;
  type: string;
  status: string;
  dueAt?: string;
  assigneeId?: string;
  relatedAlertId?: string;
  createdAt?: string;
  patient?: Patient;
};

type TimelineEvent = {
  type: string;
  time: string;
  title: string;
  description?: string;
  data: any;
};

type PatientTimelineResponse = {
  patient: Patient;
  timeline: TimelineEvent[];
};

type HandlingMode = 'PHONE' | 'RECHECK' | 'PLAN' | 'CLOSE';

type VitalMonitoringPlanDraft = {
  vitalType: string;
  displayName: string;
  unit: string;
  frequencyUnit: string;
  timesPerUnit: string;
  customMeasureTimes: string;
  customMeasureDays: string;
  evidenceBasis: string;
};

const nurseId = 'nurse-001';

const taskTypeLabelMap: Record<string, string> = {
  FOLLOW_UP: '随访任务',
  RISK_ALERT_FOLLOW_UP: '风险随访任务',
  RECHECK_REMINDER: '复测提醒',
  MEDICATION_REMINDER: '用药提醒',
  MEDICATION_ADHERENCE_FOLLOW_UP: '用药依从性随访',
  VITAL_MEASUREMENT_MISSED: '指标漏测复核',
  QUESTIONNAIRE_REVIEW: '问卷复核',
  LAB_TEST_REMINDER: '检查提醒',
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

const riskLabelMap: Record<string, string> = {
  LOW: '低危',
  MEDIUM: '中危',
  HIGH: '高危',
  VERY_HIGH: '极高危',
};

const vitalTypeLabelMap: Record<string, string> = {
  BLOOD_PRESSURE: '血压（收缩压/舒张压）',
  SYSTOLIC_BP: '收缩压',
  DIASTOLIC_BP: '舒张压',
  BLOOD_GLUCOSE: '血糖',
  WEIGHT: '体重',
  HEART_RATE: '心率',
  SPO2: '血氧',
  LDL_C: '低密度脂蛋白胆固醇',
};

const vitalUnitMap: Record<string, string> = {
  BLOOD_PRESSURE: 'mmHg',
  SYSTOLIC_BP: 'mmHg',
  DIASTOLIC_BP: 'mmHg',
  BLOOD_GLUCOSE: 'mmol/L',
  WEIGHT: 'kg',
  HEART_RATE: 'bpm',
  SPO2: '%',
  LDL_C: 'mmol/L',
};

function normalizeHandlingMode(value: string | null): HandlingMode | null {
  const normalized = String(value ?? '').toUpperCase();
  return normalized === 'PHONE' || normalized === 'RECHECK' || normalized === 'PLAN' || normalized === 'CLOSE'
    ? normalized
    : null;
}

const defaultPlanDraft: VitalMonitoringPlanDraft = {
  vitalType: 'BLOOD_PRESSURE',
  displayName: '血压（收缩压/舒张压）',
  unit: 'mmHg',
  frequencyUnit: 'DAY',
  timesPerUnit: '2',
  customMeasureTimes: '07:30, 19:30',
  customMeasureDays: '',
  evidenceBasis: '',
};

function formatTime(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function maskPhone(value?: string) {
  if (!value || value.length < 7) return value ?? '-';
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function getStatusClass(status?: string) {
  return `status-badge status-${String(status || '').toLowerCase().replace(/_/g, '-')}`;
}

function getRiskClass(riskLevel?: string) {
  return `risk-badge risk-${String(riskLevel || '').toLowerCase().replace(/_/g, '-')}`;
}

function localizeBackendText(value?: string) {
  if (!value) return '-';
  return value
    .replace(/Patient not found/g, '未找到患者')
    .replace(/Task not found/g, '未找到任务')
    .replace(/Risk Alert/g, '风险预警');
}

function parseTimeList(value: string) {
  return Array.from(new Set(value.split(/[，,\s]+/).map((item) => item.trim()).filter(Boolean)));
}

function parseDayList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[，,\s]+/)
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item >= 1),
    ),
  );
}

function normalizePlanDraft(plan: any): VitalMonitoringPlanDraft {
  return {
    vitalType: plan?.vitalType ?? defaultPlanDraft.vitalType,
    displayName: plan?.displayName ?? vitalTypeLabelMap[plan?.vitalType] ?? defaultPlanDraft.displayName,
    unit: plan?.unit ?? vitalUnitMap[plan?.vitalType] ?? defaultPlanDraft.unit,
    frequencyUnit: plan?.frequencyUnit ?? defaultPlanDraft.frequencyUnit,
    timesPerUnit: String(plan?.timesPerUnit ?? defaultPlanDraft.timesPerUnit),
    customMeasureTimes: Array.isArray(plan?.customMeasureTimes) ? plan.customMeasureTimes.join(', ') : defaultPlanDraft.customMeasureTimes,
    customMeasureDays: Array.isArray(plan?.customMeasureDays) ? plan.customMeasureDays.join(', ') : '',
    evidenceBasis: plan?.evidenceBasis ?? '',
  };
}

function isOpenTask(task: Task) {
  return task.status === 'PENDING' || task.status === 'IN_PROGRESS';
}

export function PatientTaskProcessingPage() {
  const { patientId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const selectedTaskId = searchParams.get('taskId') ?? '';
  const requestedMode = normalizeHandlingMode(searchParams.get('mode'));

  const [patient, setPatient] = useState<Patient | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<HandlingMode>(requestedMode ?? 'PHONE');

  const [callOutcome, setCallOutcome] = useState('CONTACTED');
  const [callContent, setCallContent] = useState('');
  const [followUpResult, setFollowUpResult] = useState('');
  const [nursingAdvice, setNursingAdvice] = useState('');
  const [nextFollowUpTime, setNextFollowUpTime] = useState('');
  const [signature, setSignature] = useState('');
  const [completeTaskAfterSubmit, setCompleteTaskAfterSubmit] = useState(true);
  const [syncRelatedAlert, setSyncRelatedAlert] = useState(false);
  const [relatedAlertHandlingNote, setRelatedAlertHandlingNote] = useState('');

  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [planDraft, setPlanDraft] = useState<VitalMonitoringPlanDraft>(defaultPlanDraft);
  const [recheckTitle, setRecheckTitle] = useState('');
  const [recheckDueAt, setRecheckDueAt] = useState('');
  const [recheckNote, setRecheckNote] = useState('');
  const [closeStatus, setCloseStatus] = useState<'DONE' | 'CANCELED'>('DONE');
  const [closeNote, setCloseNote] = useState('');
  const [closeSyncAlert, setCloseSyncAlert] = useState(true);

  async function loadPage() {
    if (!patientId) return;
    setLoading(true);
    setError('');

    try {
      const [timelineRes, tasksRes] = await Promise.all([
        api.get(`/patients/${patientId}/timeline`),
        api.get(`/patients/${patientId}/tasks`),
      ]);

      const timelineData = timelineRes.data as PatientTimelineResponse;
      const taskData = tasksRes.data as Task[];
      setPatient(timelineData.patient);
      setTimeline(timelineData.timeline ?? []);
      setTasks(taskData ?? []);
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '任务处理页加载失败，请确认后端服务和患者数据。'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage();
  }, [patientId]);

  useEffect(() => {
    if (!requestedMode) return;
    setMode(requestedMode);
  }, [requestedMode]);

  const openTasks = useMemo(() => tasks.filter(isOpenTask), [tasks]);
  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const aOpen = isOpenTask(a) ? 0 : 1;
      const bOpen = isOpenTask(b) ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;
      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    });
  }, [tasks]);

  const selectedTask = useMemo(() => {
    return tasks.find((task) => task.id === selectedTaskId) ?? openTasks[0] ?? tasks[0] ?? null;
  }, [openTasks, selectedTaskId, tasks]);

  useEffect(() => {
    if (!selectedTask || selectedTaskId === selectedTask.id) return;
    const next = new URLSearchParams(searchParams);
    next.set('taskId', selectedTask.id);
    next.set('mode', mode.toLowerCase());
    setSearchParams(next, { replace: true });
  }, [mode, searchParams, selectedTask, selectedTaskId, setSearchParams]);

  const relatedAlert = useMemo(() => {
    if (!selectedTask?.relatedAlertId) return null;
    return timeline.find((item) => item.type === 'RISK_ALERT' && item.data?.id === selectedTask.relatedAlertId) ?? null;
  }, [selectedTask, timeline]);

  const recentVitals = useMemo(() => timeline.filter((item) => item.type === 'VITAL_RECORD').slice(0, 8), [timeline]);
  const monitoringPlans = useMemo(() => timeline.filter((item) => item.type === 'VITAL_MONITORING_PLAN'), [timeline]);
  const activeMonitoringPlans = useMemo(() => monitoringPlans.filter((item) => item.data?.isActive !== false), [monitoringPlans]);
  const followUps = useMemo(() => timeline.filter((item) => item.type === 'FOLLOW_UP').slice(0, 5), [timeline]);

  useEffect(() => {
    if (!selectedTask) return;
    setCallContent(`围绕待办事项“${selectedTask.title}”电话联系患者，核对症状、用药、复测和复诊情况。`);
    setFollowUpResult('已电话联系，待补充患者反馈。');
    setNursingAdvice('请患者按要求复测/用药/复诊，如出现危险症状及时就医。');
    setRecheckTitle(`复测提醒：${selectedTask.title.replace(/^风险随访任务：/, '')}`);
    setRelatedAlertHandlingNote(selectedTask.relatedAlertId ? '已通过统一任务处理页完成电话随访，并同步处置关联风险预警。' : '');
    setSyncRelatedAlert(Boolean(selectedTask.relatedAlertId));
    setCloseSyncAlert(Boolean(selectedTask.relatedAlertId));
  }, [selectedTask?.id]);

  useEffect(() => {
    const firstPlan = activeMonitoringPlans[0]?.data;
    if (!selectedPlanId && firstPlan?.id) {
      setSelectedPlanId(firstPlan.id);
      setPlanDraft(normalizePlanDraft(firstPlan));
    }
  }, [activeMonitoringPlans, selectedPlanId]);

  function selectTask(taskId: string) {
    const next = new URLSearchParams(searchParams);
    next.set('taskId', taskId);
    next.set('mode', mode.toLowerCase());
    setSearchParams(next);
  }

  function changeMode(nextMode: HandlingMode) {
    setMode(nextMode);
    const next = new URLSearchParams(searchParams);
    if (selectedTask?.id) next.set('taskId', selectedTask.id);
    next.set('mode', nextMode.toLowerCase());
    setSearchParams(next, { replace: true });
  }

  function choosePlan(planId: string) {
    setSelectedPlanId(planId);
    const plan = monitoringPlans.find((item) => item.data?.id === planId)?.data;
    setPlanDraft(normalizePlanDraft(plan));
  }

  function updatePlanDraft<K extends keyof VitalMonitoringPlanDraft>(key: K, value: VitalMonitoringPlanDraft[K]) {
    setPlanDraft((current) => ({ ...current, [key]: value }));
  }

  function updatePlanVitalType(vitalType: string) {
    setPlanDraft((current) => ({
      ...current,
      vitalType,
      displayName: vitalTypeLabelMap[vitalType] ?? current.displayName,
      unit: vitalUnitMap[vitalType] ?? current.unit,
    }));
  }

  async function submitPhoneFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patientId || !selectedTask || submitting) return;

    const trimmedSignature = signature.trim();
    if (!trimmedSignature) {
      setError('请填写电子签名后再提交电话随访记录。');
      return;
    }
    if (completeTaskAfterSubmit && syncRelatedAlert && selectedTask.relatedAlertId && !relatedAlertHandlingNote.trim()) {
      setError('已选择同步处置关联预警，请填写预警处置记录。');
      return;
    }

    setSubmitting(true);
    setMessage('');
    setError('');

    try {
      const outcomeLabel = callOutcome === 'CONTACTED'
        ? '已接通'
        : callOutcome === 'NO_ANSWER'
          ? '未接通'
          : callOutcome === 'FAMILY_CONTACTED'
            ? '已联系家属'
            : '需再次联系';

      await api.post(`/patients/${patientId}/follow-ups`, {
        followUpType: 'PHONE',
        followUpTime: new Date().toISOString(),
        content: [
          `统一任务处理：${selectedTask.title}`,
          `联系结果：${outcomeLabel}`,
          callContent.trim(),
          relatedAlert ? `关联预警：${localizeBackendText(relatedAlert.title)}` : '',
          `电子签名：${trimmedSignature}`,
        ].filter(Boolean).join('；'),
        result: followUpResult.trim() || outcomeLabel,
        suggestion: nursingAdvice.trim() || undefined,
        nextFollowUpTime: nextFollowUpTime ? new Date(nextFollowUpTime).toISOString() : undefined,
        operatorId: nurseId,
      });

      if (completeTaskAfterSubmit) {
        await api.patch(`/tasks/${selectedTask.id}/status`, {
          status: 'DONE',
          syncRelatedAlert: syncRelatedAlert && Boolean(selectedTask.relatedAlertId),
          relatedAlertHandlingNote: syncRelatedAlert && selectedTask.relatedAlertId
            ? [`处置记录：${relatedAlertHandlingNote.trim()}`, `电子签名：${trimmedSignature}`].join('；')
            : undefined,
        });
      }

      setMessage(completeTaskAfterSubmit ? '电话随访已保存，当前任务已完成。' : '电话随访已保存，当前任务状态未变更。');
      await loadPage();
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '电话随访提交失败，请稍后重试。'));
    } finally {
      setSubmitting(false);
    }
  }

  async function createRecheckTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patientId || !selectedTask || submitting) return;
    if (!recheckTitle.trim()) {
      setError('请填写复测任务标题。');
      return;
    }

    setSubmitting(true);
    setMessage('');
    setError('');

    try {
      await api.post(`/patients/${patientId}/tasks`, {
        title: recheckTitle.trim(),
        type: 'RECHECK_REMINDER',
        dueAt: recheckDueAt ? new Date(recheckDueAt).toISOString() : undefined,
        assigneeId: nurseId,
        relatedAlertId: selectedTask.relatedAlertId || undefined,
      });

      if (recheckNote.trim()) {
        await api.post(`/patients/${patientId}/follow-ups`, {
          followUpType: 'WECHAT',
          followUpTime: new Date().toISOString(),
          content: `新增复测任务：${recheckTitle.trim()}；${recheckNote.trim()}`,
          result: '已安排复测任务。',
          suggestion: recheckNote.trim(),
          operatorId: nurseId,
        });
      }

      setMessage('复测任务已新增，可在当前任务处理页继续电话沟通或完成原任务。');
      await loadPage();
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '新增复测任务失败，请稍后重试。'));
    } finally {
      setSubmitting(false);
    }
  }

  async function updateMonitoringPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPlanId || submitting) return;

    setSubmitting(true);
    setMessage('');
    setError('');

    try {
      await api.patch(`/vital-monitoring-plans/${selectedPlanId}`, {
        vitalType: planDraft.vitalType,
        displayName: planDraft.displayName,
        unit: planDraft.unit,
        frequencyUnit: planDraft.frequencyUnit,
        timesPerUnit: Number(planDraft.timesPerUnit),
        customMeasureTimes: parseTimeList(planDraft.customMeasureTimes),
        customMeasureDays: planDraft.frequencyUnit === 'DAY' ? [] : parseDayList(planDraft.customMeasureDays),
        evidenceBasis: planDraft.evidenceBasis || undefined,
        evidenceSource: planDraft.evidenceBasis ? '护士任务处理页调整' : undefined,
      });
      setMessage('指标监测计划已更新。');
      await loadPage();
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '监测计划更新失败，请稍后重试。'));
    } finally {
      setSubmitting(false);
    }
  }

  async function deactivateMonitoringPlan() {
    if (!selectedPlanId || submitting) return;
    if (!window.confirm('确认停用该指标监测计划？停用后患者端不再按该计划提醒。')) return;

    setSubmitting(true);
    setMessage('');
    setError('');

    try {
      await api.delete(`/vital-monitoring-plans/${selectedPlanId}`);
      setMessage('指标监测计划已停用。');
      setSelectedPlanId('');
      setPlanDraft(defaultPlanDraft);
      await loadPage();
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '停用监测计划失败，请稍后重试。'));
    } finally {
      setSubmitting(false);
    }
  }

  async function closeTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTask || submitting) return;
    if (!closeNote.trim()) {
      setError('请填写任务处理记录。');
      return;
    }

    setSubmitting(true);
    setMessage('');
    setError('');

    try {
      await api.patch(`/tasks/${selectedTask.id}/status`, {
        status: closeStatus,
        syncRelatedAlert: closeSyncAlert && Boolean(selectedTask.relatedAlertId),
        relatedAlertHandlingNote: closeNote.trim(),
      });
      setMessage(closeStatus === 'DONE' ? '任务已完成。' : '任务已取消，并已按选择同步处理关联预警。');
      await loadPage();
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '任务状态更新失败，请稍后重试。'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !patient) {
    return <div className="loading-state">正在加载患者任务处理页...</div>;
  }

  if (!patient) {
    return (
      <div className="business-page patient-task-processing-page">
        <div className="empty-state">患者任务处理页加载失败。</div>
        <button className="secondary-btn" type="button" onClick={() => navigate('/nurse-dashboard')}>返回护士工作台</button>
      </div>
    );
  }

  return (
    <div className="business-page patient-task-processing-page">
      <div className="page-header clean-page-header task-processing-hero">
        <div>
          <div className="page-kicker">患者详情 / 任务处理</div>
          <h1>统一任务处理页</h1>
          <p className="page-subtitle">任务、风险预警和随访记录统一在患者详情下处理。先选择任务，再选择处理方式；不同方式展开对应的医院业务表格和信息区。</p>
        </div>
        <div className="task-processing-header-actions">
          <Link className="secondary-btn" to="/nurse-dashboard">返回护士工作台</Link>
          <Link className="secondary-btn" to={`/patients/${patient.id}`}>返回患者详情</Link>
        </div>
      </div>

      {message && <div className="notice-success operation-inline-success" role="status">{message}</div>}
      {error && <div className="notice-error operation-inline-error" role="alert">{error}</div>}

      <section className="task-processing-patient-strip panel">
        <div className="task-processing-patient-main">
          <span>当前患者</span>
          <strong>{patient.name}</strong>
          <p>院内号：{patient.hospitalPatientId ?? '-'} · 电话：{maskPhone(patient.phone)} · 责任护士：{patient.responsibleNurseId ?? '-'}</p>
        </div>
        <div className="task-processing-patient-meta">
          <div><span>待处理任务</span><strong>{openTasks.length}</strong></div>
          <div><span>最近指标</span><strong>{recentVitals.length}</strong></div>
          <div><span>随访记录</span><strong>{followUps.length}</strong></div>
        </div>
      </section>

      <div className="task-processing-layout">
        <aside className="task-processing-sidebar panel">
          <div className="hospital-section-header compact-header">
            <div>
              <span>任务队列</span>
              <h2>选择需要处理的任务</h2>
            </div>
          </div>

          {sortedTasks.length === 0 ? (
            <div className="empty-state compact-empty">当前患者暂无任务。</div>
          ) : (
            <div className="task-processing-task-list">
              {sortedTasks.map((task) => {
                const isSelected = selectedTask?.id === task.id;
                return (
                  <button key={task.id} type="button" className={isSelected ? 'task-processing-task-card active' : 'task-processing-task-card'} onClick={() => selectTask(task.id)}>
                    <span className="badge">{taskTypeLabelMap[task.type] ?? task.type}</span>
                    <strong>{task.title}</strong>
                    <small>截止：{formatTime(task.dueAt)}</small>
                    <em className={getStatusClass(task.status)}>{statusLabelMap[task.status] ?? task.status}</em>
                    {task.relatedAlertId && <small className="task-related-alert-hint">已关联风险预警</small>}
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <main className="task-processing-main">
          {!selectedTask ? (
            <section className="panel"><div className="empty-state">请选择一个任务后继续处理。</div></section>
          ) : (
            <>
              <section className="panel selected-task-overview-card">
                <div className="hospital-section-header compact-header">
                  <div>
                    <span>当前处理任务</span>
                    <h2>{selectedTask.title}</h2>
                    <p className="section-hint">{taskTypeLabelMap[selectedTask.type] ?? selectedTask.type} · {statusLabelMap[selectedTask.status] ?? selectedTask.status} · 截止 {formatTime(selectedTask.dueAt)}</p>
                  </div>
                  <span className={getStatusClass(selectedTask.status)}>{statusLabelMap[selectedTask.status] ?? selectedTask.status}</span>
                </div>

                {relatedAlert && (
                  <div className="selected-task-alert-box">
                    <span className={getRiskClass(relatedAlert.data?.riskLevel)}>{riskLabelMap[relatedAlert.data?.riskLevel] ?? relatedAlert.data?.riskLevel}</span>
                    <div>
                      <strong>{localizeBackendText(relatedAlert.title)}</strong>
                      <p>{localizeBackendText(relatedAlert.description)} {relatedAlert.data?.triggerRule ? `触发依据：${relatedAlert.data.triggerRule}` : ''}</p>
                    </div>
                  </div>
                )}
              </section>

              <section className="panel task-processing-mode-card">
                <div className="hospital-section-header compact-header">
                  <div>
                    <span>处理方式</span>
                    <h2>选择本次处理动作</h2>
                    <p className="section-hint">选中后展开相应表格；电话沟通、复测任务、指标计划调整和任务关闭都在同一页完成。</p>
                  </div>
                </div>
                <div className="task-processing-mode-grid" role="tablist" aria-label="任务处理方式">
                  <button type="button" className={mode === 'PHONE' ? 'active' : ''} onClick={() => changeMode('PHONE')}>
                    <strong>电话随访沟通</strong><span>展开电话随访详情页内容</span>
                  </button>
                  <button type="button" className={mode === 'RECHECK' ? 'active' : ''} onClick={() => changeMode('RECHECK')}>
                    <strong>新增复测任务</strong><span>查看指标数据并安排复测</span>
                  </button>
                  <button type="button" className={mode === 'PLAN' ? 'active' : ''} onClick={() => changeMode('PLAN')}>
                    <strong>调整监测计划</strong><span>修改 / 停用指标打卡计划</span>
                  </button>
                  <button type="button" className={mode === 'CLOSE' ? 'active' : ''} onClick={() => changeMode('CLOSE')}>
                    <strong>完成或取消任务</strong><span>仅更新任务和关联预警状态</span>
                  </button>
                </div>
              </section>

              {mode === 'PHONE' && (
                <section className="panel task-call-form-card task-processing-action-panel">
                  <div className="hospital-section-header compact-header">
                    <div>
                      <span>电话随访记录</span>
                      <h2>电话随访沟通</h2>
                      <p className="section-hint">该区域沿用电话随访详情页的处理逻辑：先联系患者，再记录沟通内容，最后可同步完成任务和关联预警。</p>
                    </div>
                  </div>

                  <form className="hospital-form task-follow-up-form" onSubmit={submitPhoneFollowUp} aria-busy={submitting}>
                    <div className="task-call-two-column-grid">
                      <div className="task-call-contact-card embedded-contact-card">
                        <h3>患者联系信息</h3>
                        <dl className="contact-info-list">
                          <div><dt>患者姓名</dt><dd>{patient.name}</dd></div>
                          <div><dt>院内号</dt><dd>{patient.hospitalPatientId ?? '-'}</dd></div>
                          <div><dt>联系电话</dt><dd><a href={patient.phone ? `tel:${patient.phone}` : undefined}>{maskPhone(patient.phone)}</a></dd></div>
                          <div><dt>住址</dt><dd>{patient.address ?? '-'}</dd></div>
                          <div><dt>紧急联系人</dt><dd>{patient.emergencyContactName ?? '-'} {patient.emergencyContactPhone ? ` / ${maskPhone(patient.emergencyContactPhone)}` : ''}</dd></div>
                        </dl>
                      </div>

                      <div className="task-call-form-fields">
                        <div className="form-grid form-grid-two">
                          <div className="form-row">
                            <label>联系结果</label>
                            <select value={callOutcome} onChange={(event) => setCallOutcome(event.target.value)}>
                              <option value="CONTACTED">已接通本人</option>
                              <option value="FAMILY_CONTACTED">已联系家属</option>
                              <option value="NO_ANSWER">未接通</option>
                              <option value="CALL_BACK">需再次联系</option>
                            </select>
                          </div>
                          <div className="form-row">
                            <label>下次随访时间</label>
                            <input type="datetime-local" value={nextFollowUpTime} onChange={(event) => setNextFollowUpTime(event.target.value)} />
                          </div>
                        </div>
                        <div className="form-row">
                          <label>电话沟通内容</label>
                          <textarea value={callContent} onChange={(event) => setCallContent(event.target.value)} rows={4} />
                        </div>
                        <div className="form-row">
                          <label>患者反馈 / 随访结果</label>
                          <textarea value={followUpResult} onChange={(event) => setFollowUpResult(event.target.value)} rows={3} />
                        </div>
                        <div className="form-row">
                          <label>护理建议 / 医嘱转述</label>
                          <textarea value={nursingAdvice} onChange={(event) => setNursingAdvice(event.target.value)} rows={3} />
                        </div>
                      </div>
                    </div>

                    <div className="task-processing-sync-box">
                      <label><input type="checkbox" checked={completeTaskAfterSubmit} onChange={(event) => setCompleteTaskAfterSubmit(event.target.checked)} /> 保存随访后完成当前任务</label>
                      {selectedTask.relatedAlertId && (
                        <label><input type="checkbox" checked={syncRelatedAlert} onChange={(event) => setSyncRelatedAlert(event.target.checked)} /> 同步处置关联风险预警</label>
                      )}
                    </div>

                    {syncRelatedAlert && selectedTask.relatedAlertId && (
                      <div className="form-row">
                        <label>关联预警处置记录</label>
                        <textarea value={relatedAlertHandlingNote} onChange={(event) => setRelatedAlertHandlingNote(event.target.value)} rows={3} />
                      </div>
                    )}

                    <div className="form-row signature-row">
                      <label>电子签名</label>
                      <input value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="请输入护士姓名 / 工号" />
                    </div>

                    <div className="form-actions">
                      <button className="button" type="submit" disabled={submitting}>{submitting ? '提交中...' : '保存电话随访'}</button>
                      <span className="operation-form-hint">保存后会写入患者随访记录；如勾选完成任务，会同步更新任务状态。</span>
                    </div>
                  </form>
                </section>
              )}

              {mode === 'RECHECK' && (
                <section className="panel task-processing-action-panel">
                  <div className="hospital-section-header compact-header">
                    <div>
                      <span>指标复测</span>
                      <h2>新增复测任务</h2>
                      <p className="section-hint">先查看患者最近指标和当前监测计划，再创建复测提醒任务。</p>
                    </div>
                  </div>

                  <div className="recheck-grid">
                    <section className="clean-subpanel">
                      <h3>最近指标记录</h3>
                      {recentVitals.length === 0 ? <div className="empty-state compact-empty">暂无指标记录</div> : (
                        <div className="table-wrap clean-table-wrap">
                          <table className="table clean-hospital-table">
                            <thead><tr><th>指标</th><th>数值</th><th>时间</th><th>状态</th></tr></thead>
                            <tbody>
                              {recentVitals.map((item) => (
                                <tr key={`${item.type}-${item.time}-${item.data?.id ?? item.title}`}>
                                  <td>{vitalTypeLabelMap[item.data?.type] ?? item.data?.type}</td>
                                  <td><strong>{item.data?.value} {item.data?.unit}</strong></td>
                                  <td>{formatTime(item.time)}</td>
                                  <td>{item.data?.isAbnormal ? <span className="risk-badge risk-high">异常</span> : <span className="status-badge status-done">正常</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>

                    <section className="clean-subpanel">
                      <h3>新增复测任务</h3>
                      <form className="hospital-form" onSubmit={createRecheckTask} aria-busy={submitting}>
                        <div className="form-row"><label>复测任务标题</label><input value={recheckTitle} onChange={(event) => setRecheckTitle(event.target.value)} required /></div>
                        <div className="form-row"><label>截止时间</label><input type="datetime-local" value={recheckDueAt} onChange={(event) => setRecheckDueAt(event.target.value)} /></div>
                        <div className="form-row"><label>复测说明</label><textarea value={recheckNote} onChange={(event) => setRecheckNote(event.target.value)} rows={4} placeholder="例如：请患者今晚 19:30 复测血压并通过小程序上传。" /></div>
                        <div className="form-actions"><button className="button" type="submit" disabled={submitting}>{submitting ? '创建中...' : '创建复测任务'}</button></div>
                      </form>
                    </section>
                  </div>
                </section>
              )}

              {mode === 'PLAN' && (
                <section className="panel task-processing-action-panel">
                  <div className="hospital-section-header compact-header">
                    <div>
                      <span>指标监测计划</span>
                      <h2>修改 / 停用监测计划</h2>
                      <p className="section-hint">这里复用指标监测页的计划字段，用于在任务处理时直接调整患者端打卡提醒。</p>
                    </div>
                  </div>

                  <div className="plan-editor-layout">
                    <aside className="plan-selector-list">
                      <h3>当前启用计划</h3>
                      {activeMonitoringPlans.length === 0 ? <div className="empty-state compact-empty">暂无启用中的监测计划。</div> : activeMonitoringPlans.map((item) => (
                        <button key={item.data?.id} type="button" className={selectedPlanId === item.data?.id ? 'plan-selector-card active' : 'plan-selector-card'} onClick={() => choosePlan(item.data?.id)}>
                          <strong>{item.data?.displayName ?? vitalTypeLabelMap[item.data?.vitalType] ?? item.data?.vitalType}</strong>
                          <span>{item.data?.timesPerUnit ?? 1} 次 / {item.data?.frequencyUnit === 'DAY' ? '日' : item.data?.frequencyUnit === 'WEEK' ? '周' : '月'}</span>
                          <small>{Array.isArray(item.data?.customMeasureTimes) ? item.data.customMeasureTimes.join('、') : '-'}</small>
                        </button>
                      ))}
                    </aside>

                    <form className="hospital-form monitoring-plan-form" onSubmit={updateMonitoringPlan} aria-busy={submitting}>
                      <div className="form-grid form-grid-three">
                        <div className="form-row">
                          <label>指标类型</label>
                          <select value={planDraft.vitalType} onChange={(event) => updatePlanVitalType(event.target.value)}>
                            {Object.entries(vitalTypeLabelMap).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                        </div>
                        <div className="form-row"><label>显示名称</label><input value={planDraft.displayName} onChange={(event) => updatePlanDraft('displayName', event.target.value)} required /></div>
                        <div className="form-row"><label>单位</label><input value={planDraft.unit} onChange={(event) => updatePlanDraft('unit', event.target.value)} required /></div>
                        <div className="form-row">
                          <label>频率单位</label>
                          <select value={planDraft.frequencyUnit} onChange={(event) => updatePlanDraft('frequencyUnit', event.target.value)}>
                            <option value="DAY">每日</option>
                            <option value="WEEK">每周</option>
                            <option value="MONTH">每月</option>
                          </select>
                        </div>
                        <div className="form-row"><label>每单位次数</label><input type="number" min="1" max="12" value={planDraft.timesPerUnit} onChange={(event) => updatePlanDraft('timesPerUnit', event.target.value)} required /></div>
                        <div className="form-row"><label>测量时间</label><input value={planDraft.customMeasureTimes} onChange={(event) => updatePlanDraft('customMeasureTimes', event.target.value)} placeholder="07:30, 19:30" /></div>
                        <div className="form-row"><label>周/月日期</label><input value={planDraft.customMeasureDays} onChange={(event) => updatePlanDraft('customMeasureDays', event.target.value)} placeholder="每周 1-7；每月 1-31" disabled={planDraft.frequencyUnit === 'DAY'} /></div>
                      </div>
                      <div className="form-row"><label>调整依据</label><textarea value={planDraft.evidenceBasis} onChange={(event) => updatePlanDraft('evidenceBasis', event.target.value)} rows={3} /></div>
                      <div className="form-actions">
                        <button className="button" type="submit" disabled={!selectedPlanId || submitting}>{submitting ? '保存中...' : '保存计划调整'}</button>
                        <button className="secondary-button" type="button" disabled={!selectedPlanId || submitting} onClick={deactivateMonitoringPlan}>停用该计划</button>
                        <span className="operation-form-hint">保存后会影响患者端后续打卡提醒。</span>
                      </div>
                    </form>
                  </div>
                </section>
              )}

              {mode === 'CLOSE' && (
                <section className="panel task-processing-action-panel">
                  <div className="hospital-section-header compact-header">
                    <div>
                      <span>任务状态</span>
                      <h2>完成或取消当前任务</h2>
                      <p className="section-hint">适用于已通过其他方式处理完成，或确认任务无需继续执行的场景。</p>
                    </div>
                  </div>
                  <form className="hospital-form" onSubmit={closeTask} aria-busy={submitting}>
                    <div className="form-grid form-grid-two">
                      <div className="form-row">
                        <label>处理结果</label>
                        <select value={closeStatus} onChange={(event) => setCloseStatus(event.target.value as 'DONE' | 'CANCELED')}>
                          <option value="DONE">标记为已完成</option>
                          <option value="CANCELED">取消任务 / 不再处理</option>
                        </select>
                      </div>
                      {selectedTask.relatedAlertId && (
                        <label className="form-row checkbox-form-row">
                          <span>关联预警</span>
                          <label><input type="checkbox" checked={closeSyncAlert} onChange={(event) => setCloseSyncAlert(event.target.checked)} /> 同步更新关联风险预警状态</label>
                        </label>
                      )}
                    </div>
                    <div className="form-row"><label>处理记录</label><textarea value={closeNote} onChange={(event) => setCloseNote(event.target.value)} rows={4} placeholder="请填写为什么完成或取消该任务，将写入任务/预警留痕。" required /></div>
                    <div className="form-actions"><button className="button" type="submit" disabled={submitting}>{submitting ? '提交中...' : '提交状态变更'}</button></div>
                  </form>
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
