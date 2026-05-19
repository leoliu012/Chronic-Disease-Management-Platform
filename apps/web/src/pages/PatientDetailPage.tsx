import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, getApiErrorMessage } from '../api/client';

type TimelineEvent = {
  type: string;
  time: string;
  title: string;
  description: string;
  data: any;
};

type HospitalVisitReminder = {
  id: string;
  patientId: string;
  reason: string;
  note?: string;
  status: string;
  remindedAt: string;
  patient?: {
    id: string;
    name: string;
    hospitalPatientId?: string;
    phone?: string;
  };
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
  HIS: '院内信息系统',
  EMR: '电子病历',
  LIS: '检验系统',
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
  LDL_C: '低密度脂蛋白胆固醇',
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
  IN_PROGRESS: '待处理',
  DONE: '已完成',
  CANCELED: '已取消',
  OPEN: '未处理',
  RESOLVED: '已处理',
  DISMISSED: '已忽略',
};

const questionnaireTypeLabelMap: Record<string, string> = {
  HYPERTENSION_MONTHLY: '高血压月度随访问卷',
  DIABETES_MONTHLY: '糖尿病月度随访问卷',
  COPD_CAT: '慢阻肺症状评估',
  CHD_MONTHLY: '冠心病月度随访问卷',
  LIPID_LIFESTYLE: '血脂生活方式问卷',
  OBESITY_LIFESTYLE: '体重管理生活方式问卷',
};

const riskDispositionActionLabelMap: Record<string, string> = {
  URGENT_VISIT: '提醒患者立即到院',
  MEDICATION: '修改/增加用药',
  RECHECK_TASK: '新增复测任务',
  FOLLOW_UP: '电话随访沟通',
};

function buildRiskDispositionDraft(actions: string[], alert?: TimelineEvent) {
  const alertTitle = alert?.title ? localizeBackendText(alert.title) : '当前风险预警';
  const labels = actions.map((action) => riskDispositionActionLabelMap[action]).filter(Boolean);

  if (!labels.length) {
    return `针对${alertTitle}，请先选择处置方式后完善处置记录。`;
  }

  return `针对${alertTitle}，护士拟执行：${labels.join('、')}。请结合患者当前指标、症状、用药情况和复测结果完成处置。`;
}

function buildRiskDispositionInstruction(actions: string[]) {
  const instructions = [];

  if (actions.includes('URGENT_VISIT')) {
    instructions.push('已提醒患者尽快前往医院或门急诊评估，携带近期监测记录和当前用药清单；如出现胸痛、呼吸困难、意识改变等危险症状，应立即急诊就医。');
  }

  if (actions.includes('MEDICATION')) {
    instructions.push('已根据医护评估调整或补充用药计划，请患者按更新后的用药计划执行，如出现不适或不良反应及时联系护士或复诊。');
  }

  if (actions.includes('RECHECK_TASK')) {
    instructions.push('已安排异常指标复测，请患者按时完成复测并上传结果；若复测仍异常，将继续随访或建议复诊。');
  }

  if (actions.includes('FOLLOW_UP')) {
    instructions.push('护士将通过电话随访复核症状、用药依从性和复测数据，并将随访内容写入患者全流程记录。');
  }

  return instructions.join('\n');
}

const backendTermLabelMap: Record<string, string> = {
  ...diseaseLabelMap,
  ...riskLabelMap,
  ...dataSourceLabelMap,
  ...vitalTypeLabelMap,
  ...taskTypeLabelMap,
  ...followUpTypeLabelMap,
  ...statusLabelMap,
  ...questionnaireTypeLabelMap,
};

function localizeBackendText(value?: string | null) {
  if (!value) return '';

  let text = String(value);

  text = text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (iso) => formatTime(iso));

  Object.entries(backendTermLabelMap)
    .sort(([left], [right]) => right.length - left.length)
    .forEach(([raw, label]) => {
      text = text.split(raw).join(label);
    });

  return text;
}

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

type PatientDetailWorkspace = 'overview' | 'actions' | 'disease' | 'monitoring' | 'medication' | 'care' | 'timeline';

const patientDetailWorkspaceTabs: Array<{
  key: PatientDetailWorkspace;
  title: string;
  description: string;
}> = [
  { key: 'overview', title: '患者概览', description: '基本信息与关键状态' },
  { key: 'disease', title: '慢病档案', description: '诊断、分期、风险等级' },
  { key: 'monitoring', title: '指标监测', description: '打卡计划与指标录入' },
  { key: 'medication', title: '用药计划', description: '院内维护与患者打卡' },
  { key: 'timeline', title: '全流程记录', description: '患者长期管理时间线' },
];

function isPatientDetailWorkspace(value: string | null): value is PatientDetailWorkspace {
  return value === 'overview' || value === 'disease' || value === 'monitoring' || value === 'medication' || value === 'timeline';
}

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

