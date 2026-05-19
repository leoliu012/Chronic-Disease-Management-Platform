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


const medicationFrequencyUnitLabelMap: Record<string, string> = {
  DAY: '日',
  WEEK: '周',
  MONTH: '月',
};

const medicationTimingRelationLabelMap: Record<string, string> = {
  NONE: '不限定',
  BEFORE_MEAL: '饭前服用',
  AFTER_MEAL: '饭后服用',
  WITH_MEAL: '随餐服用',
};

const timelineTypeLabelMap: Record<string, string> = {
  ALL: '全部记录',
  DISEASE_PROFILE: '慢病档案',
  VITAL_RECORD: '健康指标',
  VITAL_MONITORING_PLAN: '指标打卡计划',
  RISK_ALERT: '风险预警',
  FOLLOW_UP: '随访记录',
  TASK: '待办任务',
  MEDICATION_RECORD: '用药计划',
  MEDICATION_CHECK_IN: '用药打卡',
  QUESTIONNAIRE_RESULT: '问卷结果',
};

const vitalTypeLabelMap: Record<string, string> = {
  BLOOD_PRESSURE: '血压（收缩压/舒张压）',
  SYSTOLIC_BP: '收缩压',
  DIASTOLIC_BP: '舒张压',
  BLOOD_GLUCOSE: '血糖',
  WEIGHT: '体重',
  HEART_RATE: '心率',
  SPO2: '血氧',
};

const vitalFrequencyUnitLabelMap: Record<string, string> = {
  DAY: '日',
  WEEK: '周',
  MONTH: '月',
};

const vitalUnitMap: Record<string, string> = {
  BLOOD_PRESSURE: 'mmHg',
  SYSTOLIC_BP: 'mmHg',
  DIASTOLIC_BP: 'mmHg',
  BLOOD_GLUCOSE: 'mmol/L',
  WEIGHT: 'kg',
  HEART_RATE: 'bpm',
  SPO2: '%',
};

const taskTypeLabelMap: Record<string, string> = {
  FOLLOW_UP: '随访任务',
  RISK_ALERT_FOLLOW_UP: '风险预警处理',
  RECHECK_REMINDER: '复查提醒',
  MEDICATION_REMINDER: '用药提醒',
  MEDICATION_ADHERENCE_FOLLOW_UP: '用药依从性随访',
  VITAL_MEASUREMENT_MISSED: '指标漏测复核',
  QUESTIONNAIRE_REVIEW: '问卷复核',
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
  'VITAL_MONITORING_PLAN',
  'RISK_ALERT',
  'FOLLOW_UP',
  'TASK',
  'MEDICATION_RECORD',
  'MEDICATION_CHECK_IN',
  'QUESTIONNAIRE_RESULT',
];

type PatientDetailWorkspace = 'overview' | 'disease' | 'monitoring' | 'medication' | 'care' | 'timeline';

const patientDetailWorkspaceTabs: Array<{
  key: PatientDetailWorkspace;
  title: string;
  description: string;
}> = [
  { key: 'overview', title: '患者概览', description: '基本信息与关键状态' },
  { key: 'disease', title: '慢病档案', description: '诊断、分期、风险等级' },
  { key: 'monitoring', title: '指标监测', description: '打卡计划与指标录入' },
  { key: 'medication', title: '用药计划', description: '院内维护与患者打卡' },
  { key: 'care', title: '随访任务', description: '待办处理与随访记录' },
  { key: 'timeline', title: '全流程记录', description: '患者长期管理时间线' },
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
  if (type === 'VITAL_MONITORING_PLAN') return 'timeline-card timeline-card-task';
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


function parseTimeList(value: string) {
  return value
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter((item) => /^([01]\d|2[0-3]):[0-5]\d$/.test(item));
}

function parseDayList(value: string, max: number) {
  return Array.from(
    new Set(
      value
        .split(/[,，\s]+/)
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item >= 1 && item <= max),
    ),
  );
}

