import { useMemo, useState } from 'react';

type TimelineEvent = {
  type: string;
  time: string;
  title: string;
  description: string;
  data: any;
};

type EventMarker = {
  time: string;
  type: 'alert' | 'followup' | 'recheck';
  label: string;
};

type TrendTooltipPoint = {
  id: string;
  label: string;
  value: number;
  unit: string;
  time: string;
  x: number;
  y: number;
};

/**
 * Trend chart time-range filter shared by every chart on the patient detail page.
 *
 * - Quick presets (全部 / 近 7 / 30 / 90 / 180 天) match clinical review windows.
 * - "自定义" exposes two `<input type="date">` controls so the nurse can pick an
 *   arbitrary `[start, end]` window. The window is inclusive on both ends.
 * - A range value of `'all'` means "do not filter, show every record".
 */
export type TrendRangeValue =
  | { kind: 'preset'; preset: 'all' | '7' | '30' | '90' | '180' }
  | { kind: 'custom'; startISO?: string; endISO?: string };

export const DEFAULT_TREND_RANGE: TrendRangeValue = { kind: 'preset', preset: '90' };

const PRESET_OPTIONS: Array<{ value: TrendRangeValue['kind'] extends 'preset' ? never : never; label: string }> = [] as never;

const PRESET_LABELS: Record<'all' | '7' | '30' | '90' | '180', string> = {
  all: '全部',
  '7': '近 7 天',
  '30': '近 30 天',
  '90': '近 90 天',
  '180': '近 180 天',
};

