import { nameToken } from './entityNameToken';

export type ActiveTaskProcessingSession = {
  patientId: string;
  taskId: string;
  taskTitle?: string;
  startedAt: string;
};

export type AutoTaskProcessingEventPayload = {
  patientId: string;
  taskId: string;
  eventType: string;
  title: string;
  description: string;
  sourceType?: string;
  sourceId?: string;
};

type SnapshotPayload = {
  key: string;
  value: unknown;
};

type DetailLine = {
  key: string;
  label: string;
  before?: unknown;
  after?: unknown;
  value?: unknown;
};

type EntityContext = {
  entityType: string;
  entityId?: string | null;
  patientId?: string | null;
  isCollection?: boolean;
};

const STORAGE_PREFIX = 'chronic_care_active_task_processing:';
const CURRENT_STORAGE_KEY = 'chronic_care_current_task_processing_session';
const SNAPSHOT_STORAGE_KEY = 'chronic_care_patient_action_snapshots_v1';
const SNAPSHOT_LIMIT = 250;

const INTERNAL_SOURCE_TYPE = 'FRONTEND_AUTO_ASSOCIATION';

function getStorageKey(patientId: string) {
  return `${STORAGE_PREFIX}${patientId}`;
}

export function setActiveTaskProcessingSession(session: ActiveTaskProcessingSession) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(getStorageKey(session.patientId), JSON.stringify(session));
  localStorage.setItem(CURRENT_STORAGE_KEY, JSON.stringify(session));
}

export function getActiveTaskProcessingSession(patientId?: string | null): ActiveTaskProcessingSession | null {
  if (typeof window === 'undefined' || !patientId) return null;
  const raw = localStorage.getItem(getStorageKey(patientId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ActiveTaskProcessingSession;
    if (!parsed.patientId || !parsed.taskId) return null;
    return parsed;
  } catch {
    localStorage.removeItem(getStorageKey(patientId));
    return null;
  }
}

export function getCurrentActiveTaskProcessingSession(): ActiveTaskProcessingSession | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(CURRENT_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ActiveTaskProcessingSession;
    if (!parsed.patientId || !parsed.taskId) return null;
    return parsed;
  } catch {
    localStorage.removeItem(CURRENT_STORAGE_KEY);
    return null;
  }
}

export function clearActiveTaskProcessingSession(patientId?: string | null, taskId?: string | null) {
  if (typeof window === 'undefined' || !patientId) return;
  const current = getActiveTaskProcessingSession(patientId);
  if (!current) return;
  if (taskId && current.taskId !== taskId) return;
  localStorage.removeItem(getStorageKey(patientId));
  const currentGlobal = getCurrentActiveTaskProcessingSession();
  if (!currentGlobal || currentGlobal.patientId === patientId || currentGlobal.taskId === taskId) {
    localStorage.removeItem(CURRENT_STORAGE_KEY);
  }
}

function safeString(value: unknown) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function normalizeUrl(url?: string) {
  return String(url || '').split('?')[0] || '';
}

function pathWithoutQuery(url: string) {
  return normalizeUrl(url);
}

