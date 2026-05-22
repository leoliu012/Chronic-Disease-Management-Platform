export type TimelineVitalEvent = {
  type: string;
  time: string;
  title?: string;
  description?: string;
  data?: {
    id?: string;
    type?: string;
    value?: number | string;
    unit?: string;
    isAbnormal?: boolean;
    measuredAt?: string;
    monitoringPlanId?: string | null;
  } & Record<string, unknown>;
};

export type VitalDisplayItem = {
  key: string;
  metricKey: string;
  label: string;
  valueText: string;
  unit: string;
  time: string;
  isAbnormal: boolean;
  recordCount: number;
};

const vitalTypeLabelMap: Record<string, string> = {
  BLOOD_PRESSURE: '血压（收缩压/舒张压）',
  SYSTOLIC_BP: '血压（收缩压/舒张压）',
  DIASTOLIC_BP: '血压（收缩压/舒张压）',
  BLOOD_GLUCOSE: '血糖',
  WEIGHT: '体重',
  HEART_RATE: '心率',
  SPO2: '血氧',
  LDL_C: '低密度脂蛋白胆固醇',
};

const vitalMetricOrder = [
  'BLOOD_PRESSURE',
  'BLOOD_GLUCOSE',
  'WEIGHT',
  'HEART_RATE',
  'SPO2',
  'LDL_C',
];

function isBloodPressureComponent(type?: string | null) {
  return type === 'SYSTOLIC_BP' || type === 'DIASTOLIC_BP' || type === 'BLOOD_PRESSURE';
}

function formatNumber(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return Number.isInteger(numeric) ? String(numeric) : String(Number(numeric.toFixed(2)));
}

function getEventTime(event: TimelineVitalEvent) {
  return event.time || String(event.data?.measuredAt ?? '');
}

export function buildVitalDisplayItems(events: TimelineVitalEvent[], limit?: number): VitalDisplayItem[] {
  const regularItems: VitalDisplayItem[] = [];
  const bloodPressureGroups = new Map<
    string,
    {
      key: string;
      time: string;
      unit: string;
      systolic?: string;
      diastolic?: string;
      isAbnormal: boolean;
      recordCount: number;
    }
  >();

  events
    .filter((event) => event.type === 'VITAL_RECORD')
    .forEach((event) => {
      const type = event.data?.type;
      const time = getEventTime(event);
      const unit = String(event.data?.unit ?? '');
      const timestamp = new Date(time).getTime() || 0;

      if (isBloodPressureComponent(type)) {
        const groupKey = `BLOOD_PRESSURE:${time}`;
        const group =
          bloodPressureGroups.get(groupKey) ??
          {
            key: groupKey,
            time,
            unit: unit || 'mmHg',
            isAbnormal: false,
            recordCount: 0,
          };

        if (type === 'SYSTOLIC_BP') group.systolic = formatNumber(event.data?.value);
        if (type === 'DIASTOLIC_BP') group.diastolic = formatNumber(event.data?.value);
        if (type === 'BLOOD_PRESSURE' && !group.systolic && !group.diastolic) {
          group.systolic = formatNumber(event.data?.value);
        }

        group.isAbnormal = group.isAbnormal || Boolean(event.data?.isAbnormal);
        group.recordCount += 1;
        bloodPressureGroups.set(groupKey, group);
        return;
      }

      const metricKey = String(type ?? 'UNKNOWN');
      regularItems.push({
        key: `${metricKey}:${time}:${String(event.data?.id ?? event.title ?? timestamp)}`,
        metricKey,
        label: vitalTypeLabelMap[metricKey] ?? metricKey,
        valueText: `${formatNumber(event.data?.value)}${unit ? ` ${unit}` : ''}`,
        unit,
        time,
        isAbnormal: Boolean(event.data?.isAbnormal),
        recordCount: 1,
      });
    });

  const bloodPressureItems: VitalDisplayItem[] = Array.from(bloodPressureGroups.values()).map((group) => {
    const valueText =
      group.systolic && group.diastolic
        ? `${group.systolic}/${group.diastolic} ${group.unit}`
        : group.systolic
          ? `收缩压 ${group.systolic} ${group.unit}`
          : group.diastolic
            ? `舒张压 ${group.diastolic} ${group.unit}`
            : `- ${group.unit}`;

    return {
      key: group.key,
      metricKey: 'BLOOD_PRESSURE',
      label: '血压（收缩压/舒张压）',
      valueText,
      unit: group.unit,
      time: group.time,
      isAbnormal: group.isAbnormal,
      recordCount: group.recordCount,
    };
  });

  const sorted = [...bloodPressureItems, ...regularItems].sort(
    (left, right) => new Date(right.time).getTime() - new Date(left.time).getTime(),
  );

  return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
}

export function buildLatestVitalDisplayItemsByMetric(events: TimelineVitalEvent[]) {
  const latestByMetric = new Map<string, VitalDisplayItem>();

  buildVitalDisplayItems(events).forEach((item) => {
    const existing = latestByMetric.get(item.metricKey);
    if (!existing || new Date(item.time).getTime() > new Date(existing.time).getTime()) {
      latestByMetric.set(item.metricKey, item);
    }
  });

  return Array.from(latestByMetric.values()).sort((left, right) => {
    const leftOrder = vitalMetricOrder.indexOf(left.metricKey);
    const rightOrder = vitalMetricOrder.indexOf(right.metricKey);

    if (leftOrder !== -1 || rightOrder !== -1) {
      return (leftOrder === -1 ? Number.MAX_SAFE_INTEGER : leftOrder) - (rightOrder === -1 ? Number.MAX_SAFE_INTEGER : rightOrder);
    }

    return new Date(right.time).getTime() - new Date(left.time).getTime();
  });
}
