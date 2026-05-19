import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, getApiErrorMessage } from '../api/client';
import {
  TaskActionShell,
  type ActionShellResult,
  type ActionShellStatusTone,
  type ActionShellViewState,
} from '../components/TaskActionShell';
import {
  TaskActionHistory,
  type TaskActionHistoryEntry,
} from '../components/TaskActionHistory';

/* ---------------------------------- 类型 ---------------------------------- */

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

type HandlingMode = 'PHONE' | 'RECHECK' | 'VISIT' | 'PLAN' | 'CLOSE';

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

type FeedbackDialogState = {
  type: 'success' | 'error';
  title: string;
  message: string;
  details?: string[];
  mode?: HandlingMode;
} | null;

/* ---------------------------------- 常量 ---------------------------------- */

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

const genderLabelMap: Record<string, string> = {
  MALE: '男',
  FEMALE: '女',
  UNKNOWN: '性别未录入',
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

const modeMeta: Record<
  HandlingMode,
  { kicker: string; title: string; hint: string; defaultStatus: string; collapsedAction: string }
> = {
  PHONE: {
    kicker: '电话随访记录',
    title: '电话随访沟通',
    hint: '适合联系患者、记录沟通；保存记录不会自动完成任务。',
    defaultStatus: '未填写',
    collapsedAction: '展开填写',
  },
  RECHECK: {
    kicker: '指标复测',
    title: '新增复测任务',
    hint: '提醒患者复测血压、血糖、血氧等指标。',
    defaultStatus: '可选',
    collapsedAction: '展开创建',
  },
  VISIT: {
    kicker: '门诊复诊',
    title: '建议门诊复诊',
    hint: '高危/极高危风险，需要线下就诊。',
    defaultStatus: '可选',
    collapsedAction: '展开创建',
  },
  PLAN: {
    kicker: '指标监测计划',
    title: '调整监测计划',
    hint: '修改或停用患者端的指标打卡计划。',
    defaultStatus: '可选',
    collapsedAction: '展开调整',
  },
  CLOSE: {
    kicker: '任务结案',
    title: '任务结案 / 风险处置记录',
    hint: '确认所有处理动作完成后，再统一完成任务并同步处置关联预警。',
    defaultStatus: '未完成',
    collapsedAction: '展开结案',
  },
};

const allModes: HandlingMode[] = ['PHONE', 'RECHECK', 'VISIT', 'PLAN', 'CLOSE'];

/* --------------------------------- 工具函数 -------------------------------- */

function normalizeHandlingMode(value: string | null): HandlingMode | null {
  const normalized = String(value ?? '').toUpperCase();
  return (allModes as string[]).includes(normalized) ? (normalized as HandlingMode) : null;
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

function formatShortTime(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function maskPhone(value?: string) {
  if (!value || value.length < 7) return value ?? '-';
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function calculateAge(birthDate?: string) {
  if (!birthDate) return '-';
  const birthday = new Date(birthDate);
  if (Number.isNaN(birthday.getTime())) return '-';
  const now = new Date();
  let age = now.getFullYear() - birthday.getFullYear();
  const monthDiff = now.getMonth() - birthday.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthday.getDate())) age -= 1;
  return `${age}岁`;
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
    customMeasureTimes: Array.isArray(plan?.customMeasureTimes)
      ? plan.customMeasureTimes.join(', ')
      : defaultPlanDraft.customMeasureTimes,
    customMeasureDays: Array.isArray(plan?.customMeasureDays) ? plan.customMeasureDays.join(', ') : '',
    evidenceBasis: plan?.evidenceBasis ?? '',
  };
}

function isOpenTask(task: Task) {
  return task.status === 'PENDING' || task.status === 'IN_PROGRESS';
}

function isClosedTask(task?: Task | null) {
  return task?.status === 'DONE' || task?.status === 'CANCELED';
}

/* ---------------------------------- 主组件 -------------------------------- */

export function PatientTaskProcessingPage() {
  const { patientId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const selectedTaskId = searchParams.get('taskId') ?? '';
  const requestedMode = normalizeHandlingMode(searchParams.get('mode'));

  /* ---------- 加载与数据 state ---------- */

  const [patient, setPatient] = useState<Patient | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setError] = useState('');

  /* ---------- 处理状态 state ---------- */

  // 每个模块的展示状态：undefined = 折叠
  const [moduleView, setModuleView] = useState<Partial<Record<HandlingMode, ActionShellViewState>>>({});
  // 提交结果（每个模块最新一次的提交摘要）
  const [actionResults, setActionResults] = useState<Partial<Record<HandlingMode, ActionShellResult>>>({});
  // 本次会话内所有提交记录（按时间顺序）
  const [actionHistory, setActionHistory] = useState<TaskActionHistoryEntry[]>([]);
  // 提交中的模块
  const [submittingMode, setSubmittingMode] = useState<HandlingMode | null>(null);
  // 弹窗反馈：提交成功/失败均在当前位置弹出，避免只在页面顶部提示。
  const [feedbackDialog, setFeedbackDialog] = useState<FeedbackDialogState>(null);

  /* ---------- 表单 state ---------- */

  const [callOutcome, setCallOutcome] = useState('CONTACTED');
  const [callConclusion, setCallConclusion] = useState('CONTINUE_OBSERVE');
  const [callContent, setCallContent] = useState('');
  const [followUpResult, setFollowUpResult] = useState('');
  const [nursingAdvice, setNursingAdvice] = useState('');
  const [nextFollowUpTime, setNextFollowUpTime] = useState('');
  const [signature, setSignature] = useState('');

  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [planDraft, setPlanDraft] = useState<VitalMonitoringPlanDraft>(defaultPlanDraft);
  const [recheckTitle, setRecheckTitle] = useState('');
  const [recheckDueAt, setRecheckDueAt] = useState('');
  const [recheckNote, setRecheckNote] = useState('');
  const [visitReason, setVisitReason] = useState('');
  const [visitNote, setVisitNote] = useState('');
  const [closeStatus, setCloseStatus] = useState<'DONE' | 'CANCELED'>('DONE');
  const [closeNote, setCloseNote] = useState('');
  const [closeSyncAlert, setCloseSyncAlert] = useState(true);
  const [closeSignature, setCloseSignature] = useState('');

  /* ---------- 数据加载 ---------- */

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
      showErrorFeedback(getApiErrorMessage(err, '任务处理页加载失败，请确认后端服务和患者数据。'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage();
  }, [patientId]);

  /* ---------- 任务列表与选中 ---------- */

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

  const nextOpenTask = useMemo(() => {
    if (!selectedTask) return openTasks[0] ?? null;
    return openTasks.find((task) => task.id !== selectedTask.id) ?? null;
  }, [openTasks, selectedTask]);

  useEffect(() => {
    if (!selectedTask || selectedTaskId === selectedTask.id) return;
    const next = new URLSearchParams(searchParams);
    next.set('taskId', selectedTask.id);
    setSearchParams(next, { replace: true });
  }, [searchParams, selectedTask, selectedTaskId, setSearchParams]);

  const relatedAlert = useMemo(() => {
    if (!selectedTask?.relatedAlertId) return null;
    return (
      timeline.find(
        (item) => item.type === 'RISK_ALERT' && item.data?.id === selectedTask.relatedAlertId,
      ) ?? null
    );
  }, [selectedTask, timeline]);

  const recentVitals = useMemo(
    () => timeline.filter((item) => item.type === 'VITAL_RECORD').slice(0, 8),
    [timeline],
  );
  const monitoringPlans = useMemo(
    () => timeline.filter((item) => item.type === 'VITAL_MONITORING_PLAN'),
    [timeline],
  );
  const activeMonitoringPlans = useMemo(
    () => monitoringPlans.filter((item) => item.data?.isActive !== false),
    [monitoringPlans],
  );
  const followUps = useMemo(
    () => timeline.filter((item) => item.type === 'FOLLOW_UP').slice(0, 5),
    [timeline],
  );

  /* ---------- 任务切换时重置编辑状态 ---------- */

  useEffect(() => {
    if (!selectedTask) return;
    setCallContent(`围绕待办事项"${selectedTask.title}"电话联系患者，核对症状、用药、复测和复诊情况。`);
    setFollowUpResult('已电话联系，待补充患者反馈。');
    setNursingAdvice('请患者按要求复测/用药/复诊，如出现危险症状及时就医。');
    setRecheckTitle(`复测提醒：${selectedTask.title.replace(/^风险随访任务：/, '')}`);
    setVisitReason(
      relatedAlert
        ? `因${localizeBackendText(relatedAlert.title)}建议门诊复诊`
        : `因待办事项"${selectedTask.title}"建议门诊复诊`,
    );
    setVisitNote(
      relatedAlert?.description
        ? `风险依据：${localizeBackendText(relatedAlert.description)}`
        : '请患者携带近期居家监测记录到院复核。',
    );
    setCloseNote(
      selectedTask.relatedAlertId
        ? '已完成沟通/复测/复诊提醒等处理动作，确认结案并同步处置关联风险预警。'
        : '已完成该待办事项处理，确认结案。',
    );
    setCloseSyncAlert(Boolean(selectedTask.relatedAlertId));

    // 切换任务时：清空模块展开态、清空提交记录、清空历史
    setModuleView({});
    setActionResults({});
    setActionHistory([]);
    setFeedbackDialog(null);
    setError('');
  }, [selectedTask?.id]);

  useEffect(() => {
    const firstPlan = activeMonitoringPlans[0]?.data;
    if (!selectedPlanId && firstPlan?.id) {
      setSelectedPlanId(firstPlan.id);
      setPlanDraft(normalizePlanDraft(firstPlan));
    }
  }, [activeMonitoringPlans, selectedPlanId]);

  /* ---------- 如果 URL 指定 mode，自动展开对应模块 ---------- */

  useEffect(() => {
    if (!requestedMode || !selectedTask) return;
    setModuleView({ [requestedMode]: 'edit' });
  }, [requestedMode, selectedTask?.id]);

  /* ---------- 模块视图状态切换 ---------- */

  function openModule(mode: HandlingMode) {
    if (isClosedTask(selectedTask) && mode === 'CLOSE') return;
    setError('');
    setModuleView((current) => {
      if (current[mode]) {
        return {};
      }
      // 已提交过的进入 review，未提交的直接进入 edit；同一时间只展开一个处理动作。
      return { [mode]: actionResults[mode] ? 'review' : 'edit' };
    });
  }

  function collapseModule(mode: HandlingMode) {
    setModuleView((current) => {
      const next = { ...current };
      delete next[mode];
      return next;
    });
  }

  function continueEdit(mode: HandlingMode) {
    setError('');
    setModuleView({ [mode]: 'edit' });
  }

  function recordAction(mode: HandlingMode, result: ActionShellResult) {
    setActionResults((current) => ({ ...current, [mode]: result }));
    setActionHistory((current) => [
      ...current,
      { ...result, mode, moduleTitle: modeMeta[mode].title },
    ]);
    // 提交成功后立即折叠该模块
    setModuleView((current) => {
      const next = { ...current };
      delete next[mode];
      return next;
    });
    setFeedbackDialog({
      type: 'success',
      title: result.label,
      message: `${modeMeta[mode].title}已提交成功。`,
      details: result.details,
      mode,
    });
  }

  function choosePlan(planId: string) {
    setSelectedPlanId(planId);
    const plan = monitoringPlans.find((item) => item.data?.id === planId)?.data;
    setPlanDraft(normalizePlanDraft(plan));
  }

  function updatePlanDraft<K extends keyof VitalMonitoringPlanDraft>(
    key: K,
    value: VitalMonitoringPlanDraft[K],
  ) {
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

  async function markTaskInProgressIfNeeded(task: Task) {
    if (task.status !== 'PENDING') return;
    await api.patch(`/tasks/${task.id}/status`, {
      status: 'IN_PROGRESS',
      syncRelatedAlert: false,
    });
  }

  function showErrorFeedback(message: string) {
    setError(message);
    setFeedbackDialog({ type: 'error', title: '操作失败', message });
  }

  function requireSignature(value: string, message: string) {
    if (!value.trim()) {
      showErrorFeedback(message);
      return false;
    }
    return true;
  }

  function selectTask(taskId: string) {
    const next = new URLSearchParams(searchParams);
    next.set('taskId', taskId);
    setSearchParams(next);
  }

  function goToNextTask() {
    if (!nextOpenTask) {
      navigate('/nurse-dashboard');
      return;
    }
    selectTask(nextOpenTask.id);
    setFeedbackDialog(null);
  }

  /* ------------------------------- 提交动作 -------------------------------- */

  async function submitPhoneFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patientId || !selectedTask || submittingMode) return;

    const trimmedSignature = signature.trim();
    if (!requireSignature(trimmedSignature, '请填写电子签名后再保存电话随访记录。')) return;

    setSubmittingMode('PHONE');
    setError('');

    try {
      const outcomeLabel =
        callOutcome === 'CONTACTED'
          ? '已接通本人'
          : callOutcome === 'NO_ANSWER'
            ? '未接通'
            : callOutcome === 'FAMILY_CONTACTED'
              ? '已联系家属'
              : '需再次联系';
      const conclusionLabel =
        callConclusion === 'RECHECK'
          ? '建议复测'
          : callConclusion === 'VISIT'
            ? '建议复诊'
            : callConclusion === 'URGENT'
              ? '建议立即就医'
              : '继续观察';

      await api.post(`/patients/${patientId}/follow-ups`, {
        followUpType: 'PHONE',
        followUpTime: new Date().toISOString(),
        content: [
          `统一任务处理：${selectedTask.title}`,
          `联系结果：${outcomeLabel}`,
          `处理结论：${conclusionLabel}`,
          callContent.trim(),
          relatedAlert ? `关联预警：${localizeBackendText(relatedAlert.title)}` : '',
          `电子签名：${trimmedSignature}`,
        ]
          .filter(Boolean)
          .join('；'),
        result: followUpResult.trim() || outcomeLabel,
        suggestion: nursingAdvice.trim() || undefined,
        nextFollowUpTime: nextFollowUpTime ? new Date(nextFollowUpTime).toISOString() : undefined,
        operatorId: nurseId,
      });

      await markTaskInProgressIfNeeded(selectedTask);

      const savedAt = new Date().toISOString();
      recordAction('PHONE', {
        label: isClosedTask(selectedTask) ? '补充随访记录已保存' : '电话随访记录已保存',
        savedAt,
        statusText: `已保存 ${formatShortTime(savedAt)}`,
        details: [
          `联系结果：${outcomeLabel}`,
          `处理结论：${conclusionLabel}`,
          isClosedTask(selectedTask)
            ? '任务已结案，本次仅作为补充随访记录。'
            : '任务状态刷新为处理中，未自动结案。',
        ],
      });
      await loadPage();
    } catch (err) {
      console.error(err);
      showErrorFeedback(getApiErrorMessage(err, '电话随访提交失败，请稍后重试。'));
    } finally {
      setSubmittingMode(null);
    }
  }

  async function createRecheckTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patientId || !selectedTask || submittingMode) return;
    if (!recheckTitle.trim()) {
      showErrorFeedback('请填写复测任务标题。');
      return;
    }

    setSubmittingMode('RECHECK');
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

      await markTaskInProgressIfNeeded(selectedTask);
      const savedAt = new Date().toISOString();
      recordAction('RECHECK', {
        label: '复测任务已创建',
        savedAt,
        statusText: `已创建 ${formatShortTime(savedAt)}`,
        details: [
          `复测任务：${recheckTitle.trim()}`,
          recheckDueAt ? `截止：${formatTime(new Date(recheckDueAt).toISOString())}` : '未设置截止时间',
          '原任务未自动结案，可继续电话沟通或在结案模块完成任务。',
        ],
      });
      await loadPage();
    } catch (err) {
      console.error(err);
      showErrorFeedback(getApiErrorMessage(err, '新增复测任务失败，请稍后重试。'));
    } finally {
      setSubmittingMode(null);
    }
  }

  async function createHospitalVisitReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patientId || !selectedTask || submittingMode) return;
    if (!visitReason.trim()) {
      showErrorFeedback('请填写复诊提醒原因。');
      return;
    }

    setSubmittingMode('VISIT');
    setError('');

    try {
      await api.post(`/patients/${patientId}/hospital-visit-reminders`, {
        sourceRiskAlertId: selectedTask.relatedAlertId || undefined,
        reason: visitReason.trim(),
        note: visitNote.trim() || undefined,
        electronicSignature: signature.trim() || closeSignature.trim() || 'nurse-001',
      });

      await markTaskInProgressIfNeeded(selectedTask);
      const savedAt = new Date().toISOString();
      recordAction('VISIT', {
        label: '门诊复诊提醒已创建',
        savedAt,
        statusText: `已创建 ${formatShortTime(savedAt)}`,
        details: [
          `复诊原因：${visitReason.trim()}`,
          '原任务未自动结案；患者到院或护士确认后，可在结案模块完成任务。',
        ],
      });
      await loadPage();
    } catch (err) {
      console.error(err);
      showErrorFeedback(
        getApiErrorMessage(err, '创建门诊复诊提醒失败，请确认到院提醒模块已挂载。'),
      );
    } finally {
      setSubmittingMode(null);
    }
  }

  async function updateMonitoringPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTask || !selectedPlanId || submittingMode) return;

    setSubmittingMode('PLAN');
    setError('');

    try {
      await api.patch(`/vital-monitoring-plans/${selectedPlanId}`, {
        vitalType: planDraft.vitalType,
        displayName: planDraft.displayName,
        unit: planDraft.unit,
        frequencyUnit: planDraft.frequencyUnit,
        timesPerUnit: Number(planDraft.timesPerUnit),
        customMeasureTimes: parseTimeList(planDraft.customMeasureTimes),
        customMeasureDays:
          planDraft.frequencyUnit === 'DAY' ? [] : parseDayList(planDraft.customMeasureDays),
        evidenceBasis: planDraft.evidenceBasis || undefined,
        evidenceSource: planDraft.evidenceBasis ? '护士任务处理页调整' : undefined,
      });

      await markTaskInProgressIfNeeded(selectedTask);
      const savedAt = new Date().toISOString();
      recordAction('PLAN', {
        label: '指标监测计划已更新',
        savedAt,
        statusText: `已保存 ${formatShortTime(savedAt)}`,
        details: [
          `计划：${planDraft.displayName}`,
          `${planDraft.timesPerUnit} 次 / ${
            planDraft.frequencyUnit === 'DAY' ? '日' : planDraft.frequencyUnit === 'WEEK' ? '周' : '月'
          }`,
          '原任务未自动结案。',
        ],
      });
      await loadPage();
    } catch (err) {
      console.error(err);
      showErrorFeedback(getApiErrorMessage(err, '监测计划更新失败，请稍后重试。'));
    } finally {
      setSubmittingMode(null);
    }
  }

  async function deactivateMonitoringPlan() {
    if (!selectedTask || !selectedPlanId || submittingMode) return;
    if (!window.confirm('确认停用该指标监测计划？停用后患者端不再按该计划提醒。')) return;

    setSubmittingMode('PLAN');
    setError('');

    try {
      await api.delete(`/vital-monitoring-plans/${selectedPlanId}`);
      await markTaskInProgressIfNeeded(selectedTask);
      const savedAt = new Date().toISOString();
      recordAction('PLAN', {
        label: '指标监测计划已停用',
        savedAt,
        statusText: `已停用 ${formatShortTime(savedAt)}`,
        details: ['患者端后续不再按该计划提醒。', '原任务未自动结案。'],
      });
      setSelectedPlanId('');
      setPlanDraft(defaultPlanDraft);
      await loadPage();
    } catch (err) {
      console.error(err);
      showErrorFeedback(getApiErrorMessage(err, '停用监测计划失败，请稍后重试。'));
    } finally {
      setSubmittingMode(null);
    }
  }

  async function closeTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTask || submittingMode || isClosedTask(selectedTask)) return;
    if (!closeNote.trim()) {
      showErrorFeedback('请填写任务处理记录。');
      return;
    }
    if (!requireSignature(closeSignature.trim(), '请填写电子签名后再提交结案。')) return;

    setSubmittingMode('CLOSE');
    setError('');

    try {
      await api.patch(`/tasks/${selectedTask.id}/status`, {
        status: closeStatus,
        syncRelatedAlert: closeSyncAlert && Boolean(selectedTask.relatedAlertId),
        relatedAlertHandlingNote: [
          `处置记录：${closeNote.trim()}`,
          `电子签名：${closeSignature.trim()}`,
        ].join('；'),
      });
      const savedAt = new Date().toISOString();
      recordAction('CLOSE', {
        label: closeStatus === 'DONE' ? '任务处理已完成' : '任务已取消',
        savedAt,
        statusText:
          closeStatus === 'DONE'
            ? `已完成 ${formatShortTime(savedAt)}`
            : `已取消 ${formatShortTime(savedAt)}`,
        syncedAlert: closeSyncAlert && Boolean(selectedTask.relatedAlertId),
        details: [
          closeStatus === 'DONE' ? '待办任务已标记为已完成。' : '待办任务已标记为已取消。',
          closeSyncAlert && selectedTask.relatedAlertId
            ? '关联风险预警已同步处置。'
            : '关联风险预警未同步变更。',
          '处理记录已保存到任务/预警留痕。',
          '已生成审计记录。',
        ],
      });
      await loadPage();
    } catch (err) {
      console.error(err);
      showErrorFeedback(getApiErrorMessage(err, '任务状态更新失败，请稍后重试。'));
    } finally {
      setSubmittingMode(null);
    }
  }

  /* ---------- 模块状态与色调 ---------- */

  function getModuleStatusLabel(mode: HandlingMode) {
    const result = actionResults[mode];
    if (result?.statusText) return result.statusText;
    if (mode === 'CLOSE' && selectedTask?.status === 'DONE') return '已完成';
    if (mode === 'CLOSE' && selectedTask?.status === 'CANCELED') return '已取消';
    if (mode === 'PHONE' && followUps.length > 0) return `已有 ${followUps.length} 条记录`;
    return modeMeta[mode].defaultStatus;
  }

  function getModuleStatusTone(mode: HandlingMode): ActionShellStatusTone {
    if (actionResults[mode] || (mode === 'CLOSE' && isClosedTask(selectedTask))) return 'saved';
    if (mode === 'PHONE' && followUps.length > 0) return 'in-progress';
    if (mode === 'CLOSE' && selectedTask?.relatedAlertId) return 'alert-linked';
    return 'pending';
  }

  /* ---------- 渲染 ---------- */

  if (loading && !patient) {
    return <div className="loading-state">正在加载患者任务处理页...</div>;
  }

  if (!patient) {
    return (
      <div className="business-page patient-task-processing-page">
        <div className="empty-state">患者任务处理页加载失败。</div>
        <button
          className="secondary-btn"
          type="button"
          onClick={() => navigate('/nurse-dashboard')}
        >
          返回护士工作台
        </button>
      </div>
    );
  }

  const taskIsClosed = isClosedTask(selectedTask);

  return (
    <div className="business-page patient-task-processing-page compact-task-workbench task-workbench-pro">
      {/* 顶部紧凑信息条 */}
      <div className="task-workbench-topbar">
        <div className="task-workbench-patient-line">
          <strong>{patient.name}</strong>
          <span>{genderLabelMap[patient.gender ?? 'UNKNOWN'] ?? patient.gender}</span>
          <span>{calculateAge(patient.birthDate)}</span>
          <span>{patient.hospitalPatientId ?? '院内号未录入'}</span>
          <span>电话 {maskPhone(patient.phone)}</span>
        </div>
        <div className="task-workbench-actions">
          <Link className="secondary-btn compact-link-btn" to="/nurse-dashboard">
            返回待办任务
          </Link>
          <Link className="secondary-btn compact-link-btn" to={`/patients/${patient.id}`}>
            查看患者档案
          </Link>
        </div>
      </div>

      {feedbackDialog && (
        <div className="task-feedback-dialog-backdrop" role="presentation">
          <section
            className={`task-feedback-dialog ${feedbackDialog.type === 'error' ? 'is-error' : 'is-success'}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-feedback-dialog-title"
          >
            <div className="task-feedback-dialog-icon" aria-hidden="true">
              {feedbackDialog.type === 'error' ? '!' : '✓'}
            </div>
            <div className="task-feedback-dialog-body">
              <span className="task-feedback-dialog-kicker">
                {feedbackDialog.type === 'error' ? '提交失败' : '提交成功'}
              </span>
              <h2 id="task-feedback-dialog-title">{feedbackDialog.title}</h2>
              <p>{feedbackDialog.message}</p>
              {feedbackDialog.details && feedbackDialog.details.length > 0 && (
                <ul>
                  {feedbackDialog.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
              <div className="task-feedback-dialog-actions">
                {feedbackDialog.type === 'success' && nextOpenTask && (
                  <button className="primary-btn compact-link-btn" type="button" onClick={goToNextTask}>
                    继续处理下一条任务（剩余 {openTasks.length} 条）
                  </button>
                )}
                {feedbackDialog.type === 'success' && !nextOpenTask && (
                  <Link className="primary-btn compact-link-btn" to="/nurse-dashboard">
                    返回护士工作台
                  </Link>
                )}
                <Link className="secondary-btn compact-link-btn" to={`/patients/${patient.id}`}>
                  查看患者档案
                </Link>
                <button
                  className="ghost-button compact-link-btn"
                  type="button"
                  onClick={() => {
                    setFeedbackDialog(null);
                    if (feedbackDialog.type === 'error') setError('');
                  }}
                >
                  关闭
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      <div className="task-processing-layout task-workbench-layout">
        {/* 左侧任务队列与风险预警分区 */}
        <aside className="task-processing-sidebar task-processing-sidebar-stack">
          <section className="panel compact-panel task-sidebar-section task-selection-section">
            <div className="hospital-section-header compact-header">
              <div>
                <span>患者任务队列</span>
                <h2>选择任务</h2>
              </div>
            </div>

            {sortedTasks.length === 0 ? (
              <div className="empty-state compact-empty">当前患者暂无任务。</div>
            ) : (
              <div className="task-processing-task-list compact-task-list">
                {sortedTasks.map((task) => {
                  const isSelected = selectedTask?.id === task.id;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className={
                        isSelected ? 'task-processing-task-card active' : 'task-processing-task-card'
                      }
                      onClick={() => selectTask(task.id)}
                    >
                      <span className="badge">{taskTypeLabelMap[task.type] ?? task.type}</span>
                      <strong>{task.title}</strong>
                      <small>截止：{formatTime(task.dueAt)}</small>
                      <em className={getStatusClass(task.status)}>
                        {statusLabelMap[task.status] ?? task.status}
                      </em>
                      {task.relatedAlertId && (
                        <small className="task-related-alert-hint">已合并风险预警</small>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="panel compact-panel task-sidebar-section related-alert-side-section">
            <div className="hospital-section-header compact-header">
              <div>
                <span>风险依据</span>
                <h2>关联风险预警</h2>
              </div>
            </div>
            {relatedAlert ? (
              <div className="related-alert-sidebar-card">
                <div className="related-alert-sidebar-head">
                  <span className={getRiskClass(relatedAlert.data?.riskLevel)}>
                    {riskLabelMap[relatedAlert.data?.riskLevel] ?? relatedAlert.data?.riskLevel}
                  </span>
                  <strong>关联风险预警：{localizeBackendText(relatedAlert.title)}</strong>
                </div>
                <dl className="related-alert-sidebar-dl">
                  <div>
                    <dt>当前状态</dt>
                    <dd>{statusLabelMap[relatedAlert.data?.status] ?? relatedAlert.data?.status ?? '未处理'}</dd>
                  </div>
                  <div>
                    <dt>预警说明</dt>
                    <dd>{localizeBackendText(relatedAlert.description) || '-'}</dd>
                  </div>
                  {relatedAlert.data?.triggerRule && (
                    <div>
                      <dt>触发规则</dt>
                      <dd>{relatedAlert.data.triggerRule}</dd>
                    </div>
                  )}
                  {relatedAlert.data?.handlingNote && (
                    <div>
                      <dt>既往处置</dt>
                      <dd>{relatedAlert.data.handlingNote}</dd>
                    </div>
                  )}
                </dl>
              </div>
            ) : (
              <div className="empty-state compact-empty">当前选中任务无关联风险预警。</div>
            )}
          </section>
        </aside>

        {/* 右侧主区 */}
        <main className="task-processing-main task-workbench-main">
          {!selectedTask ? (
            <section className="panel">
              <div className="empty-state">请选择一个任务后继续处理。</div>
            </section>
          ) : (
            <>
              {/* 处理摘要：紧凑、一眼可见 */}
              <section className="panel task-process-summary-panel">
                <div className="hospital-section-header compact-header">
                  <div>
                    <span>处理摘要</span>
                    <h2>先确认任务与风险，再选择处理方式</h2>
                    <p className="section-hint">
                      所有表单默认折叠；只有点击模块才展开填写。提交成功后立即折叠并锁定本次结果。
                    </p>
                  </div>
                </div>
                <div className="task-summary-mini-grid">
                  <div>
                    <span>任务状态</span>
                    <strong>{statusLabelMap[selectedTask.status] ?? selectedTask.status}</strong>
                  </div>
                  <div>
                    <span>任务类型</span>
                    <strong>{taskTypeLabelMap[selectedTask.type] ?? selectedTask.type}</strong>
                  </div>
                  <div>
                    <span>关联预警</span>
                    <strong>{selectedTask.relatedAlertId ? '已合并' : '无'}</strong>
                  </div>
                  <div>
                    <span>本次提交</span>
                    <strong>{actionHistory.length} 项</strong>
                  </div>
                </div>
              </section>

              {/* 处理方式卡片选择区 */}
              <section className="panel task-processing-mode-card compact-action-card-panel">
                <div className="hospital-section-header compact-header">
                  <div>
                    <span>处理方式</span>
                    <h2>选择一个动作展开填写</h2>
                    <p className="section-hint">
                      每个模块默认折叠；提交成功后自动收起并显示状态徽章，可"查看 / 继续补充"。
                    </p>
                  </div>
                </div>
                <div className="task-processing-mode-grid action-module-grid action-module-grid-pro">
                  {allModes.map((mode) => {
                    const view = moduleView[mode];
                    const result = actionResults[mode] ?? null;
                    const disabled = mode === 'CLOSE' && taskIsClosed;
                    return (
                      <button
                        key={mode}
                        type="button"
                        className={`action-module-card ${view ? 'expanded' : ''} ${
                          result ? 'has-result' : ''
                        }`}
                        onClick={() => openModule(mode)}
                        disabled={disabled}
                      >
                        <div>
                          <strong>{modeMeta[mode].title}</strong>
                          <span>{modeMeta[mode].hint}</span>
                        </div>
                        <div className="action-module-footer">
                          <em className={`module-status ${getModuleStatusTone(mode)}`}>
                            {getModuleStatusLabel(mode)}
                          </em>
                          <small>
                            {disabled
                              ? '已结案'
                              : view
                                ? '已展开'
                                : result
                                  ? '查看 / 继续补充'
                                  : modeMeta[mode].collapsedAction}
                          </small>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* 展开的模块（按 moduleView 渲染） */}

              {moduleView.PHONE && (
                <TaskActionShell
                  moduleKey="PHONE"
                  kicker={modeMeta.PHONE.kicker}
                  title={modeMeta.PHONE.title}
                  hint="保存该表单只写入随访记录，并将待处理任务刷新为「处理中」；不会自动完成任务。"
                  view={moduleView.PHONE}
                  statusLabel={getModuleStatusLabel('PHONE')}
                  statusTone={getModuleStatusTone('PHONE')}
                  result={actionResults.PHONE ?? null}
                  isSubmitting={submittingMode === 'PHONE'}
                  collapsedActionText={modeMeta.PHONE.collapsedAction}
                  onExpand={() => openModule('PHONE')}
                  onCollapse={() => collapseModule('PHONE')}
                  onContinueEdit={() => continueEdit('PHONE')}
                >
                  <form
                    className="hospital-form task-follow-up-form"
                    onSubmit={submitPhoneFollowUp}
                  >
                    <div className="task-call-two-column-grid compact-two-column-form">
                      <div className="task-call-contact-card embedded-contact-card">
                        <h3>患者联系信息</h3>
                        <dl className="contact-info-list">
                          <div>
                            <dt>患者姓名</dt>
                            <dd>{patient.name}</dd>
                          </div>
                          <div>
                            <dt>院内号</dt>
                            <dd>{patient.hospitalPatientId ?? '-'}</dd>
                          </div>
                          <div>
                            <dt>联系电话</dt>
                            <dd>
                              <a href={patient.phone ? `tel:${patient.phone}` : undefined}>
                                {maskPhone(patient.phone)}
                              </a>
                            </dd>
                          </div>
                          <div>
                            <dt>住址</dt>
                            <dd>{patient.address ?? '-'}</dd>
                          </div>
                          <div>
                            <dt>紧急联系人</dt>
                            <dd>
                              {patient.emergencyContactName ?? '-'}{' '}
                              {patient.emergencyContactPhone
                                ? ` / ${maskPhone(patient.emergencyContactPhone)}`
                                : ''}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      <div className="task-call-form-fields">
                        <div className="form-grid form-grid-two">
                          <div className="form-row">
                            <label>联系结果</label>
                            <select
                              value={callOutcome}
                              onChange={(event) => setCallOutcome(event.target.value)}
                              disabled={submittingMode === 'PHONE'}
                            >
                              <option value="CONTACTED">已接通本人</option>
                              <option value="FAMILY_CONTACTED">已联系家属</option>
                              <option value="NO_ANSWER">未接通</option>
                              <option value="CALL_BACK">需再次联系</option>
                            </select>
                          </div>
                          <div className="form-row">
                            <label>处理结论</label>
                            <select
                              value={callConclusion}
                              onChange={(event) => setCallConclusion(event.target.value)}
                              disabled={submittingMode === 'PHONE'}
                            >
                              <option value="CONTINUE_OBSERVE">继续观察</option>
                              <option value="RECHECK">建议复测</option>
                              <option value="VISIT">建议复诊</option>
                              <option value="URGENT">建议立即就医</option>
                            </select>
                          </div>
                          <div className="form-row">
                            <label>下次随访时间</label>
                            <input
                              type="datetime-local"
                              value={nextFollowUpTime}
                              onChange={(event) => setNextFollowUpTime(event.target.value)}
                              disabled={submittingMode === 'PHONE'}
                            />
                          </div>
                          <div className="form-row signature-row">
                            <label>电子签名</label>
                            <input
                              value={signature}
                              onChange={(event) => setSignature(event.target.value)}
                              placeholder="请输入护士姓名 / 工号"
                              disabled={submittingMode === 'PHONE'}
                            />
                          </div>
                        </div>
                        <div className="form-row">
                          <label>电话沟通内容</label>
                          <textarea
                            value={callContent}
                            onChange={(event) => setCallContent(event.target.value)}
                            rows={4}
                            disabled={submittingMode === 'PHONE'}
                          />
                        </div>
                        <div className="form-grid form-grid-two">
                          <div className="form-row">
                            <label>患者反馈 / 随访结果</label>
                            <textarea
                              value={followUpResult}
                              onChange={(event) => setFollowUpResult(event.target.value)}
                              rows={3}
                              disabled={submittingMode === 'PHONE'}
                            />
                          </div>
                          <div className="form-row">
                            <label>健康宣教 / 医嘱转达</label>
                            <textarea
                              value={nursingAdvice}
                              onChange={(event) => setNursingAdvice(event.target.value)}
                              rows={3}
                              disabled={submittingMode === 'PHONE'}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="form-actions sticky-form-actions pro-form-actions">
                      <button className="button" type="submit" disabled={submittingMode === 'PHONE'}>
                        {submittingMode === 'PHONE'
                          ? '正在保存...'
                          : actionResults.PHONE
                            ? '保存补充随访记录'
                            : '保存电话随访记录'}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => collapseModule('PHONE')}
                        disabled={submittingMode === 'PHONE'}
                      >
                        取消
                      </button>
                      <span className="operation-form-hint">
                        不会自动完成任务；完成任务请到"任务结案 / 风险处置记录"。
                      </span>
                    </div>
                  </form>
                </TaskActionShell>
              )}

              {moduleView.RECHECK && (
                <TaskActionShell
                  moduleKey="RECHECK"
                  kicker={modeMeta.RECHECK.kicker}
                  title={modeMeta.RECHECK.title}
                  hint="展示指标检测最近数据；创建复测任务后，原任务不会自动结案。"
                  view={moduleView.RECHECK}
                  statusLabel={getModuleStatusLabel('RECHECK')}
                  statusTone={getModuleStatusTone('RECHECK')}
                  result={actionResults.RECHECK ?? null}
                  isSubmitting={submittingMode === 'RECHECK'}
                  collapsedActionText={modeMeta.RECHECK.collapsedAction}
                  onExpand={() => openModule('RECHECK')}
                  onCollapse={() => collapseModule('RECHECK')}
                  onContinueEdit={() => continueEdit('RECHECK')}
                >
                  <div className="recheck-grid compact-recheck-grid">
                    <section className="clean-subpanel">
                      <h3>最近指标记录</h3>
                      {recentVitals.length === 0 ? (
                        <div className="empty-state compact-empty">暂无指标记录</div>
                      ) : (
                        <div className="table-wrap clean-table-wrap">
                          <table className="table clean-hospital-table">
                            <thead>
                              <tr>
                                <th>指标</th>
                                <th>数值</th>
                                <th>时间</th>
                                <th>状态</th>
                              </tr>
                            </thead>
                            <tbody>
                              {recentVitals.map((item) => (
                                <tr
                                  key={`${item.type}-${item.time}-${item.data?.id ?? item.title}`}
                                >
                                  <td>
                                    {vitalTypeLabelMap[item.data?.type] ?? item.data?.type}
                                  </td>
                                  <td>
                                    <strong>
                                      {item.data?.value} {item.data?.unit}
                                    </strong>
                                  </td>
                                  <td>{formatTime(item.time)}</td>
                                  <td>
                                    {item.data?.isAbnormal ? (
                                      <span className="risk-badge risk-high">异常</span>
                                    ) : (
                                      <span className="status-badge status-done">正常</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>

                    <section className="clean-subpanel">
                      <h3>创建复测提醒</h3>
                      <form className="hospital-form" onSubmit={createRecheckTask}>
                        <div className="form-row">
                          <label>复测任务标题</label>
                          <input
                            value={recheckTitle}
                            onChange={(event) => setRecheckTitle(event.target.value)}
                            required
                            disabled={submittingMode === 'RECHECK'}
                          />
                        </div>
                        <div className="form-row">
                          <label>截止时间</label>
                          <input
                            type="datetime-local"
                            value={recheckDueAt}
                            onChange={(event) => setRecheckDueAt(event.target.value)}
                            disabled={submittingMode === 'RECHECK'}
                          />
                        </div>
                        <div className="form-row">
                          <label>复测说明</label>
                          <textarea
                            value={recheckNote}
                            onChange={(event) => setRecheckNote(event.target.value)}
                            rows={4}
                            placeholder="例如：请患者今晚 19:30 复测血压并通过小程序上传。"
                            disabled={submittingMode === 'RECHECK'}
                          />
                        </div>
                        <div className="form-actions sticky-form-actions pro-form-actions">
                          <button
                            className="button"
                            type="submit"
                            disabled={submittingMode === 'RECHECK'}
                          >
                            {submittingMode === 'RECHECK' ? '正在创建...' : '创建复测任务'}
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => collapseModule('RECHECK')}
                            disabled={submittingMode === 'RECHECK'}
                          >
                            取消
                          </button>
                        </div>
                      </form>
                    </section>
                  </div>
                </TaskActionShell>
              )}

              {moduleView.VISIT && (
                <TaskActionShell
                  moduleKey="VISIT"
                  kicker={modeMeta.VISIT.kicker}
                  title={modeMeta.VISIT.title}
                  hint="高危/极高危风险，创建到院提醒后原任务不会自动结案。"
                  view={moduleView.VISIT}
                  statusLabel={getModuleStatusLabel('VISIT')}
                  statusTone={getModuleStatusTone('VISIT')}
                  result={actionResults.VISIT ?? null}
                  isSubmitting={submittingMode === 'VISIT'}
                  collapsedActionText={modeMeta.VISIT.collapsedAction}
                  onExpand={() => openModule('VISIT')}
                  onCollapse={() => collapseModule('VISIT')}
                  onContinueEdit={() => continueEdit('VISIT')}
                >
                  <form
                    className="hospital-form compact-two-column-form"
                    onSubmit={createHospitalVisitReminder}
                  >
                    <div className="form-grid form-grid-two">
                      <div className="form-row">
                        <label>复诊原因</label>
                        <textarea
                          value={visitReason}
                          onChange={(event) => setVisitReason(event.target.value)}
                          rows={4}
                          required
                          disabled={submittingMode === 'VISIT'}
                        />
                      </div>
                      <div className="form-row">
                        <label>护士备注 / 携带材料</label>
                        <textarea
                          value={visitNote}
                          onChange={(event) => setVisitNote(event.target.value)}
                          rows={4}
                          disabled={submittingMode === 'VISIT'}
                        />
                      </div>
                    </div>
                    <div className="form-actions sticky-form-actions pro-form-actions">
                      <button
                        className="button"
                        type="submit"
                        disabled={submittingMode === 'VISIT'}
                      >
                        {submittingMode === 'VISIT' ? '正在创建...' : '创建门诊复诊提醒'}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => collapseModule('VISIT')}
                        disabled={submittingMode === 'VISIT'}
                      >
                        取消
                      </button>
                    </div>
                  </form>
                </TaskActionShell>
              )}

              {moduleView.PLAN && (
                <TaskActionShell
                  moduleKey="PLAN"
                  kicker={modeMeta.PLAN.kicker}
                  title={modeMeta.PLAN.title}
                  hint="复用指标监测页字段，调整患者端打卡提醒；不会自动完成当前任务。"
                  view={moduleView.PLAN}
                  statusLabel={getModuleStatusLabel('PLAN')}
                  statusTone={getModuleStatusTone('PLAN')}
                  result={actionResults.PLAN ?? null}
                  isSubmitting={submittingMode === 'PLAN'}
                  collapsedActionText={modeMeta.PLAN.collapsedAction}
                  onExpand={() => openModule('PLAN')}
                  onCollapse={() => collapseModule('PLAN')}
                  onContinueEdit={() => continueEdit('PLAN')}
                >
                  <div className="plan-editor-layout compact-plan-editor">
                    <aside className="plan-selector-list">
                      <h3>当前启用计划</h3>
                      {activeMonitoringPlans.length === 0 ? (
                        <div className="empty-state compact-empty">暂无启用中的监测计划。</div>
                      ) : (
                        activeMonitoringPlans.map((item) => (
                          <button
                            key={item.data?.id}
                            type="button"
                            className={
                              selectedPlanId === item.data?.id
                                ? 'plan-selector-card active'
                                : 'plan-selector-card'
                            }
                            onClick={() => choosePlan(item.data?.id)}
                            disabled={submittingMode === 'PLAN'}
                          >
                            <strong>
                              {item.data?.displayName ??
                                vitalTypeLabelMap[item.data?.vitalType] ??
                                item.data?.vitalType}
                            </strong>
                            <span>
                              {item.data?.timesPerUnit ?? 1} 次 /{' '}
                              {item.data?.frequencyUnit === 'DAY'
                                ? '日'
                                : item.data?.frequencyUnit === 'WEEK'
                                  ? '周'
                                  : '月'}
                            </span>
                            <small>
                              {Array.isArray(item.data?.customMeasureTimes)
                                ? item.data.customMeasureTimes.join('、')
                                : '-'}
                            </small>
                          </button>
                        ))
                      )}
                    </aside>

                    <form
                      className="hospital-form monitoring-plan-form"
                      onSubmit={updateMonitoringPlan}
                    >
                      <div className="form-grid form-grid-three">
                        <div className="form-row">
                          <label>指标类型</label>
                          <select
                            value={planDraft.vitalType}
                            onChange={(event) => updatePlanVitalType(event.target.value)}
                            disabled={submittingMode === 'PLAN'}
                          >
                            {Object.entries(vitalTypeLabelMap).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="form-row">
                          <label>显示名称</label>
                          <input
                            value={planDraft.displayName}
                            onChange={(event) => updatePlanDraft('displayName', event.target.value)}
                            required
                            disabled={submittingMode === 'PLAN'}
                          />
                        </div>
                        <div className="form-row">
                          <label>单位</label>
                          <input
                            value={planDraft.unit}
                            onChange={(event) => updatePlanDraft('unit', event.target.value)}
                            required
                            disabled={submittingMode === 'PLAN'}
                          />
                        </div>
                        <div className="form-row">
                          <label>频率单位</label>
                          <select
                            value={planDraft.frequencyUnit}
                            onChange={(event) => updatePlanDraft('frequencyUnit', event.target.value)}
                            disabled={submittingMode === 'PLAN'}
                          >
                            <option value="DAY">每日</option>
                            <option value="WEEK">每周</option>
                            <option value="MONTH">每月</option>
                          </select>
                        </div>
                        <div className="form-row">
                          <label>每单位次数</label>
                          <input
                            type="number"
                            min="1"
                            max="12"
                            value={planDraft.timesPerUnit}
                            onChange={(event) =>
                              updatePlanDraft('timesPerUnit', event.target.value)
                            }
                            required
                            disabled={submittingMode === 'PLAN'}
                          />
                        </div>
                        <div className="form-row">
                          <label>测量时间</label>
                          <input
                            value={planDraft.customMeasureTimes}
                            onChange={(event) =>
                              updatePlanDraft('customMeasureTimes', event.target.value)
                            }
                            placeholder="07:30, 19:30"
                            disabled={submittingMode === 'PLAN'}
                          />
                        </div>
                        <div className="form-row">
                          <label>周/月日期</label>
                          <input
                            value={planDraft.customMeasureDays}
                            onChange={(event) =>
                              updatePlanDraft('customMeasureDays', event.target.value)
                            }
                            placeholder="每周 1-7；每月 1-31"
                            disabled={planDraft.frequencyUnit === 'DAY' || submittingMode === 'PLAN'}
                          />
                        </div>
                      </div>
                      <div className="form-row">
                        <label>调整依据</label>
                        <textarea
                          value={planDraft.evidenceBasis}
                          onChange={(event) =>
                            updatePlanDraft('evidenceBasis', event.target.value)
                          }
                          rows={3}
                          disabled={submittingMode === 'PLAN'}
                        />
                      </div>
                      <div className="form-actions sticky-form-actions pro-form-actions">
                        <button
                          className="button"
                          type="submit"
                          disabled={!selectedPlanId || submittingMode === 'PLAN'}
                        >
                          {submittingMode === 'PLAN' ? '正在保存...' : '保存计划调整'}
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={!selectedPlanId || submittingMode === 'PLAN'}
                          onClick={deactivateMonitoringPlan}
                        >
                          停用该计划
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => collapseModule('PLAN')}
                          disabled={submittingMode === 'PLAN'}
                        >
                          取消
                        </button>
                      </div>
                    </form>
                  </div>
                </TaskActionShell>
              )}

              {moduleView.CLOSE && (
                <TaskActionShell
                  moduleKey="CLOSE"
                  kicker={modeMeta.CLOSE.kicker}
                  title={modeMeta.CLOSE.title}
                  hint="只有确认本任务已经完成全部必要处理动作后，才在这里完成任务并同步处置关联预警。"
                  view={moduleView.CLOSE}
                  statusLabel={getModuleStatusLabel('CLOSE')}
                  statusTone={getModuleStatusTone('CLOSE')}
                  result={actionResults.CLOSE ?? null}
                  isSubmitting={submittingMode === 'CLOSE'}
                  collapsedActionText={modeMeta.CLOSE.collapsedAction}
                  onExpand={() => openModule('CLOSE')}
                  onCollapse={() => collapseModule('CLOSE')}
                  onContinueEdit={() => continueEdit('CLOSE')}
                  locked={taskIsClosed}
                  lockedNotice={
                    <>
                      <strong>当前任务已经结案</strong>
                      <p>
                        任务状态：{statusLabelMap[selectedTask.status] ?? selectedTask.status}
                        。不能重复提交"完成任务"。如需补充说明，请使用电话随访沟通模块保存补充记录。
                      </p>
                    </>
                  }
                >
                  <form className="hospital-form" onSubmit={closeTask}>
                    <div className="form-grid form-grid-two">
                      <div className="form-row">
                        <label>结案结果</label>
                        <select
                          value={closeStatus}
                          onChange={(event) =>
                            setCloseStatus(event.target.value as 'DONE' | 'CANCELED')
                          }
                          disabled={submittingMode === 'CLOSE'}
                        >
                          <option value="DONE">标记为已完成</option>
                          <option value="CANCELED">取消任务 / 不再处理</option>
                        </select>
                      </div>
                      <div className="form-row signature-row">
                        <label>电子签名</label>
                        <input
                          value={closeSignature}
                          onChange={(event) => setCloseSignature(event.target.value)}
                          placeholder="请输入护士姓名 / 工号"
                          disabled={submittingMode === 'CLOSE'}
                        />
                      </div>
                    </div>

                    {selectedTask.relatedAlertId && (
                      <div className="task-processing-sync-box strong-sync-box">
                        <label>
                          <input
                            type="checkbox"
                            checked={closeSyncAlert}
                            onChange={(event) => setCloseSyncAlert(event.target.checked)}
                            disabled={submittingMode === 'CLOSE'}
                          />{' '}
                          完成任务后同步处置关联风险预警
                        </label>
                        <p>默认开启。提交后会把关联预警同步标记为已处理/已忽略，并写入处置记录。</p>
                      </div>
                    )}

                    <div className="form-row">
                      <label>任务处理 / 风险处置记录</label>
                      <textarea
                        value={closeNote}
                        onChange={(event) => setCloseNote(event.target.value)}
                        rows={4}
                        placeholder="请概括电话沟通、复测安排、复诊建议和最终处理结论。"
                        required
                        disabled={submittingMode === 'CLOSE'}
                      />
                    </div>
                    <div className="form-actions sticky-form-actions pro-form-actions">
                      <button
                        className="button"
                        type="submit"
                        disabled={submittingMode === 'CLOSE'}
                      >
                        {submittingMode === 'CLOSE' ? '正在提交...' : '提交结案'}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => collapseModule('CLOSE')}
                        disabled={submittingMode === 'CLOSE'}
                      >
                        取消
                      </button>
                    </div>
                  </form>
                </TaskActionShell>
              )}

              {/* 本次提交记录列表（动作 history） */}
              <TaskActionHistory
                entries={actionHistory}
                onReview={(mode) => {
                  const m = mode as HandlingMode;
                  setModuleView((current) => ({ ...current, [m]: 'review' }));
                }}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