export function getPatientIdFromApiUrl(url?: string) {
  const match = pathWithoutQuery(String(url || '')).match(/\/patients\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function getEntityContextFromApiUrl(url?: string): EntityContext | null {
  const normalized = pathWithoutQuery(String(url || ''));
  const patientId = getPatientIdFromApiUrl(normalized);

  const patientChildMatch = normalized.match(/\/patients\/([^/]+)\/([^/?]+)(?:\/([^/?]+))?/);
  if (patientChildMatch) {
    const collection = patientChildMatch[2];
    const entityId = patientChildMatch[3] ?? null;
    return {
      entityType: collection,
      entityId,
      patientId: decodeURIComponent(patientChildMatch[1]),
      isCollection: !entityId,
    };
  }

  const directPatterns: Array<[RegExp, string]> = [
    [/\/medications\/([^/?]+)/, 'medications'],
    [/\/vital-monitoring-plans\/([^/?]+)/, 'vital-monitoring-plans'],
    [/\/vital-records\/([^/?]+)/, 'vital-records'],
    [/\/follow-ups\/([^/?]+)/, 'follow-ups'],
    [/\/disease-profiles\/([^/?]+)/, 'disease-profiles'],
    [/\/questionnaire-results\/([^/?]+)/, 'questionnaire-results'],
    [/\/hospital-visit-reminders\/([^/?]+)/, 'hospital-visit-reminders'],
    [/\/tasks\/([^/?]+)/, 'tasks'],
    [/\/risk-alerts\/([^/?]+)/, 'risk-alerts'],
  ];

  for (const [pattern, entityType] of directPatterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return { entityType, entityId: decodeURIComponent(match[1]), patientId };
    }
  }

  if (normalized.match(/\/patients\/([^/?]+)$/)) {
    const match = normalized.match(/\/patients\/([^/?]+)$/);
    return { entityType: 'patients', entityId: match?.[1] ? decodeURIComponent(match[1]) : null, patientId };
  }

  return null;
}

function canUseCurrentSessionFallback(url: string) {
  const normalized = pathWithoutQuery(url);
  return (
    normalized.includes('/medications') ||
    normalized.includes('/vital-monitoring-plans') ||
    normalized.includes('/vital-records') ||
    normalized.includes('/follow-ups') ||
    normalized.includes('/disease-profiles') ||
    normalized.includes('/questionnaire') ||
    normalized.includes('/hospital-visit-reminders')
  );
}

function actionTitleForMutation(method: string, url: string) {
  const normalized = pathWithoutQuery(url);
  const verb = method === 'DELETE' ? '删除/停用' : method === 'PATCH' || method === 'PUT' ? '更新' : '新增';

  if (normalized.includes('/hospital-visit-reminders')) return '处理到院提醒';
  if (normalized.includes('/medications')) return `${verb}用药计划`;
  if (normalized.includes('/vital-monitoring-plans')) return `${verb}复测/监测计划`;
  if (normalized.includes('/vital-records')) return `${verb}健康指标记录`;
  if (normalized.includes('/follow-ups')) return `${verb}随访记录`;
  if (normalized.includes('/disease-profiles')) return `${verb}慢病档案`;
  if (normalized.includes('/questionnaire')) return `${verb}问卷记录`;
  if (normalized.includes('/tasks')) return '更新待办任务';
  if (normalized.includes('/risk-alerts')) return '处理风险预警';
  if (normalized.includes('/patients')) return `${verb}患者档案`;

  return `${verb}患者相关信息`;
}

function shouldSkipAutoAssociation(url: string) {
  const normalized = pathWithoutQuery(url);
  return (
    normalized.includes('/processing-events') ||
    normalized.includes('/start-processing') ||
    normalized.includes('/complete-processing') ||
    (normalized.includes('/tasks/') && normalized.includes('/status'))
  );
}

function readSnapshots(): SnapshotPayload[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
    return [];
  }
}

function writeSnapshots(items: SnapshotPayload[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(items.slice(-SNAPSHOT_LIMIT)));
}

