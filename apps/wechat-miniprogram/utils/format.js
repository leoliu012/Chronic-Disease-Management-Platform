const typeLabels = {
  BLOOD_PRESSURE: '血压（收缩压/舒张压）',
  SYSTOLIC_BP: '血压（收缩压）',
  DIASTOLIC_BP: '血压（舒张压）',
  BLOOD_GLUCOSE: '血糖',
  WEIGHT: '体重',
  HEART_RATE: '心率',
  SPO2: '血氧'
};

const riskLabels = {
  LOW: '低危',
  MEDIUM: '中危',
  HIGH: '高危',
  VERY_HIGH: '极高危'
};

const taskStatusLabels = {
  PENDING: '待处理',
  IN_PROGRESS: '处理中',
  DONE: '已完成',
  CANCELED: '已取消'
};

const alertStatusLabels = {
  OPEN: '待处理',
  IN_PROGRESS: '处理中',
  RESOLVED: '已处理',
  DISMISSED: '已忽略'
};

function labelOf(map, value) {
  return map[value] || value || '未填写';
}

function formatDateTime(value) {
  if (!value) return '未设置';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function statusClass(status) {
  if (status === 'OPEN' || status === 'PENDING') return 'status-open';
  if (status === 'IN_PROGRESS') return 'status-progress';
  if (status === 'DONE' || status === 'RESOLVED') return 'status-done';
  return 'status-muted';
}

module.exports = {
  typeLabels,
  riskLabels,
  taskStatusLabels,
  alertStatusLabels,
  labelOf,
  formatDateTime,
  statusClass
};