function getRiskClass(riskLevel: string) {
  return `risk-badge risk-${riskLevel.toLowerCase().replace(/_/g, '-')}`;
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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [data, setData] = useState<PatientTimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeTimelineType, setActiveTimelineType] = useState('ALL');
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [showAllTaskHistory, setShowAllTaskHistory] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<PatientDetailWorkspace>('overview');
  const [cleaningTestData, setCleaningTestData] = useState(false);

  const [showDiseaseForm, setShowDiseaseForm] = useState(false);
  const [showVitalForm, setShowVitalForm] = useState(false);
  const [showMonitoringPlanForm, setShowMonitoringPlanForm] = useState(false);
  const [showMedicationForm, setShowMedicationForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
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
  const [activeHospitalVisitReminders, setActiveHospitalVisitReminders] = useState<HospitalVisitReminder[]>([]);
  const [processingActionId, setProcessingActionId] = useState<string | null>(null);
  const [selectedRiskAlertId, setSelectedRiskAlertId] = useState('');
  const [riskDispositionActions, setRiskDispositionActions] = useState<string[]>(['FOLLOW_UP']);
  const [riskDispositionNote, setRiskDispositionNote] = useState('');
  const [riskDispositionInstruction, setRiskDispositionInstruction] = useState('');
  const [riskDispositionAutoDraft, setRiskDispositionAutoDraft] = useState('');
  const [riskDispositionSignature, setRiskDispositionSignature] = useState('');
  const [riskMedicationName, setRiskMedicationName] = useState('');
  const [riskMedicationDosage, setRiskMedicationDosage] = useState('');
  const [riskMedicationInstructions, setRiskMedicationInstructions] = useState('');
  const [riskRecheckDueHours, setRiskRecheckDueHours] = useState('4');
  const [riskFollowUpContent, setRiskFollowUpContent] = useState('');
  const [riskFollowUpResult, setRiskFollowUpResult] = useState('');
  const [riskFollowUpSuggestion, setRiskFollowUpSuggestion] = useState('');
  const [syncRelatedTasksOnRiskResolve, setSyncRelatedTasksOnRiskResolve] = useState(true);

  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [followUpType, setFollowUpType] = useState('PHONE');
  const [content, setContent] = useState('');
  const [result, setResult] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [nextFollowUpTime, setNextFollowUpTime] = useState('');

  async function loadTimeline() {
    if (!patientId) {
      setData(null);
      setActiveHospitalVisitReminders([]);
      setError('缺少患者 ID，请从患者主索引重新进入患者详情。');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const timelineRes = await api.get(`/patients/${patientId}/timeline`);
      setData(timelineRes.data);

      const resolvedPatientId = timelineRes.data?.patient?.id ?? patientId;

      try {
        const hospitalReminderRes = await api.get(
          `/patients/${resolvedPatientId}/hospital-visit-reminders/active`,
        );
        setActiveHospitalVisitReminders(hospitalReminderRes.data ?? []);
      } catch (reminderErr) {
        console.warn(
          'Active hospital visit reminders failed to load. Patient detail will continue rendering.',
          reminderErr,
        );
        setActiveHospitalVisitReminders([]);
      }
    } catch (err) {
      console.error(err);
      setData(null);
      setActiveHospitalVisitReminders([]);
      setError(getApiErrorMessage(err, '未找到该患者档案，或患者详情接口暂时不可用。请从患者主索引重新进入。'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTimeline();
  }, [patientId]);

  useEffect(() => {
    const requestedWorkspace = searchParams.get('workspace');
    const requestedFocus = searchParams.get('focus');

    if (requestedWorkspace === 'risk' || requestedWorkspace === 'actions' || requestedWorkspace === 'care') {
      setActiveWorkspace('timeline');
    } else if (isPatientDetailWorkspace(requestedWorkspace)) {
      setActiveWorkspace(requestedWorkspace);
    }

    if (requestedFocus === 'alert') {
      setActiveTimelineType('RISK_ALERT');
      const requestedAlertId = searchParams.get('alertId');
      if (requestedAlertId) setSelectedRiskAlertId(requestedAlertId);
    } else if (requestedFocus === 'task') {
      setActiveTimelineType('TASK');
    } else if (requestedFocus === 'vitals') {
      setActiveTimelineType('VITAL_RECORD');
    }
  }, [searchParams]);

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

  async function startRiskAlertTaskFromDetail(item: TimelineEvent) {
    if (!patientId || !item.data?.id || processingActionId) return;

    setProcessingActionId(item.data.id);
    resetNotice();

    try {
      const dueAt = new Date();
      if (item.data?.riskLevel === 'VERY_HIGH') dueAt.setHours(dueAt.getHours() + 4);
      else if (item.data?.riskLevel === 'HIGH') dueAt.setHours(dueAt.getHours() + 24);
      else dueAt.setHours(dueAt.getHours() + 72);

      const taskRes = await api.post(`/patients/${patientId}/tasks`, {
        title: localizeBackendText(item.title).replace(/^风险预警：/, '风险随访：'),
        type: 'RISK_ALERT_FOLLOW_UP',
        dueAt: dueAt.toISOString(),
        assigneeId: nurseId,
        relatedAlertId: item.data.id,
      });

      await api.patch(`/risk-alerts/${item.data.id}/in-progress`, {
        handledBy: nurseId,
        handlingNote: '护士已从患者详情页将风险预警转为统一任务处理。',
      });

      navigate(`/patients/${patientId}/task-processing?taskId=${taskRes.data.id}&mode=phone`);
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '风险预警转任务失败，请稍后重试。'));
      await loadTimeline();
    } finally {
      setProcessingActionId(null);
    }
  }

  async function submitDiseaseProfile(event: FormEvent) {
    event.preventDefault();
    if (!patientId || savingDiseaseProfile) return;

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
      setShowDiseaseForm(false);

      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '慢病档案保存失败，请检查必填项或稍后重试。'));
    } finally {
      setSavingDiseaseProfile(false);
    }
  }

  async function submitVitalRecord(event: FormEvent) {
    event.preventDefault();
    if (!patientId || savingVital) return;

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
        setMessage('健康指标已保存：系统已自动生成风险预警，并合并到统一任务处理流程。');
        setActiveTimelineType('RISK_ALERT');
      } else if (res.data?.generatedRiskAlert) {
        setMessage('健康指标已保存：系统已自动生成风险预警。');
        setActiveTimelineType('RISK_ALERT');
      } else {
        setMessage('健康指标已保存，本次未触发异常预警。');
        setActiveTimelineType('VITAL_RECORD');
      }
      setShowVitalForm(false);

      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '健康指标保存失败，请检查数值和单位。'));
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
    setShowMonitoringPlanForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function loadMonitoringRecommendations() {
    if (!patientId || loadingRecommendations) return;

    resetNotice();
    setLoadingRecommendations(true);
    try {
      const res = await api.get(`/patients/${patientId}/vital-monitoring-recommendations`);
      setMonitoringRecommendations(res.data?.recommendations ?? []);
      setMessage(res.data?.message ?? '已生成推荐指标打卡计划。');
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '推荐打卡计划生成失败，请先确认该患者已有慢病档案。'));
    } finally {
      setLoadingRecommendations(false);
    }
  }

  async function applyRecommendedMonitoringPlans(replaceExisting = false) {
    if (!patientId || savingMonitoringPlan) return;

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
      setError(getApiErrorMessage(err, '推荐计划应用失败，请稍后重试。'));
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
      setShowMonitoringPlanForm(false);
      setActiveTimelineType('VITAL_MONITORING_PLAN');
      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '指标打卡计划保存失败，请检查指标、频率和时间。'));
    } finally {
      setSavingMonitoringPlan(false);
    }
  }

  async function deleteMonitoringPlan(plan: any) {
    const planId = plan?.id;
    if (!planId || monitoringPlanActionId) return;

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
      setError(getApiErrorMessage(err, '指标打卡计划删除失败，请确认后端服务是否正常。'));
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
    setShowMedicationForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submitMedication(event: FormEvent) {
    event.preventDefault();
    if (!patientId || savingMedication) return;

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
      setShowMedicationForm(false);
      setActiveTimelineType('MEDICATION_RECORD');

      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '用药计划保存失败，请检查药品名称、剂量、频次单位和服用时间。'));
    } finally {
      setSavingMedication(false);
    }
  }

  async function deleteMedication(medication: any) {
    const medicationId = medication?.id;
    if (!medicationId || medicationActionId) return;

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
      setError(getApiErrorMessage(err, '用药计划删除失败，请确认后端服务是否正常。'));
    } finally {
      setMedicationActionId(null);
    }
  }

  async function submitTask(event: FormEvent) {
    event.preventDefault();
    if (!patientId || savingTask) return;

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
      setShowTaskForm(false);

      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '任务创建失败，请稍后重试。'));
    } finally {
      setSavingTask(false);
    }
  }

  function resetRiskDispositionDraft(actions = riskDispositionActions) {
    const alert = activeRiskAlerts.find((item) => item.data?.id === (selectedRiskAlertId || activeRiskAlerts[0]?.data?.id));
    const draft = buildRiskDispositionDraft(actions, alert);
    const instruction = buildRiskDispositionInstruction(actions);

    setRiskDispositionNote((current) => (!current.trim() || current === riskDispositionAutoDraft ? draft : current));
    setRiskDispositionInstruction((current) => (!current.trim() || current === riskDispositionAutoDraft ? instruction : current));
    setRiskDispositionAutoDraft(draft);

    if (actions.includes('MEDICATION')) {
      setRiskMedicationInstructions((current) => current || '根据风险预警处置结果调整用药，请患者按护士/医生交代执行，并观察不适反应。');
    }

    if (actions.includes('FOLLOW_UP')) {
      setRiskFollowUpContent((current) => current || draft);
      setRiskFollowUpResult((current) => current || '已联系患者，待补充患者症状、复测结果和用药反馈。');
      setRiskFollowUpSuggestion((current) => current || instruction || '请患者按医护交代完成复测、用药和复诊。');
    }
  }

  function toggleRiskDispositionAction(action: string) {
    setRiskDispositionActions((current) => {
      const next = current.includes(action)
        ? current.filter((item) => item !== action)
        : [...current, action];
      const safeNext = next.length ? next : ['FOLLOW_UP'];
      window.setTimeout(() => resetRiskDispositionDraft(safeNext), 0);
      return safeNext;
    });
  }

  function selectRiskAlert(alertId: string) {
    setSelectedRiskAlertId(alertId);
    const alert = activeRiskAlerts.find((item) => item.data?.id === alertId);
    const draft = buildRiskDispositionDraft(riskDispositionActions, alert);
    const instruction = buildRiskDispositionInstruction(riskDispositionActions);
    setRiskDispositionNote((current) => (!current.trim() || current === riskDispositionAutoDraft ? draft : current));
    setRiskDispositionInstruction((current) => (!current.trim() || current === riskDispositionAutoDraft ? instruction : current));
    setRiskDispositionAutoDraft(draft);
  }

  async function dismissSelectedRiskAlert(alertId: string) {
    if (processingActionId) return;

    const signature = riskDispositionSignature.trim();
    if (!signature) {
      setError('请先填写电子签名，再提交忽略/误报。');
      return;
    }

    resetNotice();
    setProcessingActionId(`risk-${alertId}-dismiss`);

    try {
      const note = [
        riskDispositionNote.trim() || '护士判断该预警为误报或暂不需要继续处理。',
        riskDispositionInstruction.trim() ? `交代内容：${riskDispositionInstruction.trim()}` : '',
        '处置结果：忽略/误报',
        `电子签名：${signature}`,
      ].filter(Boolean).join('；');

      await api.patch(`/risk-alerts/${alertId}/dismiss`, {
        handledBy: nurseId,
        handlingNote: note,
      });

      setMessage('风险预警已标记为忽略/误报，后台已留痕。');
      setRiskDispositionSignature('');
      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '风险预警忽略失败，请稍后重试。'));
    } finally {
      setProcessingActionId(null);
    }
  }


  async function resolveRiskAlertFromCare(alert: TimelineEvent) {
    const alertId = alert.data?.id;
    if (!alertId || processingActionId) return;

    const relatedTasks = activeTasks.filter((task) => task.data?.relatedAlertId === alertId);
    const syncRelatedTasks = relatedTasks.length > 0
      ? window.confirm(`该预警已绑定 ${relatedTasks.length} 条待办任务。是否在提交预警处置后，一并将绑定任务标记为已完成？`)
      : false;

    const note = window.prompt('请输入处置记录（用于后台留痕）');
    if (note === null) return;
    if (!note.trim()) {
      setError('处置记录不能为空。');
      return;
    }

    const instruction = window.prompt('请输入交代内容（如复测、用药、复诊安排）') ?? '';
    const signature = window.prompt('请输入电子签名（护士姓名 / 工号）');
    if (signature === null) return;
    if (!signature.trim()) {
      setError('电子签名不能为空。');
      return;
    }

    resetNotice();
    setProcessingActionId(`care-alert-${alertId}-resolve`);

    try {
      await api.patch(`/risk-alerts/${alertId}/resolve`, {
        handledBy: nurseId,
        handlingNote: [
          `处置记录：${note.trim()}`,
          instruction.trim() ? `交代内容：${instruction.trim()}` : '',
          `电子签名：${signature.trim()}`,
          syncRelatedTasks ? '同步结果：已确认一并完成关联待办任务' : '同步结果：暂不变更关联待办任务',
        ].filter(Boolean).join('；'),
        syncRelatedTasks,
      });

      setMessage(syncRelatedTasks ? '风险预警已处理，关联待办任务已同步完成。' : '风险预警已处理，关联待办任务未变更。');
      setActiveTimelineType('RISK_ALERT');
      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '风险预警处理失败，请稍后重试。'));
    } finally {
      setProcessingActionId(null);
    }
  }

  async function submitFollowUp(event: FormEvent) {
    event.preventDefault();
    if (!patientId || savingFollowUp) return;

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
      setError(getApiErrorMessage(err, '随访记录保存失败，请稍后重试。'));
    } finally {
      setSavingFollowUp(false);
    }
  }

  async function submitRiskDispositionAction(event: FormEvent) {
    event.preventDefault();
    if (!patientId || processingActionId) return;

    const alertId = selectedRiskAlertId || activeRiskAlerts[0]?.data?.id;
    if (!alertId) {
      setError('当前没有可处置的未处理风险预警。');
      return;
    }

    const signature = riskDispositionSignature.trim();
    if (!signature) {
      setError('请先填写电子签名，再提交风险处置。');
      return;
    }

    const selectedActions = riskDispositionActions.length ? riskDispositionActions : ['FOLLOW_UP'];
    if (selectedActions.includes('MEDICATION') && (!riskMedicationName.trim() || !riskMedicationDosage.trim())) {
      setError('已选择修改/增加用药，请填写药品名称和剂量。');
      return;
    }

    resetNotice();
    setProcessingActionId(`risk-${alertId}-combined-disposition`);

    try {
      const note = riskDispositionNote.trim() || buildRiskDispositionDraft(selectedActions, activeRiskAlerts.find((item) => item.data?.id === alertId));
      const instruction = riskDispositionInstruction.trim() || buildRiskDispositionInstruction(selectedActions);
      const actionLabels = selectedActions.map((action) => riskDispositionActionLabelMap[action]).filter(Boolean);

      if (selectedActions.includes('URGENT_VISIT')) {
        await api.post(`/patients/${patientId}/hospital-visit-reminders`, {
          sourceRiskAlertId: alertId,
          reason: '基于当前风险预警，提醒患者立即前往医院或门急诊评估',
          note: `${note}；交代内容：${instruction}；电子签名：${signature}`,
          electronicSignature: signature,
        });
      }

      if (selectedActions.includes('MEDICATION')) {
        await api.post(`/patients/${patientId}/medications`, {
          medicationName: riskMedicationName.trim(),
          dosage: riskMedicationDosage.trim(),
          frequency: '按处置记录执行',
          frequencyUnit: 'DAY',
          timesPerUnit: 1,
          timingRelation: 'NONE',
          customDoseTimes: [],
          instructions: riskMedicationInstructions.trim() || instruction,
          dataSource: 'NURSE_INPUT',
          isActive: true,
        });
      }

      if (selectedActions.includes('RECHECK_TASK')) {
        const hours = Math.max(1, Number(riskRecheckDueHours) || 4);
        const dueAt = new Date();
        dueAt.setHours(dueAt.getHours() + hours);

        await api.post(`/patients/${patientId}/tasks`, {
          title: `异常指标复测提醒（${hours}小时内）`,
          type: 'RECHECK_REMINDER',
          dueAt: dueAt.toISOString(),
          assigneeId: nurseId,
          relatedAlertId: alertId,
        });
      }

      if (selectedActions.includes('FOLLOW_UP')) {
        await api.post(`/patients/${patientId}/follow-ups`, {
          followUpType: 'PHONE',
          followUpTime: new Date().toISOString(),
          content: riskFollowUpContent.trim() || note,
          result: riskFollowUpResult.trim() || '已完成风险预警电话复核。',
          suggestion: riskFollowUpSuggestion.trim() || instruction,
          operatorId: nurseId,
        });
      }

      await api.patch(`/risk-alerts/${alertId}/resolve`, {
        handledBy: nurseId,
        handlingNote: [
          `处置方式：${actionLabels.join('、')}`,
          `处置记录：${note}`,
          instruction ? `交代内容：${instruction}` : '',
          `电子签名：${signature}`,
          syncRelatedTasksOnRiskResolve ? '同步结果：已确认一并完成关联待办任务' : '同步结果：暂不变更关联待办任务',
        ].filter(Boolean).join('；'),
        syncRelatedTasks: syncRelatedTasksOnRiskResolve,
      });

      setMessage('风险处置已提交，相关预警已自动标记为已处理。');
      setRiskDispositionActions(['FOLLOW_UP']);
      setRiskDispositionNote('');
      setRiskDispositionInstruction('');
      setRiskDispositionAutoDraft('');
      setRiskDispositionSignature('');
      setRiskMedicationName('');
      setRiskMedicationDosage('');
      setRiskMedicationInstructions('');
      setRiskRecheckDueHours('4');
      setRiskFollowUpContent('');
      setRiskFollowUpResult('');
      setRiskFollowUpSuggestion('');
      setSyncRelatedTasksOnRiskResolve(true);
      setActiveTimelineType('RISK_ALERT');
      await loadTimeline();
    } catch (err) {
      console.error(err);
      setError(getApiErrorMessage(err, '风险处置提交失败，请稍后重试。'));
    } finally {
      setProcessingActionId(null);
    }
  }

  async function cleanupTestData() {
    if (!patientId || cleaningTestData) return;

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
      setError(getApiErrorMessage(err, '测试流水清理失败。请确认后端已启动，且 NODE_ENV 不是 production。'));
    } finally {
      setCleaningTestData(false);
    }
  }

  if (loading && !data) {
    return <div className="loading-state">正在加载患者长期健康档案...</div>;
  }

  if (!data) {
    return (
      <div className="business-page patient-detail-page">
        <section className="panel patient-detail-missing-state">
          <div className="missing-state-icon">档</div>
          <div>
            <div className="page-kicker">患者详情加载失败</div>
            <h1>未能打开该患者档案</h1>
            <p>
              {error || '系统没有返回患者长期健康档案。请从患者主索引重新进入，避免使用过期链接或院内号替代平台患者 ID。'}
            </p>
            <div className="missing-state-actions">
              <Link className="primary-btn compact-link-btn" to="/patients">
                返回患者主索引
              </Link>
              <button className="secondary-btn" type="button" onClick={loadTimeline}>
                重新加载
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const { patient } = data;
  const diseaseProfileCount = data.timeline.filter((item) => item.type === 'DISEASE_PROFILE').length;
  const activeRiskAlertCount = data.timeline.filter(
    (item) => item.type === 'RISK_ALERT' && item.data?.status === 'OPEN',
  ).length;
  const activeTaskCount = data.timeline.filter(
    (item) => item.type === 'TASK' && item.data?.status === 'PENDING',
  ).length;
  const followUpCount = data.timeline.filter((item) => item.type === 'FOLLOW_UP').length;
  const recentVitalCount = data.timeline.filter((item) => item.type === 'VITAL_RECORD').length;
  const questionnaireCount = data.timeline.filter((item) => item.type === 'QUESTIONNAIRE_RESULT').length;
  const activeRiskAlerts = data.timeline.filter(
    (item) => item.type === 'RISK_ALERT' && item.data?.status === 'OPEN',
  );
  const activeTasks = data.timeline.filter(
    (item) => item.type === 'TASK' && item.data?.status === 'PENDING',
  );
  const activeTaskRelatedAlertIds = new Set(
    activeTasks.map((item) => item.data?.relatedAlertId).filter(Boolean) as string[],
  );
  const riskAlertById = new Map(activeRiskAlerts.map((item) => [item.data?.id, item]));
  const alertOnlyRiskAlerts = activeRiskAlerts.filter((item) => !activeTaskRelatedAlertIds.has(item.data?.id));
  const unifiedOpenItemCount = activeTasks.length + alertOnlyRiskAlerts.length;
  const firstOpenTask = activeTasks[0];
  const firstAlertOnly = alertOnlyRiskAlerts[0];
  const defaultTaskProcessingUrl = firstOpenTask?.data?.id
    ? `/patients/${patientId}/task-processing?taskId=${firstOpenTask.data.id}&mode=phone`
    : `/patients/${patientId}/task-processing`;
  const diseaseProfileTimeline = data.timeline.filter((item) => item.type === 'DISEASE_PROFILE');
  const vitalRecordTimeline = data.timeline.filter((item) => item.type === 'VITAL_RECORD');
  const selectedRiskAlert = activeRiskAlerts.find((item) => item.data?.id === selectedRiskAlertId) ?? activeRiskAlerts[0];
  const selectedRiskAlertRelatedTasks = activeTasks.filter((item) => item.data?.relatedAlertId === selectedRiskAlert?.data?.id);
  const selectedRiskAlertRelatedTask = selectedRiskAlertRelatedTasks[0];
  const recentVitals = vitalRecordTimeline.slice(0, 4);
  const latestDiseaseProfile = data.timeline.find((item) => item.type === 'DISEASE_PROFILE');
  const latestQuestionnaire = data.timeline.find((item) => item.type === 'QUESTIONNAIRE_RESULT');
  const commandEmptyText = unifiedOpenItemCount
    ? '任务、风险预警已合并为统一处置队列。先进入任务处理页，再选择电话随访、复测任务或计划调整。'
    : '当前没有待处理任务；风险预警已处置或未触发。可继续维护监测、用药和随访计划。';

  function getWorkspaceCount(key: PatientDetailWorkspace) {
    if (key === 'overview') return unifiedOpenItemCount;
    if (key === 'actions') return unifiedOpenItemCount;
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
          {unifiedOpenItemCount > 0 ? (
            firstOpenTask?.data?.id ? (
              <Link className="primary-btn compact-link-btn" to={defaultTaskProcessingUrl}>
                处理当前任务（{unifiedOpenItemCount}）
              </Link>
            ) : (
              <button
                className="primary-btn compact-link-btn"
                type="button"
                disabled={!firstAlertOnly || processingActionId !== null}
                onClick={() => firstAlertOnly && startRiskAlertTaskFromDetail(firstAlertOnly)}
              >
                生成任务并处理（{unifiedOpenItemCount}）
              </button>
            )
          ) : (
            <Link className="secondary-btn compact-link-btn" to={defaultTaskProcessingUrl}>
              查看任务处理页
            </Link>
          )}
          <button className="secondary-btn" type="button" onClick={loadTimeline} disabled={loading}>
            {loading ? '刷新中...' : '刷新档案'}
          </button>
        </div>
      </div>

      {message && <div className="notice-success operation-inline-success" role="status">{message}</div>}
      {error && <div className="notice-error operation-inline-error" role="alert">{error}</div>}

      {activeHospitalVisitReminders.length > 0 && (
        <section className="patient-hospital-visit-banner" role="status">
          <div>
            <strong>已提示该患者立即前往医院</strong>
            <p>{activeHospitalVisitReminders[0]?.reason}</p>
          </div>
          <div className="patient-hospital-visit-banner-actions">
            <button
              className="secondary-btn compact-link-btn"
              type="button"
              disabled={processingActionId !== null}
              onClick={async () => {
                const target = activeHospitalVisitReminders[0];
                if (!target) return;
                const note = window.prompt('请输入撤销到院提醒的原因，将写入后台日志：');
                if (note === null) return;
                setProcessingActionId(target.id);
                resetNotice();
                try {
                  await api.patch(`/hospital-visit-reminders/${target.id}/revoke`, { note: note.trim() || '护士在患者详情页撤销到院提醒' });
                  setMessage('到院提醒已撤销，后台已留痕。');
                  await loadTimeline();
                } catch (err) {
                  console.error(err);
                  setError(getApiErrorMessage(err, '撤销到院提醒失败，请稍后重试。'));
                } finally {
                  setProcessingActionId(null);
                }
              }}
            >
              撤销
            </button>
            <Link className="primary-btn compact-link-btn" to="/hospital-visit-reminders">
              查看详情
            </Link>
          </div>
        </section>
      )}

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
            <span>患者主索引</span>
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


          <section className="patient-module-summary-grid stable-summary-grid patient-overview-click-grid" aria-label="患者关键管理状态">
            <button type="button" className="patient-summary-nav-card" onClick={() => setActiveWorkspace('disease')}>
              <span>慢病档案</span>
              <strong>{diseaseProfileCount}</strong>
              <p>{latestDiseaseProfile ? `最近：${diseaseLabelMap[latestDiseaseProfile.data?.diseaseType] ?? latestDiseaseProfile.data?.diseaseType}` : '尚未建档'}</p>
              <em>点击进入慢病档案</em>
            </button>
            <button
              type="button"
              className={unifiedOpenItemCount > 0 ? 'patient-summary-nav-card summary-card-focus' : 'patient-summary-nav-card'}
              onClick={() => {
                if (firstOpenTask?.data?.id) {
                  navigate(defaultTaskProcessingUrl);
                } else if (firstAlertOnly) {
                  startRiskAlertTaskFromDetail(firstAlertOnly);
                } else {
                  navigate(defaultTaskProcessingUrl);
                }
              }}
            >
              <span>统一待处理任务</span>
              <strong>{unifiedOpenItemCount}</strong>
              <p>{unifiedOpenItemCount ? '任务、预警、复测提醒合并到一个处理入口。' : '暂无待处理任务。'}</p>
              <em>点击进入任务处理页</em>
            </button>
            <button type="button" className="patient-summary-nav-card" onClick={() => { setActiveWorkspace('monitoring'); setActiveTimelineType('VITAL_RECORD'); }}>
              <span>指标记录</span>
              <strong>{recentVitalCount}</strong>
              <p>患者端和院内录入的历史指标。</p>
              <em>点击进入指标监测</em>
            </button>
            <button type="button" className="patient-summary-nav-card" onClick={() => setActiveWorkspace('medication')}>
              <span>用药计划</span>
              <strong>{activeMedicationTimeline.length}</strong>
              <p>当前启用中的院内用药计划。</p>
              <em>点击进入用药计划</em>
            </button>
            <button type="button" className="patient-summary-nav-card" onClick={() => { setActiveWorkspace('timeline'); setActiveTimelineType('QUESTIONNAIRE_RESULT'); }}>
              <span>问卷记录</span>
              <strong>{questionnaireCount}</strong>
              <p>{latestQuestionnaire ? `最近评分 ${latestQuestionnaire.data?.score ?? '-'} 分` : '等待患者端提交。'}</p>
              <em>点击查看问卷记录</em>
            </button>
          </section>

          <section className="stable-command-board unified-patient-task-board" aria-label="统一任务处理队列">
            <div className="stable-command-board-header">
              <div>
                <span>统一任务处理中心</span>
                <h2>当前待处理任务</h2>
                <p>{commandEmptyText}</p>
              </div>
              <div className="stable-command-actions">
                {firstOpenTask?.data?.id ? (
                  <Link className="button" to={defaultTaskProcessingUrl}>进入任务处理页</Link>
                ) : firstAlertOnly ? (
                  <button
                    className="button"
                    type="button"
                    disabled={processingActionId !== null}
                    onClick={() => startRiskAlertTaskFromDetail(firstAlertOnly)}
                  >
                    生成任务并处理
                  </button>
                ) : (
                  <Link className="secondary-button" to={defaultTaskProcessingUrl}>查看任务处理页</Link>
                )}
                <button className="secondary-button" type="button" onClick={() => { setActiveWorkspace('timeline'); setActiveTimelineType('TASK'); }}>查看任务时间轴</button>
              </div>
            </div>

            <div className="stable-command-grid unified-command-grid">
              <article className="stable-command-card unified-command-card-main">
                <div className="stable-command-card-title">
                  <strong>统一处置队列</strong>
                  <span>{unifiedOpenItemCount} 条</span>
                </div>
                {unifiedOpenItemCount === 0 ? (
                  <p className="stable-empty-line">当前没有未完成任务。风险预警已不再作为单独处置队列展示。</p>
                ) : (
                  <div className="stable-mini-list unified-mini-list">
                    {activeTasks.slice(0, 5).map((item) => {
                      const relatedAlert = item.data?.relatedAlertId ? riskAlertById.get(item.data.relatedAlertId) : null;
                      return (
                        <div className="stable-mini-row unified-mini-row" key={item.data?.id ?? `${item.time}-${item.title}`}>
                          <div>
                            <strong>{localizeBackendText(item.title)}</strong>
                            <p>
                              {taskTypeLabelMap[item.data?.type] ?? item.data?.type} · 截止 {formatTime(item.data?.dueAt)}
                              {relatedAlert ? ` · ${riskLabelMap[relatedAlert.data?.riskLevel] ?? relatedAlert.data?.riskLevel}预警已合并` : ''}
                            </p>
                            {relatedAlert && (
                              <small>风险依据：{localizeBackendText(relatedAlert.title)}{relatedAlert.data?.triggerRule ? ` · ${localizeBackendText(relatedAlert.data.triggerRule)}` : ''}</small>
                            )}
                          </div>
                          <Link className="timeline-action-button primary" to={`/patients/${patientId}/task-processing?taskId=${item.data?.id}&mode=phone`}>
                            处理任务
                          </Link>
                        </div>
                      );
                    })}
                    {alertOnlyRiskAlerts.slice(0, Math.max(0, 5 - activeTasks.length)).map((item) => (
                      <div className="stable-mini-row unified-mini-row alert-only-inline-row" key={item.data?.id ?? `${item.time}-${item.title}`}>
                        <div>
                          <strong>{localizeBackendText(item.title)}</strong>
                          <p>{riskLabelMap[item.data?.riskLevel] ?? item.data?.riskLevel}预警 · 尚未生成随访任务 · {formatTime(item.time)}</p>
                          <small>{item.data?.triggerRule ? `风险依据：${localizeBackendText(item.data.triggerRule)}` : '点击后会自动生成风险随访任务，并进入统一任务处理页。'}</small>
                        </div>
                        <button
                          className="timeline-action-button primary"
                          type="button"
                          disabled={processingActionId !== null}
                          onClick={() => startRiskAlertTaskFromDetail(item)}
                        >
                          生成任务并处理
                        </button>
                      </div>
                    ))}
                    {unifiedOpenItemCount > 5 && <p className="stable-more-line">另有 {unifiedOpenItemCount - 5} 条事项，请进入任务处理页逐项处理。</p>}
                  </div>
                )}
              </article>

              <article className="stable-command-card">
                <div className="stable-command-card-title">
                  <strong>最近健康指标</strong>
                  <span>{recentVitals.length} 条</span>
                </div>
                {recentVitals.length === 0 ? (
                  <p className="stable-empty-line">暂无患者端或院内指标记录。</p>
                ) : (
                  <div className="stable-mini-list">
                    {recentVitals.map((item) => (
                      <div className="stable-mini-row stable-mini-row-readonly" key={`${item.time}-${item.title}`}>
                        <div>
                          <strong>{vitalTypeLabelMap[item.data?.type] ?? item.data?.type}</strong>
                          <p>{item.data?.value} {item.data?.unit} · {item.data?.isAbnormal ? '异常' : '正常'} · {formatTime(item.time)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            </div>
          </section>
        </>
      )}

      {false && activeWorkspace === 'actions' && (
        <>
          <section className="panel patient-action-workspace unified-risk-disposal-panel">
            <div className="hospital-section-header">
              <div>
                <span>护士风险处置中心</span>
                <h2>风险处置</h2>
                <p className="section-hint">先选择需要处置的风险预警，再勾选处置方式。提交处置后，该风险预警会自动标记为已处理。普通待办任务和风险随访任务统一进入患者任务处理页。</p>
              </div>
              <div className="action-workspace-header-metrics">
                <span>未处理预警 <strong>{activeRiskAlertCount}</strong></span>
                <span>当前待办 <strong>{activeTaskCount}</strong></span>
              </div>
            </div>

            {activeRiskAlerts.length === 0 ? (
              <div className="empty-state">当前没有未处理风险预警。</div>
            ) : (
              <div className="unified-risk-layout">
                <aside className="risk-alert-selector" aria-label="选择需要处置的风险预警">
                  <div className="risk-alert-selector-title">选择风险预警</div>
                  {activeRiskAlerts.map((item) => {
                    const isSelected = (selectedRiskAlert?.data?.id ?? '') === item.data?.id;
                    return (
                      <button
                        key={item.data?.id ?? `${item.time}-${item.title}`}
                        type="button"
                        className={isSelected ? 'risk-alert-select-card active' : 'risk-alert-select-card'}
                        onClick={() => item.data?.id && selectRiskAlert(item.data.id)}
                      >
                        <span className={getRiskClass(item.data?.riskLevel ?? '')}>{riskLabelMap[item.data?.riskLevel] ?? item.data?.riskLevel}</span>
                        <strong>{localizeBackendText(item.title)}</strong>
                        <small>{formatTime(item.time)}</small>
                      </button>
                    );
                  })}
                </aside>

                <form className="risk-disposition-form unified-risk-form" onSubmit={submitRiskDispositionAction}>
                  {selectedRiskAlert && (
                    <section className="selected-risk-card">
                      <div>
                        <span>当前处置对象</span>
                        <h3>{localizeBackendText(selectedRiskAlert.title)}</h3>
                        <p>{localizeBackendText(selectedRiskAlert.description)}</p>
                        <div className="timeline-extra">
                          状态：{statusLabelMap[selectedRiskAlert.data?.status] ?? selectedRiskAlert.data?.status} · 时间：{formatTime(selectedRiskAlert.time)}
                          {selectedRiskAlert.data?.triggerRule ? ` · 触发规则：${localizeBackendText(selectedRiskAlert.data.triggerRule)}` : ''}
                        </div>
                      </div>
                      {selectedRiskAlertRelatedTask ? (
                        <Link className="timeline-action-button" to={`/patients/${patientId}/task-processing?taskId=${selectedRiskAlertRelatedTask.data?.id}&mode=phone`}>
                          进入统一任务处理页
                        </Link>
                      ) : (
                        <span className="timeline-action-hint">如需电话联系，可勾选“电话随访沟通”并在本页记录。</span>
                      )}
                    </section>
                  )}

                  <section className="risk-action-checklist" aria-label="选择风险处置方式">
                    {[
                      { value: 'URGENT_VISIT', title: '提醒患者立即到院', desc: '向患者端发送醒目到院提醒，并在护士工作台和患者详情页显示提示横幅。' },
                      { value: 'MEDICATION', title: '修改/增加用药', desc: '在本页记录新的用药计划或用药调整建议。' },
                      { value: 'RECHECK_TASK', title: '新增复测任务', desc: '为患者创建异常指标复测待办。' },
                      { value: 'FOLLOW_UP', title: '电话随访沟通', desc: '记录电话沟通内容、患者反馈和护理建议。' },
                    ].map((item) => (
                      <label className={riskDispositionActions.includes(item.value) ? 'risk-action-check selected' : 'risk-action-check'} key={item.value}>
                        <input
                          type="checkbox"
                          checked={riskDispositionActions.includes(item.value)}
                          onChange={() => toggleRiskDispositionAction(item.value)}
                        />
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.desc}</small>
                        </span>
                      </label>
                    ))}
                  </section>

                  {riskDispositionActions.includes('URGENT_VISIT') && (
                    <section className="risk-expanded-section urgent-section">
                      <h3>到院提醒内容</h3>
                      <p>提交后患者端将显示醒目的到院提醒；护士工作台和患者详情页会显示“已提醒到院”横幅。该动作不是普通待办任务。</p>
                    </section>
                  )}

                  {riskDispositionActions.includes('MEDICATION') && (
                    <section className="risk-expanded-section">
                      <h3>用药计划记录</h3>
                      <div className="form-grid">
                        <label>
                          药品名称 <span className="required-mark">*</span>
                          <input value={riskMedicationName} onChange={(event) => setRiskMedicationName(event.target.value)} placeholder="例如：二甲双胍片" />
                        </label>
                        <label>
                          剂量 <span className="required-mark">*</span>
                          <input value={riskMedicationDosage} onChange={(event) => setRiskMedicationDosage(event.target.value)} placeholder="例如：500mg" />
                        </label>
                      </div>
                      <label>
                        用药交代 / 修改记录
                        <textarea
                          value={riskMedicationInstructions}
                          onChange={(event) => setRiskMedicationInstructions(event.target.value)}
                          rows={3}
                          placeholder="系统会根据处置方式自动生成初稿，也可由护士修改。"
                        />
                      </label>
                    </section>
                  )}

                  {riskDispositionActions.includes('RECHECK_TASK') && (
                    <section className="risk-expanded-section">
                      <h3>复测任务</h3>
                      <label>
                        复测截止时间
                        <select value={riskRecheckDueHours} onChange={(event) => setRiskRecheckDueHours(event.target.value)}>
                          <option value="2">2 小时内</option>
                          <option value="4">4 小时内</option>
                          <option value="8">8 小时内</option>
                          <option value="24">24 小时内</option>
                        </select>
                      </label>
                    </section>
                  )}

                  {riskDispositionActions.includes('FOLLOW_UP') && (
                    <section className="risk-expanded-section">
                      <h3>电话随访记录</h3>
                      <label>
                        电话沟通内容
                        <textarea value={riskFollowUpContent} onChange={(event) => setRiskFollowUpContent(event.target.value)} rows={3} />
                      </label>
                      <label>
                        患者反馈 / 随访结果
                        <textarea value={riskFollowUpResult} onChange={(event) => setRiskFollowUpResult(event.target.value)} rows={3} />
                      </label>
                      <label>
                        护理建议 / 后续安排
                        <textarea value={riskFollowUpSuggestion} onChange={(event) => setRiskFollowUpSuggestion(event.target.value)} rows={3} />
                      </label>
                    </section>
                  )}

                  <section className="risk-disposition-submit-card unified-submit-card">
                    <label>
                      处置记录
                      <textarea
                        value={riskDispositionNote}
                        onChange={(event) => setRiskDispositionNote(event.target.value)}
                        placeholder="系统会根据所选处置方式自动生成初稿，也可由护士修改。"
                        rows={3}
                      />
                    </label>
                    <label>
                      交代内容
                      <textarea
                        value={riskDispositionInstruction}
                        onChange={(event) => setRiskDispositionInstruction(event.target.value)}
                        placeholder="例如：复测要求、危险症状、用药注意事项、复诊安排。"
                        rows={3}
                      />
                    </label>
                    <label>
                      电子签名 <span className="required-mark">*</span>
                      <input
                        value={riskDispositionSignature}
                        onChange={(event) => setRiskDispositionSignature(event.target.value)}
                        placeholder="请输入护士姓名 / 工号作为电子签名"
                        required
                      />
                    </label>
                    {selectedRiskAlertRelatedTasks.length > 0 && (
                      <label className="task-complete-check relation-sync-check">
                        <input
                          type="checkbox"
                          checked={syncRelatedTasksOnRiskResolve}
                          onChange={(event) => setSyncRelatedTasksOnRiskResolve(event.target.checked)}
                        />
                        提交风险处置后，同步将绑定的 {selectedRiskAlertRelatedTasks.length} 条待办任务标记为已完成
                      </label>
                    )}
                    <div className="risk-submit-row">
                      <button className="button risk-submit-button" type="submit" disabled={processingActionId !== null}>
                        {processingActionId ? '提交中...' : '提交处置并标记已处理'}
                      </button>
                      <button
                        className="timeline-action-button danger subtle-danger"
                        type="button"
                        disabled={processingActionId !== null || !riskDispositionSignature.trim() || !selectedRiskAlert}
                        onClick={() => selectedRiskAlert?.data?.id && dismissSelectedRiskAlert(selectedRiskAlert.data.id)}
                      >
                        忽略/误报
                      </button>
                    </div>
                    <p className="section-hint">处置方式不会通过单击卡片直接提交；必须勾选处置方式、填写电子签名后提交。</p>
                  </section>
                </form>
              </div>
            )}
          </section>

          <p className="task-routing-small-note">待办任务请进入统一任务处理页</p>
        </>
      )}

      {activeWorkspace === 'disease' && (
        <>
          <section className="panel record-list-panel collapsible-workspace-panel">
            <div className="hospital-section-header">
              <div>
                <span>慢病档案</span>
                <h2>患者已有慢病档案</h2>
                <p className="section-hint">先查看已有诊断和风险分层；需要补录时再展开新增表单。</p>
              </div>
              <button className="button" type="button" onClick={() => setShowDiseaseForm((value) => !value)}>
                {showDiseaseForm ? '收起新增慢病档案' : '新增慢病档案'}
              </button>
            </div>

            {diseaseProfileTimeline.length === 0 ? (
              <div className="empty-state task-empty-state">当前患者尚未建立慢病档案。</div>
            ) : (
              <div className="task-inline-grid disease-profile-grid">
                {diseaseProfileTimeline.map((item) => (
                  <article className="task-inline-card disease-profile-card" key={item.data?.id ?? `${item.time}-${item.title}`}>
                    <div className="task-inline-card-topline">
                      <span className="badge">{dataSourceLabelMap[item.data?.dataSource] ?? item.data?.dataSource ?? '院内录入'}</span>
                      <span className={getRiskClass(item.data?.riskLevel ?? '')}>{riskLabelMap[item.data?.riskLevel] ?? item.data?.riskLevel ?? '未分层'}</span>
                    </div>
                    <h4>{diseaseLabelMap[item.data?.diseaseType] ?? localizeBackendText(item.title)}</h4>
                    <p>确诊日期：{item.data?.diagnosisDate ? formatTime(item.data.diagnosisDate) : '-'}</p>
                    {item.data?.diseaseStage && <p>病情说明：{localizeBackendText(item.data.diseaseStage)}</p>}
                    {item.data?.complications && <p>并发症：{localizeBackendText(item.data.complications)}</p>}
                    {item.data?.comorbidities && <p>合并症：{localizeBackendText(item.data.comorbidities)}</p>}
                  </article>
                ))}
              </div>
            )}
          </section>

          {showDiseaseForm && (
            <section className="panel form-panel collapsible-form-card">
              <div className="hospital-section-header">
                <div>
                  <span>慢病档案</span>
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

              <form className="hospital-form" onSubmit={submitDiseaseProfile} aria-busy={savingDiseaseProfile}>
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
                    {savingDiseaseProfile ? '保存中，请勿重复提交...' : '保存慢病档案'}
                  </button>
                  <button className="secondary-button" type="button" onClick={() => setShowDiseaseForm(false)} disabled={savingDiseaseProfile}>取消</button>
                  <span className="operation-form-hint">保存成功后表单会自动收起，并刷新患者时间轴。</span>
                </div>
              </form>
            </section>
          )}
        </>
      )}

      {activeWorkspace === 'monitoring' && (
        <>
          <section className="panel record-list-panel collapsible-workspace-panel">
            <div className="hospital-section-header">
              <div>
                <span>指标监测</span>
                <h2>健康指标与打卡计划</h2>
                <p className="section-hint">先查看已有指标和医院配置的打卡计划；新增操作通过按钮展开，提交后自动收起。</p>
              </div>
              <div className="patient-hero-actions">
                <button className="button" type="button" onClick={() => setShowVitalForm((value) => !value)}>
                  {showVitalForm ? '收起新增健康指标' : '新增健康指标'}
                </button>
                <button className="secondary-button" type="button" onClick={() => setShowMonitoringPlanForm((value) => !value)}>
                  {showMonitoringPlanForm ? '收起打卡计划表单' : '配置指标打卡计划'}
                </button>
              </div>
            </div>

            <div className="task-inline-list medication-inline-list">
              <div className="task-inline-list-header medication-list-header">
                <div>
                  <h3>近期健康指标</h3>
                  <p className="muted small">院内录入、患者小程序和 LIS 同步的指标统一进入这里。</p>
                </div>
              </div>
              {vitalRecordTimeline.length === 0 ? (
                <div className="empty-state task-empty-state">当前患者暂无健康指标记录。</div>
              ) : (
                <div className="task-inline-grid">
                  {vitalRecordTimeline.slice(0, 8).map((item) => (
                    <article className="task-inline-card metric-inline-card" key={item.data?.id ?? `${item.time}-${item.title}`}>
                      <div className="task-inline-card-topline">
                        <span className="badge">{vitalTypeLabelMap[item.data?.type] ?? item.data?.type ?? '指标'}</span>
                        <span className={item.data?.isAbnormal ? 'status-badge status-high' : 'status-badge status-low'}>{item.data?.isAbnormal ? '异常' : '正常'}</span>
                      </div>
                      <h4>{item.data?.value ?? '-'} {item.data?.unit ?? ''}</h4>
                      <p>测量时间：{formatTime(item.data?.measuredAt ?? item.time)} · 来源：{dataSourceLabelMap[item.data?.dataSource] ?? item.data?.dataSource ?? '-'}</p>
                      {item.data?.note && <p>{localizeBackendText(item.data.note)}</p>}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          {showVitalForm && (
            <section className="panel form-panel collapsible-form-card">
              <div className="hospital-section-header">
                <div>
                  <span>健康指标记录</span>
                  <h2>新增健康指标</h2>
                </div>
                <p className="section-hint">系统会按阈值自动判定异常并生成风险预警，通常无需手动勾选异常。</p>
              </div>

              <form className="hospital-form" onSubmit={submitVitalRecord} aria-busy={savingVital}>
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
                        <option key={item.data?.id} value={item.data?.id}>{item.data?.displayName ?? item.title}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row checkbox-row">
                  <label>
                    <input type="checkbox" checked={manualAbnormal} onChange={(event) => setManualAbnormal(event.target.checked)} />
                    人工强制标记异常
                  </label>
                  <span className="auto-rule-note">自动规则：由医院规则配置后台统一维护。</span>
                </div>

                <div className="form-row">
                  <label>备注</label>
                  <textarea value={vitalNote} onChange={(event) => setVitalNote(event.target.value)} placeholder="例如：门诊录入，患者自述近期血压偏高" />
                </div>

                <div className="form-actions">
                  <button className="button" type="submit" disabled={savingVital}>{savingVital ? '保存中，请勿重复提交...' : '保存健康指标'}</button>
                  <button className="secondary-button" type="button" onClick={() => setShowVitalForm(false)} disabled={savingVital}>取消</button>
                  <span className="operation-form-hint">保存后系统会立即检查风险规则，命中时自动生成预警和待办。</span>
                </div>
              </form>
            </section>
          )}

          {showMonitoringPlanForm && (
            <section className="panel form-panel collapsible-form-card">
              <div className="hospital-section-header">
                <div>
                  <span>指标打卡计划</span>
                  <h2>{editingMonitoringPlanId ? '修改指标打卡计划' : '配置指标打卡计划'}</h2>
                </div>
                <div className="patient-hero-actions">
                  <button className="secondary-button" type="button" onClick={loadMonitoringRecommendations} disabled={loadingRecommendations}>{loadingRecommendations ? '生成中...' : '根据慢病档案推荐'}</button>
                  <button className="secondary-button" type="button" onClick={() => applyRecommendedMonitoringPlans(false)} disabled={savingMonitoringPlan}>一键应用推荐</button>
                </div>
              </div>

              <p className="section-hint">指标打卡计划由医院端维护。患者端只按计划录入，系统显示下一次打卡时间。</p>

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

              <form className="hospital-form" onSubmit={submitMonitoringPlan} aria-busy={savingMonitoringPlan}>
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
                  <div className="form-row"><label>显示名称</label><input value={monitoringDisplayName} onChange={(event) => setMonitoringDisplayName(event.target.value)} required /></div>
                  <div className="form-row"><label>单位</label><input value={monitoringUnit} onChange={(event) => setMonitoringUnit(event.target.value)} required /></div>
                  <div className="form-row">
                    <label>频次单位</label>
                    <select value={monitoringFrequencyUnit} onChange={(event) => setMonitoringFrequencyUnit(event.target.value)}>
                      <option value="DAY">日</option><option value="WEEK">周</option><option value="MONTH">月</option>
                    </select>
                  </div>
                  <div className="form-row"><label>每单位次数</label><input type="number" min="1" max={monitoringFrequencyUnit === 'DAY' ? 12 : monitoringFrequencyUnit === 'WEEK' ? 7 : 31} value={monitoringTimesPerUnit} onChange={(event) => setMonitoringTimesPerUnit(event.target.value)} required /></div>
                  <div className="form-row"><label>自定义测量时间</label><input value={monitoringCustomMeasureTimes} onChange={(event) => setMonitoringCustomMeasureTimes(event.target.value)} placeholder="例如：07:30, 19:30" /></div>
                  <div className="form-row"><label>{monitoringFrequencyUnit === 'WEEK' ? '自定义测量星期' : monitoringFrequencyUnit === 'MONTH' ? '自定义测量日期' : '自定义测量日'}</label><input disabled={monitoringFrequencyUnit === 'DAY'} value={monitoringCustomMeasureDays} onChange={(event) => setMonitoringCustomMeasureDays(event.target.value)} placeholder={monitoringFrequencyUnit === 'WEEK' ? '1=周一，7=周日；例如：1,4' : monitoringFrequencyUnit === 'MONTH' ? '1-31；例如：1,15' : '每日监测无需填写'} /></div>
                </div>

                <div className="form-row"><label>配置依据 / 医嘱说明</label><textarea value={monitoringEvidenceBasis} onChange={(event) => setMonitoringEvidenceBasis(event.target.value)} placeholder="例如：高血压患者早晚各监测 1 次" /></div>

                <div className="form-actions">
                  <button className="button" type="submit" disabled={savingMonitoringPlan}>{savingMonitoringPlan ? '保存中，请勿重复提交...' : editingMonitoringPlanId ? '保存修改' : '保存打卡计划'}</button>
                  <button className="secondary-button" type="button" onClick={() => { resetMonitoringPlanForm(); setShowMonitoringPlanForm(false); }} disabled={savingMonitoringPlan}>取消</button>
                </div>
              </form>
            </section>
          )}

          <section className="panel form-panel">
            <div className="task-inline-list medication-inline-list">
              <div className="task-inline-list-header medication-list-header">
                <div>
                  <h3>当前指标打卡计划</h3>
                  <p className="muted small">这些计划会同步到患者小程序，用于提醒和漏测判断。</p>
                </div>
                <label className="history-toggle medication-history-toggle">
                  <input type="checkbox" checked={showInactiveMonitoringPlans} onChange={(event) => setShowInactiveMonitoringPlans(event.target.checked)} />
                  显示停用/历史计划{inactiveMonitoringPlanCount ? `（${inactiveMonitoringPlanCount}）` : ''}
                </label>
              </div>
              {visibleMonitoringPlanTimeline.length === 0 ? (
                <div className="empty-state task-empty-state">当前患者暂无指标打卡计划。</div>
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
                      <p>测量时间：{Array.isArray(item.data?.customMeasureTimes) && item.data.customMeasureTimes.length ? item.data.customMeasureTimes.join('、') : '系统自动均摊'}</p>
                      {item.data?.evidenceBasis && <p>依据：{item.data.evidenceBasis}</p>}
                      <div className="timeline-extra">最近打卡：{formatTime(item.data?.lastCheckInAt)}</div>
                      <div className="medication-card-actions">
                        <button className="secondary-button compact-button" type="button" onClick={() => startEditMonitoringPlan(item.data)}>修改计划</button>
                        <button className="danger-outline-button compact-button" type="button" disabled={monitoringPlanActionId === item.data?.id} onClick={() => deleteMonitoringPlan(item.data)}>{monitoringPlanActionId === item.data?.id ? '处理中...' : '删除/停用'}</button>
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
          <section className="panel record-list-panel collapsible-workspace-panel">
            <div className="hospital-section-header">
              <div>
                <span>院内用药计划</span>
                <h2>当前用药计划</h2>
                <p className="section-hint">先查看患者已有用药计划；新增或修改时再展开表单。</p>
              </div>
              <button className="button" type="button" onClick={() => { resetMedicationForm(); setShowMedicationForm((value) => !value); }}>
                {showMedicationForm ? '收起新增用药计划' : '新增用药计划'}
              </button>
            </div>

            <div className="task-inline-list medication-inline-list">
              <div className="task-inline-list-header medication-list-header">
                <div>
                  <h3>当前用药计划</h3>
                  <p className="muted small">这些计划会同步到患者微信小程序，患者只能按计划打卡或反馈漏服。</p>
                </div>
                <label className="history-toggle medication-history-toggle">
                  <input type="checkbox" checked={showInactiveMedications} onChange={(event) => setShowInactiveMedications(event.target.checked)} />
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
                        <button className="secondary-button compact-button" type="button" onClick={() => startEditMedication(item.data)}>修改计划</button>
                        <button className="danger-outline-button compact-button" type="button" disabled={medicationActionId === item.data?.id} onClick={() => deleteMedication(item.data)}>{medicationActionId === item.data?.id ? '处理中...' : '删除/停用'}</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          {showMedicationForm && (
            <section className="panel form-panel collapsible-form-card">
              <div className="hospital-section-header">
                <div>
                  <span>院内用药计划</span>
                  <h2>{editingMedicationId ? '修改用药计划' : '新增用药计划'}</h2>
                </div>
                <p className="section-hint">用药计划应由医生/护士或 HIS/药房处方接口维护；患者小程序只负责查看和打卡。</p>
              </div>

              {editingMedicationId && <div className="edit-mode-banner">正在修改已有用药计划。保存后会同步患者端下次用药时间；历史打卡记录会保留。</div>}

              <form className="hospital-form" onSubmit={submitMedication} aria-busy={savingMedication}>
                <div className="form-grid">
                  <div className="form-row"><label>药品名称</label><input value={medicationName} onChange={(event) => setMedicationName(event.target.value)} placeholder="例如：二甲双胍" required /></div>
                  <div className="form-row"><label>剂量</label><input value={medicationDosage} onChange={(event) => setMedicationDosage(event.target.value)} placeholder="例如：500mg" required /></div>
                  <div className="form-row"><label>频次单位</label><select value={medicationFrequencyUnit} onChange={(event) => setMedicationFrequencyUnit(event.target.value)}><option value="DAY">日</option><option value="WEEK">周</option><option value="MONTH">月</option></select></div>
                  <div className="form-row"><label>每单位次数</label><input type="number" min="1" max={medicationFrequencyUnit === 'DAY' ? 8 : medicationFrequencyUnit === 'WEEK' ? 7 : 31} value={medicationTimesPerUnit} onChange={(event) => setMedicationTimesPerUnit(event.target.value)} required /></div>
                  <div className="form-row"><label>服用时机</label><select value={medicationTimingRelation} onChange={(event) => setMedicationTimingRelation(event.target.value)}><option value="NONE">不限定</option><option value="BEFORE_MEAL">饭前服用</option><option value="AFTER_MEAL">饭后服用</option><option value="WITH_MEAL">随餐服用</option></select></div>
                  <div className="form-row"><label>来源</label><select value={medicationDataSource} onChange={(event) => setMedicationDataSource(event.target.value)}><option value="NURSE_INPUT">护士录入</option><option value="HIS">HIS/处方同步</option><option value="EMR">EMR</option><option value="MANUAL_IMPORT">人工导入</option></select></div>
                </div>

                <div className="form-grid">
                  <div className="form-row"><label>自定义服用时间（可选）</label><input value={medicationCustomDoseTimes} onChange={(event) => setMedicationCustomDoseTimes(event.target.value)} placeholder="例如：08:00, 18:00；留空则白天自动均摊" /></div>
                  <div className="form-row"><label>{medicationFrequencyUnit === 'WEEK' ? '自定义服用星期（可选）' : medicationFrequencyUnit === 'MONTH' ? '自定义服用日期（可选）' : '自定义服用日'}</label><input disabled={medicationFrequencyUnit === 'DAY'} value={medicationCustomDoseDays} onChange={(event) => setMedicationCustomDoseDays(event.target.value)} placeholder={medicationFrequencyUnit === 'WEEK' ? '1=周一，7=周日；例如：1,4' : medicationFrequencyUnit === 'MONTH' ? '1-31；例如：1,15' : '每日用药无需填写'} /></div>
                </div>

                <div className="form-row"><label>用药说明</label><textarea value={medicationInstructions} onChange={(event) => setMedicationInstructions(event.target.value)} placeholder="例如：如出现明显不适，请联系护士或复诊" /></div>

                <div className="form-actions">
                  <button className="button" type="submit" disabled={savingMedication}>{savingMedication ? '保存中，请勿重复提交...' : editingMedicationId ? '保存修改' : '保存用药计划'}</button>
                  <button className="secondary-button" type="button" onClick={() => { resetMedicationForm(); setShowMedicationForm(false); }} disabled={savingMedication}>取消</button>
                  <span className="operation-form-hint">保存成功后表单会自动收起，并同步患者端提醒和打卡规则。</span>
                </div>
              </form>
            </section>
          )}
        </>
      )}

      {false && activeWorkspace === 'care' && (
        <>
          <section className="panel record-list-panel collapsible-workspace-panel">
            <div className="hospital-section-header">
              <div>
                <span>随访任务</span>
                <h2>电话随访与待办处理</h2>
                <p className="section-hint">普通待办任务进入统一任务处理页完成闭环；风险预警已合并到任务处理页，不再作为单独处置入口。</p>
              </div>
              <button className="button" type="button" onClick={() => setShowTaskForm((value) => !value)}>
                {showTaskForm ? '收起新增任务' : '新增任务'}
              </button>
            </div>
          </section>

          {showTaskForm && (
            <section className="panel form-panel collapsible-form-card">
              <div className="hospital-section-header">
                <div>
                  <span>待办任务</span>
                  <h2>新增任务</h2>
                </div>
              </div>

              <form className="hospital-form" onSubmit={submitTask} aria-busy={savingTask}>
                <div className="form-grid form-grid-three">
                  <div className="form-row">
                    <label>任务标题</label>
                    <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="例如：明日电话随访患者血压情况" required />
                  </div>
                  <div className="form-row">
                    <label>任务类型</label>
                    <select value={taskType} onChange={(event) => setTaskType(event.target.value)}>
                      <option value="FOLLOW_UP">随访任务</option>
                      <option value="RISK_ALERT_FOLLOW_UP">风险预警随访</option>
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
                  <button className="button" type="submit" disabled={savingTask}>{savingTask ? '保存中，请勿重复提交...' : '保存任务'}</button>
                  <button className="secondary-button" type="button" onClick={() => setShowTaskForm(false)} disabled={savingTask}>取消</button>
                  <span className="operation-form-hint">任务保存成功后表单会自动收起，并刷新当前待办。</span>
                </div>
              </form>
            </section>
          )}

          <section className="panel form-panel">
            <div className="task-inline-list">
              <div className="task-inline-list-header">
                <div>
                  <h3>当前待办任务</h3>
                  <p className="muted small">待办任务需要先电话联系患者、记录内容并电子签名后完成。</p>
                  {!showAllTaskHistory && hiddenTaskHistoryCount > 0 && <p className="muted small">已默认隐藏 {hiddenTaskHistoryCount} 条已完成或已取消任务。</p>}
                </div>
                <label className="history-toggle task-history-toggle">
                  <input type="checkbox" checked={showAllTaskHistory} onChange={(event) => setShowAllTaskHistory(event.target.checked)} />
                  显示已完成/已取消任务
                </label>
              </div>

              {visibleTaskTimeline.length === 0 ? (
                <div className="empty-state task-empty-state">{taskTimeline.length === 0 ? '当前患者暂无待办任务。' : '当前没有未完成任务，打开右侧开关可查看历史任务。'}</div>
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
                        <p>{localizeBackendText(item.description)}</p>
                        <div className="timeline-extra">截止时间：{formatTime(item.data?.dueAt)}{item.data?.relatedAlertId ? ' · 已关联风险预警' : ''}</div>
                        {item.data?.status === 'PENDING' && (
                          <div className="timeline-actions">
                            <Link className="timeline-action-button primary" to={`/patients/${patientId}/task-processing?taskId=${item.data.id}&mode=phone`}>进入统一任务处理页</Link>
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
            <div className="task-inline-list">
              <div className="task-inline-list-header">
                <div>
                  <h3>待处理风险预警</h3>
                  <p className="muted small">可以选中预警快速完成处置；如需多种处理方式，请进入统一任务处理页。</p>
                </div>
              </div>

              {activeRiskAlerts.length === 0 ? (
                <div className="empty-state task-empty-state">当前患者暂无未处理风险预警。</div>
              ) : (
                <div className="task-inline-grid">
                  {activeRiskAlerts.map((item) => {
                    const relatedTasks = activeTasks.filter((task) => task.data?.relatedAlertId === item.data?.id);
                    return (
                      <article className="task-inline-card risk-inline-card" key={item.data?.id ?? `${item.time}-${item.title}`}>
                        <div className="task-inline-card-topline">
                          <span className={getRiskClass(item.data?.riskLevel ?? '')}>{riskLabelMap[item.data?.riskLevel] ?? item.data?.riskLevel}</span>
                          <span className="task-status-chip">{statusLabelMap[item.data?.status] ?? item.data?.status}</span>
                        </div>
                        <h4>{localizeBackendText(item.title)}</h4>
                        <p>{localizeBackendText(item.description)}</p>
                        <div className="timeline-extra">触发时间：{formatTime(item.time)}{relatedTasks.length ? ` · 已绑定 ${relatedTasks.length} 条待办任务` : ''}</div>
                        <div className="timeline-actions">
                          <button className="timeline-action-button primary" type="button" disabled={processingActionId !== null} onClick={() => resolveRiskAlertFromCare(item)}>
                            完成预警处置
                          </button>
                          <button className="timeline-action-button" type="button" onClick={() => { setActiveWorkspace('actions'); item.data?.id && selectRiskAlert(item.data.id); }}>
                            进入任务处理页
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {activeWorkspace === 'timeline' && (
        <>
      <section className="panel timeline-panel">
        <div className="hospital-section-header timeline-header">
          <div>
            <span>患者长期管理记录</span>
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
                  <h3>{localizeBackendText(item.title)}</h3>
                  <p>{localizeBackendText(item.description)}</p>
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
                      {item.data?.triggerRule ? ` · 触发规则：${localizeBackendText(item.data.triggerRule)}` : ''}
                    </div>
                  )}
                  {item.type === 'RISK_ALERT' &&
                    item.data?.status === 'OPEN' && (
                      <div className="timeline-actions">
                        {activeTasks.find((task) => task.data?.relatedAlertId === item.data?.id)?.data?.id ? (
                          <Link className="timeline-action-button primary" to={`/patients/${patientId}/task-processing?taskId=${activeTasks.find((task) => task.data?.relatedAlertId === item.data?.id)?.data?.id}&mode=phone`}>
                            查看关联任务
                          </Link>
                        ) : (
                          <button className="timeline-action-button primary" type="button" disabled={processingActionId !== null} onClick={() => startRiskAlertTaskFromDetail(item)}>
                            生成任务并处理
                          </button>
                        )}
                        <span className="timeline-action-hint">风险预警不再单独处置，请通过统一任务处理页闭环。</span>
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
                    item.data?.status === 'PENDING' && (
                      <div className="timeline-actions">
                        <Link className="timeline-action-button primary" to={`/patients/${patientId}/task-processing?taskId=${item.data.id}&mode=phone`}>
                          查看任务处理页
                        </Link>
                        {item.data?.relatedAlertId && (
                          <span className="timeline-action-hint">关联风险已合并到该任务详情中</span>
                        )}
                        <span className="timeline-action-hint">待办任务请进入统一任务处理页</span>
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
                      {localizeBackendText(item.data?.riskConclusion) ?? ''}
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