function snapshotKey(entityType?: string | null, entityId?: string | null) {
  if (!entityType || !entityId) return null;
  return `${entityType}:${entityId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getObjectId(value: unknown) {
  if (!isRecord(value)) return null;
  const id = value.id ?? value.planId ?? value.recordId;
  return id === undefined || id === null ? null : String(id);
}

function unwrapResponseData(data: unknown) {
  if (isRecord(data) && Array.isArray(data.items)) return data.items;
  if (isRecord(data) && Array.isArray(data.data)) return data.data;
  return data;
}

function inferEntityTypeFromItem(item: Record<string, unknown>, fallbackType?: string | null) {
  if (fallbackType) return fallbackType;
  if ('medicationName' in item) return 'medications';
  if ('vitalType' in item && 'frequencyUnit' in item) return 'vital-monitoring-plans';
  if ('followUpType' in item) return 'follow-ups';
  if ('diseaseType' in item) return 'disease-profiles';
  if ('questionnaireType' in item) return 'questionnaire-results';
  if ('riskType' in item && 'riskLevel' in item) return 'risk-alerts';
  if ('reason' in item && 'remindedAt' in item) return 'hospital-visit-reminders';
  if ('type' in item && 'measuredAt' in item) return 'vital-records';
  return fallbackType ?? null;
}

export function rememberClinicalEntitySnapshotsFromResponse(url?: string, data?: unknown) {
  if (typeof window === 'undefined') return;
  const context = getEntityContextFromApiUrl(url);
  const unwrapped = unwrapResponseData(data);
  const snapshots = readSnapshots();
  const next = new Map(snapshots.map((item) => [item.key, item.value]));

  const rememberOne = (item: unknown, fallbackType?: string | null) => {
    if (!isRecord(item)) return;
    const id = getObjectId(item);
    const entityType = inferEntityTypeFromItem(item, fallbackType);
    const key = snapshotKey(entityType, id);
    if (key) next.set(key, item);
  };

  if (Array.isArray(unwrapped)) {
    for (const item of unwrapped) rememberOne(item, context?.entityType);
  } else if (isRecord(unwrapped)) {
    rememberOne(unwrapped, context?.entityType);

    const nestedCollections: Record<string, string> = {
      diseaseProfiles: 'disease-profiles',
      vitalRecords: 'vital-records',
      followUps: 'follow-ups',
      tasks: 'tasks',
      riskAlerts: 'risk-alerts',
      medicationRecords: 'medications',
      questionnaireResults: 'questionnaire-results',
      vitalMonitoringPlans: 'vital-monitoring-plans',
      hospitalVisitReminders: 'hospital-visit-reminders',
    };

    for (const [field, entityType] of Object.entries(nestedCollections)) {
      const nestedValue = unwrapped[field];
      if (Array.isArray(nestedValue)) {
        for (const item of nestedValue) rememberOne(item, entityType);
      }
    }
  }

  writeSnapshots(Array.from(next.entries()).map(([key, value]) => ({ key, value })));
}

function getSnapshot(entityType?: string | null, entityId?: string | null): Record<string, unknown> | null {
  const key = snapshotKey(entityType, entityId);
  if (!key) return null;
  const item = readSnapshots().find((entry) => entry.key === key);
  return isRecord(item?.value) ? item.value : null;
}

function parsePayload(data?: unknown) {
  if (data === undefined || data === null || data === '') return null;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data;
}

function formatDateTime(value: unknown) {
  const raw = safeString(value);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatJsonValue(value: unknown) {
  if (value === undefined || value === null || value === '') return '未填写';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  if (typeof value === 'string') {
    const dateLike = /^\d{4}-\d{2}-\d{2}T/.test(value) || /^\d{4}-\d{2}-\d{2}$/.test(value);
    return dateLike ? formatDateTime(value) : value;
  }
  if (Array.isArray(value)) return value.map(formatJsonValue).join('、') || '空';
  if (isRecord(value)) return JSON.stringify(value);
  return String(value);
}

function sameValue(left: unknown, right: unknown) {
  if ((left === undefined || left === null || left === '') && (right === undefined || right === null || right === '')) {
    return true;
  }
  return formatJsonValue(left) === formatJsonValue(right);
}

const entityLabelMap: Record<string, string> = {
  medications: '用药计划',
  'vital-monitoring-plans': '复测/监测计划',
  'vital-records': '健康指标记录',
  'follow-ups': '随访记录',
  'disease-profiles': '慢病档案',
  'questionnaire-results': '问卷记录',
  'hospital-visit-reminders': '到院提醒',
  patients: '患者档案',
};

const fieldLabelMap: Record<string, Record<string, string>> = {
  medications: {
    medicationName: '药品名称',
    dosage: '剂量',
    frequency: '频次说明',
    frequencyUnit: '频次单位',
    timesPerUnit: '次数',
    timingRelation: '服药时机',
    instructions: '用药说明',
    startDate: '开始日期',
    endDate: '结束日期',
    isActive: '启用状态',
    reminderLeadMinutes: '提醒提前时间',
    checkInWindowBeforeMinutes: '打卡提前窗口',
    missedWindowAfterMinutes: '逾期窗口',
  },
  'vital-monitoring-plans': {
    vitalType: '指标类型',
    displayName: '指标名称',
    unit: '单位',
    frequencyUnit: '频次单位',
    timesPerUnit: '每日检测次数',
    reminderLeadMinutes: '提醒提前时间',
    checkInWindowBeforeMinutes: '打卡提前窗口',
    missedWindowAfterMinutes: '逾期窗口',
    sourcePreset: '来源模板',
    evidenceBasis: '依据',
    evidenceSource: '依据来源',
    isActive: '启用状态',
  },
  'vital-records': {
    type: '指标类型',
    value: '数值',
    unit: '单位',
    measuredAt: '测量时间',
    dataSource: '数据来源',
    isAbnormal: '是否异常',
    note: '备注',
  },
  'follow-ups': {
    followUpType: '随访类型',
    followUpTime: '随访时间',
    content: '沟通内容',
    result: '随访结果',
    suggestion: '后续建议',
    nextFollowUpTime: '下次随访时间',
    editReason: '操作原因',
  },
  'disease-profiles': {
    diseaseType: '疾病类型',
    diagnosisDate: '诊断日期',
    diseaseStage: '疾病分期',
    complications: '并发症',
    comorbidities: '合并症',
    riskLevel: '风险等级',
  },
  'questionnaire-results': {
    questionnaireType: '问卷类型',
    score: '得分',
    riskLevel: '风险等级',
    riskConclusion: '风险结论',
    note: '备注',
  },
  'hospital-visit-reminders': {
    reason: '提醒原因',
    note: '提醒备注',
    status: '到院状态',
    remindedAt: '提醒时间',
    outcomeNote: '处置备注',
    revokeReason: '撤销原因',
  },
  patients: {
    name: '姓名',
    gender: '性别',
    birthDate: '出生日期',
    phone: '联系电话',
    address: '住址',
    emergencyContactName: '紧急联系人',
    emergencyContactPhone: '紧急联系人电话',
  },
};

const primaryNameFields: Record<string, string[]> = {
  medications: ['medicationName'],
  'vital-monitoring-plans': ['displayName', 'vitalType'],
  'vital-records': ['type'],
  'follow-ups': ['followUpType'],
  'disease-profiles': ['diseaseType'],
  'questionnaire-results': ['questionnaireType'],
  'hospital-visit-reminders': ['reason'],
  patients: ['name'],
};

function normalizeEnum(value: unknown) {
  const raw = safeString(value);
  const map: Record<string, string> = {
    DAY: '每日',
    WEEK: '每周',
    MONTH: '每月',
    NONE: '无特殊时机',
    BEFORE_MEAL: '餐前',
    AFTER_MEAL: '餐后',
    WITH_MEAL: '随餐',
    ACTIVE: '启用/进行中',
    ARRIVED: '已到院',
    NO_SHOW: '未到院',
    REFUSED: '拒绝到院',
    REVOKED: '已撤销',
    MINI_PROGRAM: '患者端',
    NURSE_INPUT: '护士录入',
    HIS: 'HIS',
    EMR: 'EMR',
    LIS: 'LIS',
    MANUAL_IMPORT: '手工导入',
    HIGH: '高危',
    VERY_HIGH: '极高危',
    MEDIUM: '中危',
    LOW: '低危',
  };
  return map[raw] ?? raw;
}

function isDateTimeField(key: string) {
  return (
    key.endsWith('At') ||
    key.endsWith('Date') ||
    ['followUpTime', 'nextFollowUpTime', 'measuredAt', 'scheduledAt'].includes(key)
  );
}

function formatFieldValue(key: string, value: unknown) {
  if (key.toLowerCase().includes('minutes') && value !== undefined && value !== null && value !== '') {
    return `${formatJsonValue(value)} 分钟`;
  }
  if (key === 'timesPerUnit' && value !== undefined && value !== null && value !== '') {
    return `${formatJsonValue(value)} 次`;
  }
  if (isDateTimeField(key)) {
    return formatDateTime(value) || '未填写';
  }
  if (typeof value === 'string' && /^[A-Z0-9_]+$/.test(value)) {
    return normalizeEnum(value) || value;
  }
  return formatJsonValue(value);
}

function getFieldLabel(entityType: string, key: string) {
  return fieldLabelMap[entityType]?.[key] ?? key;
}

function getPrimaryName(entityType: string, value?: unknown) {
  if (!isRecord(value)) return '';
  const fields = primaryNameFields[entityType] ?? ['name', 'title', 'displayName'];
  for (const field of fields) {
    const text = safeString(value[field]);
    if (text) return normalizeEnum(text) || text;
  }
  return '';
}

const systemManagedFields = new Set([
  'id',
  'patientId',
  'createdAt',
  'updatedAt',
  'patient',
  'vitalRecords',
  'message',
  'nextDue',
]);

const patchWithoutSnapshotPriorityFields: Record<string, string[]> = {
  'vital-monitoring-plans': [
    'frequencyUnit',
    'timesPerUnit',
    'customMeasureTimes',
    'customMeasureDays',
    'reminderLeadMinutes',
    'checkInWindowBeforeMinutes',
    'missedWindowAfterMinutes',
    'isActive',
  ],
  'follow-ups': [
    'followUpType',
    'followUpTime',
    'content',
    'result',
    'suggestion',
    'nextFollowUpTime',
    'editReason',
  ],
  medications: [
    'dosage',
    'frequency',
    'frequencyUnit',
    'timesPerUnit',
    'timingRelation',
    'customDoseTimes',
    'customDoseDays',
    'instructions',
    'startDate',
    'endDate',
    'isActive',
  ],
};

function getComparableKeys(
  entityType: string,
  before?: Record<string, unknown> | null,
  after?: Record<string, unknown> | null,
  candidateKeys?: string[],
) {
  if (candidateKeys?.length) {
    return candidateKeys.filter((key) => !systemManagedFields.has(key));
  }

  const known = Object.keys(fieldLabelMap[entityType] ?? {});
  if (known.length) return known;
  const combined = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return Array.from(combined).filter((key) => !systemManagedFields.has(key));
}

function collectCreatedLines(entityType: string, after?: Record<string, unknown> | null, candidateKeys?: string[], limit = 6) {
  if (!after) return [] as DetailLine[];
  const keys = getComparableKeys(entityType, null, after, candidateKeys);
  return keys
    .filter((key) => after[key] !== undefined && after[key] !== null && after[key] !== '')
    .slice(0, limit)
    .map((key) => ({ key, label: getFieldLabel(entityType, key), value: after[key] }));
}

function collectChangedLines(
  entityType: string,
  before?: Record<string, unknown> | null,
  after?: Record<string, unknown> | null,
  candidateKeys?: string[],
  limit = 6,
) {
  if (!after && !before) return [] as DetailLine[];
  const keys = getComparableKeys(entityType, before, after, candidateKeys);
  return keys
    .filter((key) => !sameValue(before?.[key], after?.[key]))
    .slice(0, limit)
    .map((key) => ({ key, label: getFieldLabel(entityType, key), before: before?.[key], after: after?.[key] }));
}

function formatLines(lines: DetailLine[], mode: 'created' | 'changed') {
  if (!lines.length) return '';
  return lines
    .map((line) => {
      if (mode === 'created') return `${line.label}：${formatFieldValue(line.key, line.value)}`;
      return `${line.label}：${formatFieldValue(line.key, line.before)} → ${formatFieldValue(line.key, line.after)}`;
    })
    .join('；');
}

function mergeObjects(...values: unknown[]) {
  const result: Record<string, unknown> = {};
  for (const value of values) {
    if (isRecord(value)) Object.assign(result, value);
  }
  return Object.keys(result).length ? result : null;
}

function formatTimeArray(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return '';
  return value.map((item) => safeString(item)).filter(Boolean).join('、');
}

function formatDayArray(value: unknown, frequencyUnit?: unknown) {
  if (!Array.isArray(value) || value.length === 0) return '';
  const unit = safeString(frequencyUnit);
  if (unit === 'WEEK') {
    const labels: Record<string, string> = {
      '1': '周一',
      '2': '周二',
      '3': '周三',
      '4': '周四',
      '5': '周五',
      '6': '周六',
      '7': '周日',
    };
    return value.map((item) => labels[String(item)] ?? String(item)).join('、');
  }
  return value.map((item) => `${String(item)}日`).join('、');
}

function describeMonitoringFrequency(plan?: Record<string, unknown> | null) {
  if (!plan) return '';
  const unit = normalizeEnum(plan.frequencyUnit) || '每日';
  const times = formatFieldValue('timesPerUnit', plan.timesPerUnit || 1);
  const days = formatDayArray(plan.customMeasureDays, plan.frequencyUnit);
  const measureTimes = formatTimeArray(plan.customMeasureTimes);
  const parts = [unit, times];
  if (days) parts.push(days);
  if (measureTimes) parts.push(`时间 ${measureTimes}`);
  return parts.join(' · ');
}

function getTouchedKeys(requestObject?: Record<string, unknown> | null) {
  if (!requestObject) return [] as string[];
  return Object.keys(requestObject).filter((key) => !systemManagedFields.has(key));
}

function buildVitalMonitoringPlanPatchDescription(
  itemPrefix: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  requestObject: Record<string, unknown> | null,
) {
  const touchedKeys = getTouchedKeys(requestObject);
  const frequencyKeys = ['frequencyUnit', 'timesPerUnit', 'customMeasureTimes', 'customMeasureDays'];
  const reminderKeys = ['reminderLeadMinutes', 'checkInWindowBeforeMinutes', 'missedWindowAfterMinutes', 'isActive'];
  const identityKeys = ['displayName', 'unit'];
  const lines: DetailLine[] = [];

  const frequencyTouched = frequencyKeys.some((key) => touchedKeys.includes(key));
  if (frequencyTouched) {
    const beforeFrequency = describeMonitoringFrequency(before);
    const afterFrequency = describeMonitoringFrequency(after ?? requestObject);
    if (afterFrequency && (!before || beforeFrequency !== afterFrequency)) {
      if (beforeFrequency) {
        lines.push({ key: 'monitoringFrequency', label: '监测频次', before: beforeFrequency, after: afterFrequency });
      } else {
        lines.push({ key: 'monitoringFrequency', label: '监测频次', value: afterFrequency });
      }
    }
  }

  if (before) {
    lines.push(...collectChangedLines('vital-monitoring-plans', before, after, reminderKeys, 4));
    lines.push(...collectChangedLines('vital-monitoring-plans', before, after, identityKeys, 2));
  }

  const uniqueLines = lines.filter((line, index, all) => all.findIndex((item) => item.label === line.label) === index);
  if (uniqueLines.length) {
    const detail = uniqueLines
      .slice(0, 5)
      .map((line) => {
        if (line.value !== undefined) return `${line.label}：${formatFieldValue(line.key, line.value)}`;
        return `${line.label}：${formatFieldValue(line.key, line.before)} → ${formatFieldValue(line.key, line.after)}`;
      })
      .join('；');
    return `更新${itemPrefix}：${detail}。`;
  }

  if (!before && touchedKeys.length) {
    const priorityKeys = patchWithoutSnapshotPriorityFields['vital-monitoring-plans'].filter((key) => touchedKeys.includes(key));
    const submitted = collectCreatedLines('vital-monitoring-plans', requestObject, priorityKeys, 3);
    const detail = formatLines(submitted, 'created');
    if (detail) return `更新${itemPrefix}：已保存 ${detail}。`;
  }

  return '';
}

function describeMedicationSchedule(medication?: Record<string, unknown> | null) {
  if (!medication) return '';
  const unit = normalizeEnum(medication.frequencyUnit) || normalizeEnum(medication.frequency) || '每日';
  const times = formatFieldValue('timesPerUnit', medication.timesPerUnit || 1);
  const days = formatDayArray(medication.customDoseDays, medication.frequencyUnit);
  const doseTimes = formatTimeArray(medication.customDoseTimes);
  const timing = normalizeEnum(medication.timingRelation);
  const parts = [unit, times];
  if (timing && timing !== '无特殊时机' && timing !== 'NONE') parts.push(timing);
  if (days) parts.push(days);
  if (doseTimes) parts.push(`时间 ${doseTimes}`);
  return parts.filter(Boolean).join(' · ');
}



function buildFollowUpPatchDescription(
  itemPrefix: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  requestObject: Record<string, unknown> | null,
) {
  const touchedKeys = getTouchedKeys(requestObject);
  if (!touchedKeys.includes('nextFollowUpTime') && !touchedKeys.includes('editReason')) return '';

  const lines: DetailLine[] = [];
  if (touchedKeys.includes('nextFollowUpTime')) {
    const afterValue = after?.nextFollowUpTime ?? requestObject?.nextFollowUpTime;
    if (before && 'nextFollowUpTime' in before) {
      lines.push({
        key: 'nextFollowUpTime',
        label: getFieldLabel('follow-ups', 'nextFollowUpTime'),
        before: before.nextFollowUpTime,
        after: afterValue,
      });
    } else {
      lines.push({
        key: 'nextFollowUpTime',
        label: getFieldLabel('follow-ups', 'nextFollowUpTime'),
        value: afterValue === null || afterValue === undefined || afterValue === '' ? '已取消' : afterValue,
      });
    }
  }

  const editReason = requestObject?.editReason;
  if (editReason !== undefined && editReason !== null && editReason !== '') {
    lines.push({ key: 'editReason', label: getFieldLabel('follow-ups', 'editReason'), value: editReason });
  }

  const detail = lines
    .map((line) => {
      if (line.value !== undefined) return `${line.label}：${formatFieldValue(line.key, line.value)}`;
      return `${line.label}：${formatFieldValue(line.key, line.before)} → ${formatFieldValue(line.key, line.after)}`;
    })
    .join('；');

  return detail ? `更新${itemPrefix}：${detail}。` : '';
}

function buildMedicationCreateDescription(
  itemPrefix: string,
  after: Record<string, unknown> | null,
  requestObject: Record<string, unknown> | null,
) {
  const source = mergeObjects(requestObject, after);
  if (!source) return `新增${itemPrefix}。`;

  const detailItems: string[] = [];

  if (source.dosage !== undefined && source.dosage !== null && source.dosage !== '') {
    detailItems.push(`剂量：${formatFieldValue('dosage', source.dosage)}`);
  }

  const schedule = describeMedicationSchedule(source);
  if (schedule) {
    detailItems.push(`服药安排：${schedule}`);
  }

  if (source.instructions !== undefined && source.instructions !== null && source.instructions !== '') {
    detailItems.push(`用药说明：${formatFieldValue('instructions', source.instructions)}`);
  }

  if (source.startDate !== undefined && source.startDate !== null && source.startDate !== '') {
    detailItems.push(`开始日期：${formatFieldValue('startDate', source.startDate)}`);
  }

  if (source.endDate !== undefined && source.endDate !== null && source.endDate !== '') {
    detailItems.push(`结束日期：${formatFieldValue('endDate', source.endDate)}`);
  }

  if (!detailItems.length) return `新增${itemPrefix}。`;
  return `新增${itemPrefix}：${detailItems.slice(0, 4).join('；')}。`;
}

function buildMedicationPatchDescription(
  itemPrefix: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  requestObject: Record<string, unknown> | null,
) {
  const touchedKeys = getTouchedKeys(requestObject);
  const scheduleKeys = ['frequency', 'frequencyUnit', 'timesPerUnit', 'timingRelation', 'customDoseTimes', 'customDoseDays'];
  const lines: DetailLine[] = [];

  if (before) {
    if (touchedKeys.includes('dosage') && !sameValue(before.dosage, after?.dosage)) {
      lines.push({ key: 'dosage', label: '剂量', before: before.dosage, after: after?.dosage });
    }

    const scheduleTouched = scheduleKeys.some((key) => touchedKeys.includes(key));
    if (scheduleTouched) {
      const beforeSchedule = describeMedicationSchedule(before);
      const afterSchedule = describeMedicationSchedule(after ?? requestObject);
      if (afterSchedule && beforeSchedule !== afterSchedule) {
        lines.push({ key: 'medicationSchedule', label: '服药安排', before: beforeSchedule, after: afterSchedule });
      }
    }

    const remainingKeys = touchedKeys.filter((key) => !['dosage', ...scheduleKeys].includes(key));
    lines.push(...collectChangedLines('medications', before, after, remainingKeys, 3));

    const uniqueLines = lines.filter((line, index, all) => all.findIndex((item) => item.label === line.label) === index);
    if (uniqueLines.length) {
      const detail = uniqueLines
        .slice(0, 5)
        .map((line) => `${line.label}：${formatFieldValue(line.key, line.before)} → ${formatFieldValue(line.key, line.after)}`)
        .join('；');
      return `更新${itemPrefix}：${detail}。`;
    }

    return `更新${itemPrefix}，未检测到字段差异。`;
  }

  if (!requestObject || !touchedKeys.length) return '';

  const submitted: string[] = [];
  if (touchedKeys.includes('dosage') && requestObject.dosage !== undefined && requestObject.dosage !== null && requestObject.dosage !== '') {
    submitted.push(`剂量：${formatFieldValue('dosage', requestObject.dosage)}`);
  }
  if (scheduleKeys.some((key) => touchedKeys.includes(key))) {
    const schedule = describeMedicationSchedule(requestObject);
    if (schedule) submitted.push(`服药安排：${schedule}`);
  }
  for (const key of ['instructions', 'startDate', 'endDate', 'isActive']) {
    if (touchedKeys.includes(key) && requestObject[key] !== undefined && requestObject[key] !== null && requestObject[key] !== '') {
      submitted.push(`${getFieldLabel('medications', key)}：${formatFieldValue(key, requestObject[key])}`);
    }
  }

  if (submitted.length) {
    return `更新${itemPrefix}：已保存本次修改，${submitted.slice(0, 4).join('；')}。`;
  }

  return `更新${itemPrefix}：已保存本次修改。`;
}

function detailsForMutation(method: string, url: string, requestData?: unknown, responseData?: unknown) {
  const context = getEntityContextFromApiUrl(url);
  const entityType = context?.entityType ?? '';
  const entityLabel = entityLabelMap[entityType] ?? '患者相关信息';
  const parsedRequest = parsePayload(requestData);
  const parsedResponse = unwrapResponseData(responseData);
  const responseObject = isRecord(parsedResponse) ? parsedResponse : null;
  const requestObject = isRecord(parsedRequest) ? parsedRequest : null;
  const resolvedEntityId = context?.entityId ?? getObjectId(responseObject) ?? getObjectId(requestObject);
  const before = getSnapshot(entityType, resolvedEntityId);
  const after = mergeObjects(before, requestObject, responseObject);
  const itemName = getPrimaryName(entityType, after) || getPrimaryName(entityType, before);
  const itemPrefix = itemName ? `${entityLabel}${nameToken(itemName)}` : entityLabel;

  if (method === 'POST') {
    if (entityType === 'medications') {
      return buildMedicationCreateDescription(itemPrefix, responseObject ?? after, requestObject);
    }

    const lines = collectCreatedLines(entityType, responseObject ?? requestObject ?? after);
    const detail = formatLines(lines, 'created');
    return detail ? `新增${itemPrefix}：${detail}。` : `新增${itemPrefix}。`;
  }

  if (method === 'DELETE') {
    const target = before ?? responseObject ?? requestObject;
    const name = getPrimaryName(entityType, target);
    const prefix = name ? `${entityLabel}${nameToken(name)}` : itemPrefix;
    return `删除/停用${prefix}。`;
  }

  if (method === 'PATCH' || method === 'PUT') {
    if (entityType === 'follow-ups') {
      const followUpDescription = buildFollowUpPatchDescription(itemPrefix, before, after, requestObject);
      if (followUpDescription) return followUpDescription;
    }

    if (entityType === 'vital-monitoring-plans') {
      const vitalPlanDescription = buildVitalMonitoringPlanPatchDescription(itemPrefix, before, after, requestObject);
      if (vitalPlanDescription) return vitalPlanDescription;
    }

    if (entityType === 'medications') {
      const medicationDescription = buildMedicationPatchDescription(itemPrefix, before, after, requestObject);
      if (medicationDescription) return medicationDescription;
    }

    const touchedKeys = getTouchedKeys(requestObject);
    const candidateKeys = before && touchedKeys.length ? touchedKeys : undefined;
    const lines = before ? collectChangedLines(entityType, before, after ?? requestObject ?? responseObject, candidateKeys, 5) : [];
    const detail = formatLines(lines, 'changed');
    if (detail) return `更新${itemPrefix}：${detail}。`;

    const submittedKeys = touchedKeys.length ? touchedKeys : patchWithoutSnapshotPriorityFields[entityType];
    const requestLines = collectCreatedLines(entityType, requestObject, submittedKeys, 3);
    const fallbackDetail = formatLines(requestLines, 'created');
    if (fallbackDetail) return `更新${itemPrefix}：已保存本次修改，${fallbackDetail}。`;
    return `更新${itemPrefix}，未检测到字段差异。`;
  }

  return '';
}

export function buildAutoTaskProcessingEventPayload(
  method: string,
  url?: string,
  requestData?: unknown,
  responseData?: unknown,
): AutoTaskProcessingEventPayload | null {
  const rawUrl = String(url || '');
  if (!rawUrl || shouldSkipAutoAssociation(rawUrl)) return null;

  const patientId = getPatientIdFromApiUrl(rawUrl);
  const session =
    getActiveTaskProcessingSession(patientId) ??
    (patientId ? null : canUseCurrentSessionFallback(rawUrl) ? getCurrentActiveTaskProcessingSession() : null);
  if (!session) return null;

  const upperMethod = String(method || 'GET').toUpperCase();
  const title = actionTitleForMutation(upperMethod, rawUrl);
  const detailDescription = detailsForMutation(upperMethod, rawUrl, requestData, responseData);
  const description = detailDescription || `医护在患者详情页执行了“${title}”。`;

  return {
    patientId: session.patientId,
    taskId: session.taskId,
    eventType: 'AUTO_PATIENT_ACTION',
    title,
    description,
    sourceType: INTERNAL_SOURCE_TYPE,
    sourceId: `${upperMethod} ${pathWithoutQuery(rawUrl)}`,
  };
}