export function filterVitalsByTrendRange<T extends { time: string }>(
  vitals: T[],
  range: TrendRangeValue,
): T[] {
  if (!Array.isArray(vitals) || vitals.length === 0) return vitals ?? [];
  if (range.kind === 'preset') {
    if (range.preset === 'all') return vitals;
    const days = Number(range.preset);
    if (!Number.isFinite(days) || days <= 0) return vitals;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return vitals.filter((item) => {
      const t = new Date(item.time).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
  }
  // custom
  const startMs = range.startISO ? new Date(range.startISO).getTime() : Number.NEGATIVE_INFINITY;
  const endMs = range.endISO ? new Date(range.endISO).getTime() + 24 * 60 * 60 * 1000 - 1 : Number.POSITIVE_INFINITY;
  return vitals.filter((item) => {
    const t = new Date(item.time).getTime();
    if (!Number.isFinite(t)) return false;
    return t >= startMs && t <= endMs;
  });
}

export function describeTrendRange(range: TrendRangeValue): string {
  if (range.kind === 'preset') return PRESET_LABELS[range.preset] ?? '全部';
  const parts: string[] = [];
  if (range.startISO) parts.push(`${range.startISO} 起`);
  if (range.endISO) parts.push(`${range.endISO} 止`);
  if (!parts.length) return '自定义时间范围';
  return parts.join(' · ');
}

/**
 * Shared time-range filter bar. Put this above a stack of trend charts and
 * thread the resulting `range` through `filterVitalsByTrendRange(...)`.
 *
 * Self-contained UI; styles live in `trend-chart-unified-v1.css`.
 */
export function TrendRangeFilterBar({
  value,
  onChange,
  className,
}: {
  value: TrendRangeValue;
  onChange: (next: TrendRangeValue) => void;
  className?: string;
}) {
  const presets: Array<'all' | '7' | '30' | '90' | '180'> = ['all', '7', '30', '90', '180'];
  const isCustom = value.kind === 'custom';
  return (
    <div className={`trend-range-filter-bar ${className ?? ''}`.trim()} role="toolbar" aria-label="趋势图时间范围">
      <span className="trend-range-filter-label">时间范围</span>
      <div className="trend-range-filter-presets" role="group" aria-label="快速时间范围">
        {presets.map((preset) => {
          const active = value.kind === 'preset' && value.preset === preset;
          return (
            <button
              key={preset}
              type="button"
              className={active ? 'trend-range-preset-btn active' : 'trend-range-preset-btn'}
              onClick={() => onChange({ kind: 'preset', preset })}
              aria-pressed={active}
            >
              {PRESET_LABELS[preset]}
            </button>
          );
        })}
        <button
          type="button"
          className={isCustom ? 'trend-range-preset-btn active' : 'trend-range-preset-btn'}
          onClick={() =>
            onChange({
              kind: 'custom',
              startISO: isCustom ? value.startISO : undefined,
              endISO: isCustom ? value.endISO : undefined,
            })
          }
          aria-pressed={isCustom}
        >
          自定义
        </button>
      </div>
      {isCustom && (
        <div className="trend-range-filter-custom">
          <label>
            <span>起</span>
            <input
              type="date"
              value={value.startISO ?? ''}
              onChange={(event) => onChange({ kind: 'custom', startISO: event.target.value || undefined, endISO: value.endISO })}
            />
          </label>
          <label>
            <span>止</span>
            <input
              type="date"
              value={value.endISO ?? ''}
              onChange={(event) => onChange({ kind: 'custom', startISO: value.startISO, endISO: event.target.value || undefined })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function formatPointValue(value: number) {
  if (!Number.isFinite(value)) return '-';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function clampTooltipX(x: number, width: number, rightPadding: number) {
  const tooltipWidth = 176;
  const minX = 8;
  const maxX = Math.max(minX, width - rightPadding - tooltipWidth);
  return Math.min(Math.max(x - tooltipWidth / 2, minX), maxX);
}

function renderTrendTooltip(point: TrendTooltipPoint | null, width: number, padding: { top: number; right: number }, formatTime: (value?: string) => string) {
  if (!point) return null;

  const tooltipWidth = 176;
  const tooltipHeight = 56;
  const tooltipX = clampTooltipX(point.x, width, padding.right);
  const shouldRenderBelow = point.y - tooltipHeight - 12 < padding.top;
  const tooltipY = shouldRenderBelow ? point.y + 12 : point.y - tooltipHeight - 12;
  const anchorY = shouldRenderBelow ? tooltipY : tooltipY + tooltipHeight;

  return (
    <g className="vital-trend-tooltip-svg" pointerEvents="none">
      <line className="vital-trend-tooltip-guide" x1={point.x} y1={point.y} x2={point.x} y2={anchorY} />
      <g transform={`translate(${tooltipX} ${tooltipY})`}>
        <rect className="vital-trend-tooltip-box" width={tooltipWidth} height={tooltipHeight} rx={8} />
        <text className="vital-trend-tooltip-title" x={10} y={18}>{point.label}</text>
        <text className="vital-trend-tooltip-value" x={10} y={35}>数值：{formatPointValue(point.value)} {point.unit}</text>
        <text className="vital-trend-tooltip-time" x={10} y={50}>{formatTime(point.time)}</text>
      </g>
    </g>
  );
}

/**
 * Keep only "risk alert generated" markers. Per spec the trend chart should
 * annotate that single event class — phone follow-up and recheck markers were
 * removed because they distracted from the clinically actionable signal.
 */
function filterRiskAlertMarkers(markers: EventMarker[] | undefined): EventMarker[] {
  if (!markers || markers.length === 0) return [];
  return markers.filter((marker) => marker.type === 'alert');
}

type Props = {
  vitals: TimelineEvent[];
  vitalType: string;
  vitalTypeName: string;
  unit: string;
  thresholdHigh?: number;
  thresholdLow?: number;
  eventMarkers?: EventMarker[];
  formatTime: (value?: string) => string;
  /**
   * Description of the active time range (e.g., "近 90 天"). Shown in the
   * subtitle so the legend stays small but the data window stays explicit.
   */
  rangeLabel?: string;
};

export function VitalTrendChart({
  vitals,
  vitalType,
  vitalTypeName,
  unit,
  thresholdHigh,
  thresholdLow,
  eventMarkers = [],
  formatTime,
  rangeLabel,
}: Props) {
  const [selectedPoint, setSelectedPoint] = useState<TrendTooltipPoint | null>(null);

  // Unified spec: only "风险预警生成" events are annotated on the chart.
  const alertMarkers = useMemo(() => filterRiskAlertMarkers(eventMarkers), [eventMarkers]);

  if (vitals.length === 0) {
    return (
      <div className="vital-trend-chart-container">
        <div className="vital-trend-chart-header">
          <div>
            <div className="vital-trend-chart-title">{vitalTypeName}趋势</div>
            <div className="vital-trend-chart-subtitle">
              {rangeLabel ? `${rangeLabel} · 暂无数据` : '暂无数据'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const sortedVitals = [...vitals].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const values = sortedVitals.map((v) => parseFloat(v.data?.value || '0'));
  const times = sortedVitals.map((v) => new Date(v.time).getTime());

  const minVal = Math.min(...values, thresholdLow ?? Infinity) * 0.9;
  const maxVal = Math.max(...values, thresholdHigh ?? -Infinity) * 1.1;
  const minTime = times[0];
  const maxTime = times[times.length - 1];
  const timeRange = maxTime - minTime || 1;
  const valRange = maxVal - minVal || 1;

  const padding = { top: 20, right: 40, bottom: 40, left: 50 };
  const width = 600;
  const height = 200;
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const toX = (time: number) => padding.left + ((time - minTime) / timeRange) * chartW;
  const toY = (val: number) => padding.top + chartH - ((val - minVal) / valRange) * chartH;

  const points = sortedVitals.map((v, i) => ({
    id: `${vitalType}-${v.data?.id ?? v.time}-${i}`,
    label: vitalTypeName,
    x: toX(times[i]),
    y: toY(values[i]),
    value: values[i],
    unit,
    time: v.time,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + chartH} L ${points[0].x} ${padding.top + chartH} Z`;

  const yTicks = 5;
  const yStep = valRange / yTicks;

  const formatDateShort = (time: string) => {
    const d = new Date(time);
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
  };

  return (
    <div className="vital-trend-chart-container">
      <div className="vital-trend-chart-header">
        <div>
          <div className="vital-trend-chart-title">{vitalTypeName}趋势</div>
          <div className="vital-trend-chart-subtitle">
            {rangeLabel ? `${rangeLabel} · ` : ''}{sortedVitals.length} 次记录 · 单位：{unit}
          </div>
        </div>
        {/* Unified legend (trend-chart-unified-v1):
            colors match the actual rendered shapes (line / threshold / alert marker).
            Only the items that are actually rendered on this chart are listed. */}
        <div className="vital-trend-chart-legend">
          <div className="vital-trend-legend-item">
            <span className="vital-trend-legend-line legend-color-value" />
            <span>{vitalTypeName}</span>
          </div>
          {(thresholdHigh !== undefined || thresholdLow !== undefined) && (
            <div className="vital-trend-legend-item">
              <span className="vital-trend-legend-dash legend-color-threshold" />
              <span>预警阈值</span>
            </div>
          )}
          {alertMarkers.length > 0 && (
            <div className="vital-trend-legend-item">
              <span className="vital-trend-legend-dash legend-color-alert" />
              <span>风险预警生成</span>
            </div>
          )}
        </div>
      </div>

      <svg className="vital-trend-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" onClick={() => setSelectedPoint(null)}>
        <defs>
          <linearGradient id="trendGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y轴网格线和标签 */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const val = minVal + yStep * i;
          const y = toY(val);
          return (
            <g key={`y-${i}`}>
              <line className="vital-trend-grid-line" x1={padding.left} y1={y} x2={width - padding.right} y2={y} />
              <text className="vital-trend-y-label" x={padding.left - 8} y={y + 4}>
                {Math.round(val)}
              </text>
            </g>
          );
        })}

        {/* 阈值线 */}
        {thresholdHigh && (
          <g>
            <line
              className="vital-trend-threshold threshold-high"
              x1={padding.left}
              y1={toY(thresholdHigh)}
              x2={width - padding.right}
              y2={toY(thresholdHigh)}
            />
            <text className="vital-trend-threshold-label" x={width - padding.right + 4} y={toY(thresholdHigh) + 4}>
              {thresholdHigh}
            </text>
          </g>
        )}

        {thresholdLow && (
          <line
            className="vital-trend-threshold threshold-low"
            x1={padding.left}
            y1={toY(thresholdLow)}
            x2={width - padding.right}
            y2={toY(thresholdLow)}
          />
        )}

        {/* 面积填充 */}
        <path className="vital-trend-area" d={areaPath} />

        {/* 折线 */}
        <path className="vital-trend-line" d={linePath} />

        {/* 事件标注：只显示"风险预警生成" */}
        {alertMarkers.map((marker, i) => {
          const markerTime = new Date(marker.time).getTime();
          if (markerTime < minTime || markerTime > maxTime) return null;
          const x = toX(markerTime);
          return (
            <g key={`marker-${i}`} className="vital-trend-event-marker marker-alert">
              <line x1={x} y1={padding.top} x2={x} y2={padding.top + chartH} />
              <text className="vital-trend-event-icon" x={x} y={padding.top - 4}>
                ⚠
              </text>
            </g>
          );
        })}

        {/* 数据点 */}
        {points.map((p, i) => {
          let pointClass = 'vital-trend-point';
          if (thresholdHigh && p.value >= thresholdHigh) pointClass += ' point-danger';
          else if (thresholdHigh && p.value >= thresholdHigh * 0.9) pointClass += ' point-warning';
          if (selectedPoint?.id === p.id) pointClass += ' is-active';
          return (
            <circle
              key={`point-${i}`}
              className={pointClass}
              cx={p.x}
              cy={p.y}
              r={4.5}
              role="button"
              tabIndex={0}
              aria-label={`${vitalTypeName} ${formatPointValue(p.value)} ${unit}，${formatTime(p.time)}`}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedPoint(p);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedPoint(p);
                }
              }}
            >
              <title>{`${formatPointValue(p.value)} ${unit} · ${formatTime(p.time)}`}</title>
            </circle>
          );
        })}

        {renderTrendTooltip(selectedPoint, width, padding, formatTime)}

        {/* X轴标签 */}
        {points.map((p, i) => {
          if (points.length > 10 && i % 2 !== 0) return null;
          return (
            <text key={`x-${i}`} className="vital-trend-x-label" x={p.x} y={height - 8}>
              {formatDateShort(sortedVitals[i].time)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}




type BloodPressureProps = {
  systolicVitals: TimelineEvent[];
  diastolicVitals: TimelineEvent[];
  unit: string;
  eventMarkers?: EventMarker[];
  formatTime: (value?: string) => string;
  rangeLabel?: string;
};

function buildSeriesPoints(
  vitals: TimelineEvent[],
  times: number[],
  minTime: number,
  timeRange: number,
  minVal: number,
  valRange: number,
  padding: { top: number; right: number; bottom: number; left: number },
  chartW: number,
  chartH: number,
) {
  const sorted = [...vitals].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const toX = (time: number) => padding.left + ((time - minTime) / timeRange) * chartW;
  const toY = (val: number) => padding.top + chartH - ((val - minVal) / valRange) * chartH;
  return sorted.map((v) => {
    const time = new Date(v.time).getTime();
    const value = parseFloat(v.data?.value || '0');
    return { x: toX(time), y: toY(value), value, time: v.time };
  });
}

export function BloodPressureTrendChart({
  systolicVitals,
  diastolicVitals,
  unit,
  eventMarkers = [],
  formatTime,
  rangeLabel,
}: BloodPressureProps) {
  const [selectedPoint, setSelectedPoint] = useState<TrendTooltipPoint | null>(null);
  const alertMarkers = useMemo(() => filterRiskAlertMarkers(eventMarkers), [eventMarkers]);

  const allVitals = [...systolicVitals, ...diastolicVitals];
  if (allVitals.length === 0) {
    return (
      <div className="vital-trend-chart-container">
        <div className="vital-trend-chart-header">
          <div>
            <div className="vital-trend-chart-title">血压趋势</div>
            <div className="vital-trend-chart-subtitle">
              {rangeLabel ? `${rangeLabel} · 暂无数据` : '暂无数据'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const sortedAll = [...allVitals].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const values = sortedAll.map((v) => parseFloat(v.data?.value || '0'));
  const times = sortedAll.map((v) => new Date(v.time).getTime());

  const minVal = Math.min(...values, 60) * 0.9;
  const maxVal = Math.max(...values, 160) * 1.1;
  const minTime = times[0];
  const maxTime = times[times.length - 1];
  const timeRange = maxTime - minTime || 1;
  const valRange = maxVal - minVal || 1;

  const padding = { top: 20, right: 56, bottom: 40, left: 50 };
  const width = 600;
  const height = 220;
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const toY = (val: number) => padding.top + chartH - ((val - minVal) / valRange) * chartH;
  const toX = (time: number) => padding.left + ((time - minTime) / timeRange) * chartW;
  const systolicPoints = buildSeriesPoints(systolicVitals, times, minTime, timeRange, minVal, valRange, padding, chartW, chartH);
  const diastolicPoints = buildSeriesPoints(diastolicVitals, times, minTime, timeRange, minVal, valRange, padding, chartW, chartH);
  const toPath = (points: Array<{ x: number; y: number }>) => points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const yTicks = 5;
  const yStep = valRange / yTicks;
  const uniqueTimes = Array.from(new Set(times)).sort((a, b) => a - b);

  const formatDateShort = (time: number) => {
    const d = new Date(time);
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
  };

  return (
    <div className="vital-trend-chart-container blood-pressure-trend-chart">
      <div className="vital-trend-chart-header">
        <div>
          <div className="vital-trend-chart-title">血压趋势</div>
          <div className="vital-trend-chart-subtitle">
            {rangeLabel ? `${rangeLabel} · ` : ''}收缩压 {systolicVitals.length} 次 · 舒张压 {diastolicVitals.length} 次 · 单位：{unit}
          </div>
        </div>
        {/* Unified legend: legend swatches use the exact color of the matching
            line / threshold / marker rendered below. */}
        <div className="vital-trend-chart-legend">
          <div className="vital-trend-legend-item">
            <span className="vital-trend-legend-line legend-color-systolic" />
            <span>收缩压</span>
          </div>
          <div className="vital-trend-legend-item">
            <span className="vital-trend-legend-line legend-color-diastolic" />
            <span>舒张压</span>
          </div>
          <div className="vital-trend-legend-item">
            <span className="vital-trend-legend-dash legend-color-threshold" />
            <span>收缩压阈值</span>
          </div>
          <div className="vital-trend-legend-item">
            <span className="vital-trend-legend-dash legend-color-diastolic-threshold" />
            <span>舒张压阈值</span>
          </div>
          {alertMarkers.length > 0 && (
            <div className="vital-trend-legend-item">
              <span className="vital-trend-legend-dash legend-color-alert" />
              <span>风险预警生成</span>
            </div>
          )}
        </div>
      </div>

      <svg className="vital-trend-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" onClick={() => setSelectedPoint(null)}>
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const val = minVal + yStep * i;
          const y = toY(val);
          return (
            <g key={`bp-y-${i}`}>
              <line className="vital-trend-grid-line" x1={padding.left} y1={y} x2={width - padding.right} y2={y} />
              <text className="vital-trend-y-label" x={padding.left - 8} y={y + 4}>{Math.round(val)}</text>
            </g>
          );
        })}

        <g>
          <line className="vital-trend-threshold threshold-high" x1={padding.left} y1={toY(160)} x2={width - padding.right} y2={toY(160)} />
          <text className="vital-trend-threshold-label" x={width - padding.right + 4} y={toY(160) + 4}>收缩160</text>
        </g>
        <g>
          <line className="vital-trend-threshold threshold-diastolic-high" x1={padding.left} y1={toY(100)} x2={width - padding.right} y2={toY(100)} />
          <text className="vital-trend-threshold-label threshold-diastolic-label" x={width - padding.right + 4} y={toY(100) + 4}>舒张100</text>
        </g>

        {systolicPoints.length > 0 && <path className="vital-trend-line bp-systolic-line" d={toPath(systolicPoints)} />}
        {diastolicPoints.length > 0 && <path className="vital-trend-line bp-diastolic-line" d={toPath(diastolicPoints)} />}

        {alertMarkers.map((marker, i) => {
          const markerTime = new Date(marker.time).getTime();
          if (markerTime < minTime || markerTime > maxTime) return null;
          const x = toX(markerTime);
          return (
            <g key={`bp-marker-${i}`} className="vital-trend-event-marker marker-alert">
              <line x1={x} y1={padding.top} x2={x} y2={padding.top + chartH} />
              <text className="vital-trend-event-icon" x={x} y={padding.top - 4}>⚠</text>
            </g>
          );
        })}

        {systolicPoints.map((p, i) => {
          const point: TrendTooltipPoint = { ...p, id: `bp-s-${p.time}-${i}`, label: '收缩压', unit };
          const pointClass = `vital-trend-point bp-systolic-point ${p.value >= 160 ? 'point-danger' : ''} ${selectedPoint?.id === point.id ? 'is-active' : ''}`;
          return (
            <circle
              key={`bp-s-${i}`}
              className={pointClass}
              cx={p.x}
              cy={p.y}
              r={4.5}
              role="button"
              tabIndex={0}
              aria-label={`收缩压 ${formatPointValue(p.value)} ${unit}，${formatTime(p.time)}`}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedPoint(point);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedPoint(point);
                }
              }}
            >
              <title>{`收缩压 ${formatPointValue(p.value)} ${unit} · ${formatTime(p.time)}`}</title>
            </circle>
          );
        })}
        {diastolicPoints.map((p, i) => {
          const point: TrendTooltipPoint = { ...p, id: `bp-d-${p.time}-${i}`, label: '舒张压', unit };
          const pointClass = `vital-trend-point bp-diastolic-point ${p.value >= 100 ? 'point-danger' : ''} ${selectedPoint?.id === point.id ? 'is-active' : ''}`;
          return (
            <circle
              key={`bp-d-${i}`}
              className={pointClass}
              cx={p.x}
              cy={p.y}
              r={4.5}
              role="button"
              tabIndex={0}
              aria-label={`舒张压 ${formatPointValue(p.value)} ${unit}，${formatTime(p.time)}`}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedPoint(point);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedPoint(point);
                }
              }}
            >
              <title>{`舒张压 ${formatPointValue(p.value)} ${unit} · ${formatTime(p.time)}`}</title>
            </circle>
          );
        })}

        {renderTrendTooltip(selectedPoint, width, padding, formatTime)}

        {uniqueTimes.map((time, i) => {
          if (uniqueTimes.length > 10 && i % 2 !== 0) return null;
          return <text key={`bp-x-${time}`} className="vital-trend-x-label" x={toX(time)} y={height - 8}>{formatDateShort(time)}</text>;
        })}
      </svg>
    </div>
  );
}


type MiniVitalTrendPreviewProps = {
  vitals: TimelineEvent[];
  unit: string;
  thresholdHigh?: number;
  thresholdLow?: number;
  formatTime: (value?: string) => string;
};

export function MiniVitalTrendPreview({
  vitals,
  unit,
  thresholdHigh,
  thresholdLow,
  formatTime,
}: MiniVitalTrendPreviewProps) {
  if (vitals.length === 0) {
    return <div className="vital-trend-mini-empty">暂无趋势数据</div>;
  }

  const sortedVitals = [...vitals].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const values = sortedVitals.map((v) => Number(v.data?.value ?? 0));
  const times = sortedVitals.map((v) => new Date(v.time).getTime());
  const minVal = Math.min(...values, thresholdLow ?? Number.POSITIVE_INFINITY);
  const maxVal = Math.max(...values, thresholdHigh ?? Number.NEGATIVE_INFINITY);
  const safeMin = Number.isFinite(minVal) ? minVal * 0.94 : Math.min(...values) * 0.94;
  const safeMax = Number.isFinite(maxVal) ? maxVal * 1.06 : Math.max(...values) * 1.06;
  const minTime = times[0];
  const maxTime = times[times.length - 1];
  const timeRange = maxTime - minTime || 1;
  const valRange = safeMax - safeMin || 1;

  const width = 220;
  const height = 92;
  const padding = { top: 10, right: 8, bottom: 10, left: 8 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const toX = (time: number) => padding.left + ((time - minTime) / timeRange) * chartW;
  const toY = (value: number) => padding.top + chartH - ((value - safeMin) / valRange) * chartH;
  const points = sortedVitals.map((item, index) => ({
    x: toX(times[index]),
    y: toY(values[index]),
    value: values[index],
    time: item.time,
  }));
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

  return (
    <div className="vital-trend-mini-card">
      <svg className="vital-trend-mini-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {thresholdHigh ? (
          <line className="vital-trend-mini-threshold threshold-high" x1={padding.left} y1={toY(thresholdHigh)} x2={width - padding.right} y2={toY(thresholdHigh)} />
        ) : null}
        {thresholdLow ? (
          <line className="vital-trend-mini-threshold threshold-low" x1={padding.left} y1={toY(thresholdLow)} x2={width - padding.right} y2={toY(thresholdLow)} />
        ) : null}
        <path className="vital-trend-mini-line" d={linePath} />
        {points.map((point, index) => (
          <circle
            key={`mini-point-${index}`}
            className={`vital-trend-mini-point ${index === points.length - 1 ? 'is-latest' : ''}`}
            cx={point.x}
            cy={point.y}
            r={index === points.length - 1 ? 4 : 3}
          >
            <title>{`${point.value} ${unit} · ${formatTime(point.time)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="vital-trend-mini-meta">近 {sortedVitals.length} 次</div>
    </div>
  );
}

export function MiniBloodPressureTrendPreview({
  systolicVitals,
  diastolicVitals,
  unit,
  formatTime,
}: BloodPressureProps) {
  const allVitals = [...systolicVitals, ...diastolicVitals];
  if (allVitals.length === 0) {
    return <div className="vital-trend-mini-empty">暂无趋势数据</div>;
  }

  const sortedAll = [...allVitals].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const values = sortedAll.map((v) => Number(v.data?.value ?? 0));
  const times = sortedAll.map((v) => new Date(v.time).getTime());
  const minVal = Math.min(...values, 60) * 0.94;
  const maxVal = Math.max(...values, 160) * 1.06;
  const minTime = times[0];
  const maxTime = times[times.length - 1];
  const timeRange = maxTime - minTime || 1;
  const valRange = maxVal - minVal || 1;

  const width = 220;
  const height = 92;
  const padding = { top: 10, right: 8, bottom: 10, left: 8 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const toX = (time: number) => padding.left + ((time - minTime) / timeRange) * chartW;
  const toY = (value: number) => padding.top + chartH - ((value - minVal) / valRange) * chartH;
  const buildMiniPoints = (series: TimelineEvent[]) =>
    [...series]
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
      .map((item) => {
        const time = new Date(item.time).getTime();
        const value = Number(item.data?.value ?? 0);
        return { x: toX(time), y: toY(value), value, time: item.time };
      });
  const systolicPoints = buildMiniPoints(systolicVitals);
  const diastolicPoints = buildMiniPoints(diastolicVitals);
  const pathFor = (points: Array<{ x: number; y: number }>) => points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

  return (
    <div className="vital-trend-mini-card vital-trend-mini-card-bp">
      <div className="vital-trend-mini-badges">
        <span className="vital-trend-mini-badge badge-systolic">收缩压</span>
        <span className="vital-trend-mini-badge badge-diastolic">舒张压</span>
      </div>
      <svg className="vital-trend-mini-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <line className="vital-trend-mini-threshold threshold-high" x1={padding.left} y1={toY(160)} x2={width - padding.right} y2={toY(160)} />
        <line className="vital-trend-mini-threshold threshold-diastolic-high" x1={padding.left} y1={toY(100)} x2={width - padding.right} y2={toY(100)} />
        {systolicPoints.length > 1 ? <path className="vital-trend-mini-line line-systolic" d={pathFor(systolicPoints)} /> : null}
        {diastolicPoints.length > 1 ? <path className="vital-trend-mini-line line-diastolic" d={pathFor(diastolicPoints)} /> : null}
        {systolicPoints.map((point, index) => (
          <circle
            key={`mini-bp-s-${index}`}
            className={`vital-trend-mini-point point-systolic ${index === systolicPoints.length - 1 ? 'is-latest' : ''}`}
            cx={point.x}
            cy={point.y}
            r={index === systolicPoints.length - 1 ? 4 : 3}
          >
            <title>{`收缩压 ${point.value} ${unit} · ${formatTime(point.time)}`}</title>
          </circle>
        ))}
        {diastolicPoints.map((point, index) => (
          <circle
            key={`mini-bp-d-${index}`}
            className={`vital-trend-mini-point point-diastolic ${index === diastolicPoints.length - 1 ? 'is-latest' : ''}`}
            cx={point.x}
            cy={point.y}
            r={index === diastolicPoints.length - 1 ? 4 : 3}
          >
            <title>{`舒张压 ${point.value} ${unit} · ${formatTime(point.time)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="vital-trend-mini-meta">收缩压 {systolicPoints.length} 次 · 舒张压 {diastolicPoints.length} 次</div>
    </div>
  );
}