function formatNextDose(value?: string) {
  return value ? formatTime(value) : '后端自动计算';
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
  const [activeWorkspace, setActiveWorkspace] = useState<PatientDetailWorkspace>('overview');
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

  const [vitalMonitoringPlanId, setVitalMonitoringPlanId] = useState('');

  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [monitoringRecommendations, setMonitoringRecommendations] = useState<any[]>([]);
  const [savingMonitoringPlan, setSavingMonitoringPlan] = useState(false);
  const [editingMonitoringPlanId, setEditingMonitoringPlanId] = useState<string | null>(null);
  const [monitoringPlanActionId, setMonitoringPlanActionId] = useState<string | null>(null);
  const [showInactiveMonitoringPlans, setShowInactiveMonitoringPlans] = useState(false);
  const [monitoringVitalType, setMonitoringVitalType] = useState('BLOOD_PRESSURE');
  const [monitoringDisplayName, setMonitoringDisplayName] = useState('血压（收缩压/舒张压）');
  const [monitoringUnit, setMonitoringUnit] = useState('mmHg');
  const [monitoringFrequencyUnit, setMonitoringFrequencyUnit] = useState('DAY');
  const [monitoringTimesPerUnit, setMonitoringTimesPerUnit] = useState('2');
  const [monitoringCustomMeasureTimes, setMonitoringCustomMeasureTimes] = useState('07:30, 19:30');
  const [monitoringCustomMeasureDays, setMonitoringCustomMeasureDays] = useState('');
  const [monitoringEvidenceBasis, setMonitoringEvidenceBasis] = useState('');

  const [savingMedication, setSavingMedication] = useState(false);
  const [editingMedicationId, setEditingMedicationId] = useState<string | null>(null);
  const [medicationActionId, setMedicationActionId] = useState<string | null>(null);
  const [showInactiveMedications, setShowInactiveMedications] = useState(false);
  const [medicationName, setMedicationName] = useState('');
  const [medicationDosage, setMedicationDosage] = useState('');
  const [medicationFrequencyUnit, setMedicationFrequencyUnit] = useState('DAY');
  const [medicationTimesPerUnit, setMedicationTimesPerUnit] = useState('1');
  const [medicationTimingRelation, setMedicationTimingRelation] = useState('AFTER_MEAL');
  const [medicationCustomDoseTimes, setMedicationCustomDoseTimes] = useState('');
  const [medicationCustomDoseDays, setMedicationCustomDoseDays] = useState('');
  const [medicationInstructions, setMedicationInstructions] = useState('');
  const [medicationDataSource, setMedicationDataSource] = useState('NURSE_INPUT');

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

  const medicationTimeline = useMemo(() => {
    if (!data) return [];
    return data.timeline.filter((item) => item.type === 'MEDICATION_RECORD');
  }, [data]);

  const activeMedicationTimeline = useMemo(
    () => medicationTimeline.filter((item) => item.data?.isActive !== false),
    [medicationTimeline],
  );

  const visibleMedicationTimeline = useMemo(
    () => (showInactiveMedications ? medicationTimeline : activeMedicationTimeline),
    [activeMedicationTimeline, medicationTimeline, showInactiveMedications],
  );

  const inactiveMedicationCount = useMemo(
    () => medicationTimeline.filter((item) => item.data?.isActive === false).length,
    [medicationTimeline],
  );


  const monitoringPlanTimeline = useMemo(() => {
    if (!data) return [];
    return data.timeline.filter((item) => item.type === 'VITAL_MONITORING_PLAN');
  }, [data]);

  const activeMonitoringPlanTimeline = useMemo(
    () => monitoringPlanTimeline.filter((item) => item.data?.isActive !== false),
    [monitoringPlanTimeline],
  );

  const visibleMonitoringPlanTimeline = useMemo(
    () => (showInactiveMonitoringPlans ? monitoringPlanTimeline : activeMonitoringPlanTimeline),
    [activeMonitoringPlanTimeline, monitoringPlanTimeline, showInactiveMonitoringPlans],
  );

  const inactiveMonitoringPlanCount = useMemo(
    () => monitoringPlanTimeline.filter((item) => item.data?.isActive === false).length,
    [monitoringPlanTimeline],
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

    if (nextType === 'BLOOD_PRESSURE' || nextType === 'SYSTOLIC_BP' || nextType === 'DIASTOLIC_BP') {
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
        monitoringPlanId: vitalMonitoringPlanId || undefined,
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

  function handleMonitoringVitalTypeChange(nextType: string) {
    setMonitoringVitalType(nextType);
    setMonitoringDisplayName(vitalTypeLabelMap[nextType] ?? nextType);
    setMonitoringUnit(vitalUnitMap[nextType] ?? '');
    if (nextType === 'BLOOD_PRESSURE') {
      setMonitoringFrequencyUnit('DAY');
      setMonitoringTimesPerUnit('2');
      setMonitoringCustomMeasureTimes('07:30, 19:30');
    }
  }

  function resetMonitoringPlanForm() {
    setEditingMonitoringPlanId(null);
    setMonitoringVitalType('BLOOD_PRESSURE');
    setMonitoringDisplayName('血压（收缩压/舒张压）');
    setMonitoringUnit('mmHg');
    setMonitoringFrequencyUnit('DAY');
    setMonitoringTimesPerUnit('2');
    setMonitoringCustomMeasureTimes('07:30, 19:30');
    setMonitoringCustomMeasureDays('');
    setMonitoringEvidenceBasis('');
  }

  function startEditMonitoringPlan(plan: any) {
    resetNotice();
    setEditingMonitoringPlanId(plan?.id ?? null);
    setMonitoringVitalType(plan?.vitalType ?? 'BLOOD_PRESSURE');
    setMonitoringDisplayName(plan?.displayName ?? vitalTypeLabelMap[plan?.vitalType] ?? '');
    setMonitoringUnit(plan?.unit ?? vitalUnitMap[plan?.vitalType] ?? '');
    setMonitoringFrequencyUnit(plan?.frequencyUnit ?? 'DAY');
    setMonitoringTimesPerUnit(String(plan?.timesPerUnit ?? 1));
    setMonitoringCustomMeasureTimes(Array.isArray(plan?.customMeasureTimes) ? plan.customMeasureTimes.join(', ') : '');
    setMonitoringCustomMeasureDays(Array.isArray(plan?.customMeasureDays) ? plan.customMeasureDays.join(', ') : '');
    setMonitoringEvidenceBasis(plan?.evidenceBasis ?? '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function loadMonitoringRecommendations() {
    if (!patientId) return;

    resetNotice();
    setLoadingRecommendations(true);
    try {
      const res = await api.get(`/patients/${patientId}/vital-monitoring-recommendations`);
      setMonitoringRecommendations(res.data?.recommendations ?? []);
      setMessage(res.data?.message ?? '已生成推荐指标打卡计划。');
    } catch (err) {
      console.error(err);
      setError('推荐打卡计划生成失败，请先确认该患者已有慢病档案。');
    } finally {
      setLoadingRecommendations(false);
    }
  }

  async function applyRecommendedMonitoringPlans(replaceExisting = false) {
    if (!patientId) return;

    resetNotice();
    setSavingMonitoringPlan(true);
    try {
      const res = await api.post(`/patients/${patientId}/vital-monitoring-plans/apply-recommendations`, {
        replaceExisting,
      });
      setMessage(`已应用推荐指标打卡计划：新增 ${res.data?.createdCount ?? 0} 条，跳过 ${res.data?.skippedCount ?? 0} 条。`);
      setActiveTimelineType('VITAL_MONITORING_PLAN');
      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError('推荐计划应用失败，请稍后重试。');
    } finally {
      setSavingMonitoringPlan(false);
    }
  }

  async function submitMonitoringPlan(event: FormEvent) {
    event.preventDefault();
    if (!patientId) return;

    resetNotice();
    setSavingMonitoringPlan(true);
    try {
      const maxDay = monitoringFrequencyUnit === 'WEEK' ? 7 : 31;
      const payload = {
        vitalType: monitoringVitalType,
        displayName: monitoringDisplayName,
        unit: monitoringUnit,
        frequencyUnit: monitoringFrequencyUnit,
        timesPerUnit: Number(monitoringTimesPerUnit),
        customMeasureTimes: parseTimeList(monitoringCustomMeasureTimes),
        customMeasureDays: monitoringFrequencyUnit === 'DAY' ? [] : parseDayList(monitoringCustomMeasureDays, maxDay),
        reminderLeadMinutes: 180,
        checkInWindowBeforeMinutes: 180,
        missedWindowAfterMinutes: 180,
        evidenceBasis: monitoringEvidenceBasis || undefined,
        evidenceSource: monitoringEvidenceBasis ? '护士自定义依据' : undefined,
        isActive: true,
      };

      if (editingMonitoringPlanId) {
        await api.patch(`/vital-monitoring-plans/${editingMonitoringPlanId}`, payload);
        setMessage('指标打卡计划已更新，患者端会同步新的下次打卡时间。');
      } else {
        await api.post(`/patients/${patientId}/vital-monitoring-plans`, payload);
        setMessage('指标打卡计划已新增，患者小程序将按计划提醒打卡。');
      }

      resetMonitoringPlanForm();
      setActiveTimelineType('VITAL_MONITORING_PLAN');
      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError('指标打卡计划保存失败，请检查指标、频率和时间。');
    } finally {
      setSavingMonitoringPlan(false);
    }
  }

  async function deleteMonitoringPlan(plan: any) {
    const planId = plan?.id;
    if (!planId) return;

    const confirmed = window.confirm(
      `确认删除/停用指标打卡计划「${plan?.displayName ?? '该指标'}」吗？

如果已有打卡记录，系统会停用并保留历史；如果没有历史记录，则直接删除。`,
    );
    if (!confirmed) return;

    resetNotice();
    setMonitoringPlanActionId(planId);
    try {
      const res = await api.delete(`/vital-monitoring-plans/${planId}`);
      if (editingMonitoringPlanId === planId) resetMonitoringPlanForm();
      setMessage(res.data?.message ?? '指标打卡计划已删除或停用。');
      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError('指标打卡计划删除失败，请确认后端服务是否正常。');
    } finally {
      setMonitoringPlanActionId(null);
    }
  }

  function resetMedicationForm() {
    setEditingMedicationId(null);
    setMedicationName('');
    setMedicationDosage('');
    setMedicationFrequencyUnit('DAY');
    setMedicationTimesPerUnit('1');
    setMedicationTimingRelation('AFTER_MEAL');
    setMedicationCustomDoseTimes('');
    setMedicationCustomDoseDays('');
    setMedicationInstructions('');
    setMedicationDataSource('NURSE_INPUT');
  }

  function startEditMedication(medication: any) {
    resetNotice();
    setEditingMedicationId(medication?.id ?? null);
    setMedicationName(medication?.medicationName ?? '');
    setMedicationDosage(medication?.dosage ?? '');
    setMedicationFrequencyUnit(medication?.frequencyUnit ?? 'DAY');
    setMedicationTimesPerUnit(String(medication?.timesPerUnit ?? 1));
    setMedicationTimingRelation(medication?.timingRelation ?? 'AFTER_MEAL');
    setMedicationCustomDoseTimes(Array.isArray(medication?.customDoseTimes) ? medication.customDoseTimes.join(', ') : '');
    setMedicationCustomDoseDays(Array.isArray(medication?.customDoseDays) ? medication.customDoseDays.join(', ') : '');
    setMedicationInstructions(medication?.instructions ?? '');
    setMedicationDataSource(medication?.dataSource ?? 'NURSE_INPUT');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submitMedication(event: FormEvent) {
    event.preventDefault();
    if (!patientId) return;

    resetNotice();
    setSavingMedication(true);

    try {
      const maxDay = medicationFrequencyUnit === 'WEEK' ? 7 : 31;
      const customDoseTimes = parseTimeList(medicationCustomDoseTimes);
      const customDoseDays = medicationFrequencyUnit === 'DAY' ? [] : parseDayList(medicationCustomDoseDays, maxDay);
      const payload = {
        medicationName,
        dosage: medicationDosage,
        frequencyUnit: medicationFrequencyUnit,
        timesPerUnit: Number(medicationTimesPerUnit),
        timingRelation: medicationTimingRelation,
        customDoseTimes,
        customDoseDays,
        instructions: medicationInstructions || undefined,
        dataSource: medicationDataSource,
        isActive: true,
        ...(editingMedicationId ? {} : { startDate: new Date().toISOString() }),
      };

      if (editingMedicationId) {
        await api.patch(`/medications/${editingMedicationId}`, payload);
        setMessage('用药计划已更新，患者小程序将同步新的提醒和打卡规则。');
      } else {
        await api.post(`/patients/${patientId}/medications`, payload);
        setMessage('用药计划已由医院端新增，患者小程序将同步显示并可进行每日打卡。');
      }

      resetMedicationForm();
      setActiveTimelineType('MEDICATION_RECORD');

      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError('用药计划保存失败，请检查药品名称、剂量、频次单位和服用时间。');
    } finally {
      setSavingMedication(false);
    }
  }

  async function deleteMedication(medication: any) {
    const medicationId = medication?.id;
    if (!medicationId) return;

    const confirmed = window.confirm(
      `确认删除/停用用药计划「${medication?.medicationName ?? '该药品'}」吗？\n\n如果该计划已经有患者打卡记录，系统会停用并保留历史；如果还没有历史记录，则会直接删除。`,
    );

    if (!confirmed) return;

    resetNotice();
    setMedicationActionId(medicationId);

    try {
      const res = await api.delete(`/medications/${medicationId}`);
      if (editingMedicationId === medicationId) {
        resetMedicationForm();
      }
      setMessage(res.data?.message ?? '用药计划已删除或停用。');
      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError('用药计划删除失败，请确认后端服务是否正常。');
    } finally {
      setMedicationActionId(null);
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
  const diseaseProfileCount = data.timeline.filter((item) => item.type === 'DISEASE_PROFILE').length;
  const activeRiskAlertCount = data.timeline.filter(
    (item) => item.type === 'RISK_ALERT' && (item.data?.status === 'OPEN' || item.data?.status === 'IN_PROGRESS'),
  ).length;
  const activeTaskCount = data.timeline.filter(
    (item) => item.type === 'TASK' && (item.data?.status === 'PENDING' || item.data?.status === 'IN_PROGRESS'),
  ).length;
  const followUpCount = data.timeline.filter((item) => item.type === 'FOLLOW_UP').length;
  const recentVitalCount = data.timeline.filter((item) => item.type === 'VITAL_RECORD').length;
  const questionnaireCount = data.timeline.filter((item) => item.type === 'QUESTIONNAIRE_RESULT').length;

  function getWorkspaceCount(key: PatientDetailWorkspace) {
    if (key === 'overview') return activeRiskAlertCount + activeTaskCount;
    if (key === 'disease') return diseaseProfileCount;
    if (key === 'monitoring') return activeMonitoringPlanTimeline.length;
    if (key === 'medication') return activeMedicationTimeline.length;
    if (key === 'care') return activeTaskCount + followUpCount;
    return visibleTimeline.length;
  }

  return (
    <div className="business-page patient-detail-page hospital-record-page">
      <div className="page-header">
        <div>
          <Link className="action-link" to="/patients">← 返回患者档案</Link>
          <div className="page-kicker">慢病中心患者档案</div>
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

      <div className="patient-detail-workspace-layout">
        <aside className="patient-detail-side-nav" aria-label="患者档案功能导航">
          <div className="patient-detail-side-nav-title">患者档案工作区</div>
          <div className="patient-detail-side-nav-list">
            {patientDetailWorkspaceTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={activeWorkspace === tab.key ? 'patient-detail-side-nav-item active' : 'patient-detail-side-nav-item'}
                onClick={() => setActiveWorkspace(tab.key)}
              >
                <span>
                  <strong>{tab.title}</strong>
                  <small>{tab.description}</small>
                </span>
                <em>{getWorkspaceCount(tab.key)}</em>
              </button>
            ))}
          </div>
        </aside>

        <main className="patient-detail-workspace-main">
      {activeWorkspace === 'overview' && (
        <>
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


          <section className="patient-module-summary-grid" aria-label="患者关键管理状态">
            <article>
              <span>慢病档案</span>
              <strong>{diseaseProfileCount}</strong>
              <p>已建档病种与风险等级。</p>
            </article>
            <article>
              <span>待处理预警</span>
              <strong>{activeRiskAlertCount}</strong>
              <p>需护士复核或医生关注。</p>
            </article>
            <article>
              <span>当前待办</span>
              <strong>{activeTaskCount}</strong>
              <p>随访、漏测、用药依从性任务。</p>
            </article>
            <article>
              <span>指标记录</span>
              <strong>{recentVitalCount}</strong>
              <p>患者端和院内录入的历史指标。</p>
            </article>
            <article>
              <span>用药计划</span>
              <strong>{activeMedicationTimeline.length}</strong>
              <p>当前启用中的院内用药计划。</p>
            </article>
            <article>
              <span>问卷记录</span>
              <strong>{questionnaireCount}</strong>
              <p>患者端提交的健康问卷。</p>
            </article>
          </section>
        </>
      )}

      {activeWorkspace === 'disease' && (
        <>
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
        </>
      )}

      {activeWorkspace === 'monitoring' && (
        <>
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
            <div className="form-row">
              <label>关联指标打卡计划（可选）</label>
              <select value={vitalMonitoringPlanId} onChange={(event) => setVitalMonitoringPlanId(event.target.value)}>
                <option value="">不关联计划</option>
                {activeMonitoringPlanTimeline.map((item) => (
                  <option key={item.data?.id} value={item.data?.id}>
                    {item.data?.displayName ?? item.title}
                  </option>
                ))}
              </select>
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
            <span>VITAL MONITORING PLAN</span>
            <h2>{editingMonitoringPlanId ? '医院端修改指标打卡计划' : '医院端配置指标打卡计划'}</h2>
          </div>
          <div className="patient-hero-actions">
            <button className="secondary-button" type="button" onClick={loadMonitoringRecommendations} disabled={loadingRecommendations}>
              {loadingRecommendations ? '生成中...' : '根据慢病档案推荐'}
            </button>
            <button className="secondary-button" type="button" onClick={() => applyRecommendedMonitoringPlans(false)} disabled={savingMonitoringPlan}>
              一键应用推荐
            </button>
          </div>
        </div>

        <p className="section-hint">
          指标打卡计划由医院端维护。患者端只按计划录入，系统显示下一次打卡时间；测量时间前 3 小时可开始打卡，超过测量时间 3 小时显示漏测按钮。正式微信提醒需接入订阅消息模板和患者 openid。
        </p>

        {monitoringRecommendations.length > 0 && (
          <div className="recommendation-grid">
            {monitoringRecommendations.map((item) => (
              <article className="recommendation-card" key={`${item.sourcePreset}-${item.vitalType}`}>
                <div className="task-inline-card-topline">
                  <span className="badge">{diseaseLabelMap[item.sourcePreset] ?? item.sourcePreset}</span>
                  <span className="task-status-chip">推荐</span>
                </div>
                <h4>{item.displayName}</h4>
                <p>频率：每{vitalFrequencyUnitLabelMap[item.frequencyUnit] ?? item.frequencyUnit} {item.timesPerUnit} 次 · 单位：{item.unit}</p>
                <p className="muted small">{item.evidenceBasis}</p>
              </article>
            ))}
          </div>
        )}

        {editingMonitoringPlanId && <div className="edit-mode-banner">正在修改已有指标打卡计划。保存后会同步患者端下次打卡时间。</div>}

        <form className="hospital-form" onSubmit={submitMonitoringPlan}>
          <div className="form-grid">
            <div className="form-row">
              <label>指标类型</label>
              <select value={monitoringVitalType} onChange={(event) => handleMonitoringVitalTypeChange(event.target.value)}>
                <option value="BLOOD_PRESSURE">血压（收缩压/舒张压）</option>
                <option value="BLOOD_GLUCOSE">血糖</option>
                <option value="WEIGHT">体重</option>
                <option value="HEART_RATE">心率</option>
                <option value="SPO2">血氧</option>
              </select>
            </div>
            <div className="form-row">
              <label>显示名称</label>
              <input value={monitoringDisplayName} onChange={(event) => setMonitoringDisplayName(event.target.value)} required />
            </div>
            <div className="form-row">
              <label>单位</label>
              <input value={monitoringUnit} onChange={(event) => setMonitoringUnit(event.target.value)} required />
            </div>
            <div className="form-row">
              <label>频次单位</label>
              <select value={monitoringFrequencyUnit} onChange={(event) => setMonitoringFrequencyUnit(event.target.value)}>
                <option value="DAY">日</option>
                <option value="WEEK">周</option>
                <option value="MONTH">月</option>
              </select>
            </div>
            <div className="form-row">
              <label>每单位次数</label>
              <input type="number" min="1" max="31" value={monitoringTimesPerUnit} onChange={(event) => setMonitoringTimesPerUnit(event.target.value)} required />
            </div>
          </div>

          <div className="form-grid">
            <div className="form-row">
              <label>自定义测量时间（可选）</label>
              <input value={monitoringCustomMeasureTimes} onChange={(event) => setMonitoringCustomMeasureTimes(event.target.value)} placeholder="例如：07:30, 19:30；留空则白天自动均摊" />
            </div>
            <div className="form-row">
              <label>{monitoringFrequencyUnit === 'WEEK' ? '自定义测量星期（可选）' : monitoringFrequencyUnit === 'MONTH' ? '自定义测量日期（可选）' : '自定义测量日'}</label>
              <input disabled={monitoringFrequencyUnit === 'DAY'} value={monitoringCustomMeasureDays} onChange={(event) => setMonitoringCustomMeasureDays(event.target.value)} placeholder={monitoringFrequencyUnit === 'WEEK' ? '1=周一，7=周日；例如：1,4' : monitoringFrequencyUnit === 'MONTH' ? '1-31；例如：1,15' : '每日指标无需填写'} />
            </div>
          </div>

          <div className="form-row">
            <label>科学依据 / 设置说明</label>
            <textarea value={monitoringEvidenceBasis} onChange={(event) => setMonitoringEvidenceBasis(event.target.value)} placeholder="可保留推荐依据，也可填写医生/护士个体化调整原因" />
          </div>

          <div className="form-actions">
            <button className="button" type="submit" disabled={savingMonitoringPlan}>
              {savingMonitoringPlan ? '保存中...' : editingMonitoringPlanId ? '保存修改' : '保存指标打卡计划'}
            </button>
            {editingMonitoringPlanId && (
              <button className="secondary-button" type="button" onClick={resetMonitoringPlanForm} disabled={savingMonitoringPlan}>取消修改</button>
            )}
          </div>
        </form>

        <div className="task-inline-list medication-inline-list">
          <div className="task-inline-list-header medication-list-header">
            <div>
              <h3>当前指标打卡计划</h3>
              <p className="muted small">这些计划会同步到患者微信小程序，患者按下次打卡时间录入。</p>
            </div>
            <label className="history-toggle medication-history-toggle">
              <input type="checkbox" checked={showInactiveMonitoringPlans} onChange={(event) => setShowInactiveMonitoringPlans(event.target.checked)} />
              显示停用/历史计划{inactiveMonitoringPlanCount ? `（${inactiveMonitoringPlanCount}）` : ''}
            </label>
          </div>

          {visibleMonitoringPlanTimeline.length === 0 ? (
            <div className="empty-state task-empty-state">当前患者暂无启用中的指标打卡计划。</div>
          ) : (
            <div className="task-inline-grid">
              {visibleMonitoringPlanTimeline.map((item) => (
                <article className="task-inline-card medication-inline-card" key={item.data?.id ?? `${item.time}-${item.title}`}>
                  <div className="task-inline-card-topline">
                    <span className="badge">{item.data?.sourcePreset ? diseaseLabelMap[item.data.sourcePreset] ?? item.data.sourcePreset : '医院配置'}</span>
                    <span className="task-status-chip">{item.data?.isActive ? '启用' : '停用'}</span>
                  </div>
                  <h4>{item.data?.displayName ?? item.title}</h4>
                  <p>频率：每{vitalFrequencyUnitLabelMap[item.data?.frequencyUnit] ?? '日'} {item.data?.timesPerUnit ?? 1} 次 · 单位：{item.data?.unit ?? '-'}</p>
                  <p className="muted small">{item.data?.evidenceBasis ?? '护士自定义计划'}</p>
                  <div className="timeline-extra">最近打卡：{formatTime(item.data?.lastCheckInAt)}</div>
                  <div className="medication-card-actions">
                    <button className="secondary-button compact-button" type="button" onClick={() => startEditMonitoringPlan(item.data)}>修改计划</button>
                    <button className="danger-outline-button compact-button" type="button" disabled={monitoringPlanActionId === item.data?.id} onClick={() => deleteMonitoringPlan(item.data)}>
                      {monitoringPlanActionId === item.data?.id ? '处理中...' : '删除/停用'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
        </>
      )}

      {activeWorkspace === 'medication' && (
        <>
      <section className="panel form-panel">
        <div className="hospital-section-header">
          <div>
            <span>HOSPITAL MEDICATION ORDER</span>
            <h2>{editingMedicationId ? '医院端修改用药计划' : '医院端新增用药计划'}</h2>
          </div>
          <p className="section-hint">用药计划应由医生/护士或 HIS/药房处方接口维护；患者小程序只负责查看和打卡。</p>
        </div>

        {editingMedicationId && (
          <div className="edit-mode-banner">
            正在修改已有用药计划。保存后会同步患者端下次用药时间；已产生的历史打卡记录会保留。
          </div>
        )}

        <form className="hospital-form" onSubmit={submitMedication}>
          <div className="form-grid">
            <div className="form-row">
              <label>药品名称</label>
              <input value={medicationName} onChange={(event) => setMedicationName(event.target.value)} placeholder="例如：二甲双胍" required />
            </div>
            <div className="form-row">
              <label>剂量</label>
              <input value={medicationDosage} onChange={(event) => setMedicationDosage(event.target.value)} placeholder="例如：500mg" required />
            </div>
            <div className="form-row">
              <label>频次单位</label>
              <select value={medicationFrequencyUnit} onChange={(event) => setMedicationFrequencyUnit(event.target.value)}>
                <option value="DAY">日</option>
                <option value="WEEK">周</option>
                <option value="MONTH">月</option>
              </select>
            </div>
            <div className="form-row">
              <label>每单位次数</label>
              <input type="number" min="1" max={medicationFrequencyUnit === 'DAY' ? 8 : medicationFrequencyUnit === 'WEEK' ? 7 : 31} value={medicationTimesPerUnit} onChange={(event) => setMedicationTimesPerUnit(event.target.value)} required />
            </div>
            <div className="form-row">
              <label>服用时机</label>
              <select value={medicationTimingRelation} onChange={(event) => setMedicationTimingRelation(event.target.value)}>
                <option value="NONE">不限定</option>
                <option value="BEFORE_MEAL">饭前服用</option>
                <option value="AFTER_MEAL">饭后服用</option>
                <option value="WITH_MEAL">随餐服用</option>
              </select>
            </div>
            <div className="form-row">
              <label>来源</label>
              <select value={medicationDataSource} onChange={(event) => setMedicationDataSource(event.target.value)}>
                <option value="NURSE_INPUT">护士录入</option>
                <option value="HIS">HIS/处方同步</option>
                <option value="EMR">EMR</option>
                <option value="MANUAL_IMPORT">人工导入</option>
              </select>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-row">
              <label>自定义服用时间（可选）</label>
              <input value={medicationCustomDoseTimes} onChange={(event) => setMedicationCustomDoseTimes(event.target.value)} placeholder="例如：08:00, 18:00；留空则白天自动均摊" />
            </div>
            <div className="form-row">
              <label>{medicationFrequencyUnit === 'WEEK' ? '自定义服用星期（可选）' : medicationFrequencyUnit === 'MONTH' ? '自定义服用日期（可选）' : '自定义服用日'}</label>
              <input disabled={medicationFrequencyUnit === 'DAY'} value={medicationCustomDoseDays} onChange={(event) => setMedicationCustomDoseDays(event.target.value)} placeholder={medicationFrequencyUnit === 'WEEK' ? '1=周一，7=周日；例如：1,4' : medicationFrequencyUnit === 'MONTH' ? '1-31；例如：1,15' : '每日用药无需填写'} />
            </div>
          </div>

          <div className="form-row">
            <label>用药说明</label>
            <textarea value={medicationInstructions} onChange={(event) => setMedicationInstructions(event.target.value)} placeholder="例如：如出现明显不适，请联系护士或复诊" />
          </div>

          <p className="form-tip">规则：患者端显示下一次用药时间；用药时间前 3 小时可开始打卡；用药时间后 3 小时显示漏服按钮；微信订阅消息发送能力已在后端预留提醒时间字段。</p>

          <div className="form-actions">
            <button className="button" type="submit" disabled={savingMedication}>
              {savingMedication ? '保存中...' : editingMedicationId ? '保存修改' : '保存用药计划'}
            </button>
            {editingMedicationId && (
              <button className="secondary-button" type="button" onClick={resetMedicationForm} disabled={savingMedication}>
                取消修改
              </button>
            )}
          </div>
        </form>

        <div className="task-inline-list medication-inline-list">
          <div className="task-inline-list-header medication-list-header">
            <div>
              <h3>当前用药计划</h3>
              <p className="muted small">这些计划会同步到患者微信小程序，患者只能按计划打卡或反馈漏服。</p>
            </div>
            <label className="history-toggle medication-history-toggle">
              <input
                type="checkbox"
                checked={showInactiveMedications}
                onChange={(event) => setShowInactiveMedications(event.target.checked)}
              />
              显示停用/历史计划{inactiveMedicationCount ? `（${inactiveMedicationCount}）` : ''}
            </label>
          </div>

          {visibleMedicationTimeline.length === 0 ? (
            <div className="empty-state task-empty-state">当前患者暂无启用中的用药计划。</div>
          ) : (
            <div className="task-inline-grid">
              {visibleMedicationTimeline.map((item) => (
                <article className="task-inline-card medication-inline-card" key={item.data?.id ?? `${item.time}-${item.title}`}>
                  <div className="task-inline-card-topline">
                    <span className="badge">{dataSourceLabelMap[item.data?.dataSource] ?? item.data?.dataSource ?? '医院端'}</span>
                    <span className="task-status-chip">{item.data?.isActive ? '启用' : '停用'}</span>
                  </div>
                  <h4>{item.data?.medicationName ?? item.title}</h4>
                  <p>剂量：{item.data?.dosage ?? '-'} · 频次：{item.data?.frequency ?? '-'}</p>
                  <p>结构化规则：每{medicationFrequencyUnitLabelMap[item.data?.frequencyUnit] ?? '日'} {item.data?.timesPerUnit ?? 1} 次 · {medicationTimingRelationLabelMap[item.data?.timingRelation] ?? '不限定'}</p>
                  {item.data?.instructions && <p>说明：{item.data.instructions}</p>}
                  <div className="timeline-extra">下次用药：{formatNextDose(item.data?.nextDose?.scheduledAt)} · 最近打卡：{formatTime(item.data?.lastCheckInAt)}</div>
                  <div className="medication-card-actions">
                    <button className="secondary-button compact-button" type="button" onClick={() => startEditMedication(item.data)}>
                      修改计划
                    </button>
                    <button
                      className="danger-outline-button compact-button"
                      type="button"
                      disabled={medicationActionId === item.data?.id}
                      onClick={() => deleteMedication(item.data)}
                    >
                      {medicationActionId === item.data?.id ? '处理中...' : '删除/停用'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
        </>
      )}

      {activeWorkspace === 'care' && (
        <>
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
        </>
      )}

      {activeWorkspace === 'timeline' && (
        <>
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
                  {item.type === 'MEDICATION_RECORD' && (
                    <div className="timeline-extra">
                      药品：{item.data?.medicationName ?? '-'} · 剂量：{item.data?.dosage ?? '-'} · 频次：
                      {item.data?.frequency ?? '-'} · 下次用药：{formatNextDose(item.data?.nextDose?.scheduledAt)} · 来源：{dataSourceLabelMap[item.data?.dataSource] ?? item.data?.dataSource ?? '-'}
                    </div>
                  )}
                  {item.type === 'MEDICATION_CHECK_IN' && (
                    <div className="timeline-extra">
                      打卡结果：{item.data?.taken ? '已服药' : '漏服/未服'}
                      {item.data?.note ? ` · 备注：${item.data.note}` : ''}
                    </div>
                  )}
                  {item.type === 'QUESTIONNAIRE_RESULT' && (
                    <div className="timeline-extra">
                      评分：{item.data?.score}/10 · 风险：{riskLabelMap[item.data?.riskLevel] ?? item.data?.riskLevel} ·
                      {item.data?.riskConclusion ?? ''}
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
        </>
      )}
        </main>
      </div>
    </div>
  );
}



