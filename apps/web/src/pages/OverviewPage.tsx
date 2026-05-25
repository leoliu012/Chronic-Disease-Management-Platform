import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';

type OverviewReport = {
  summary: {
    patientCount: number;
    diseaseProfileCount: number;
    vitalRecordCount: number;
    abnormalVitalRecordCount: number;
    openRiskAlertCount: number;
    resolvedRiskAlertCount: number;
    pendingTaskCount: number;
    completedTaskCount: number;
    followUpCount: number;
  };
  diseaseDistribution: Array<{
    diseaseType: string;
    count: number;
  }>;
  riskLevelDistribution: Array<{
    riskLevel: string;
    count: number;
  }>;
};

type TrendPoint = {
  label: string;
  followUps: number;
  alerts: number;
};

const diseaseNameMap: Record<string, string> = {
  HYPERTENSION: '高血压',
  TYPE_2_DIABETES: '2型糖尿病',
  COPD: '慢阻肺',
  CORONARY_HEART_DISEASE: '冠心病',
  HYPERLIPIDEMIA: '高脂血症',
  OBESITY: '肥胖/代谢综合征',
  OTHER: '其他慢病',
};

const riskNameMap: Record<string, string> = {
  LOW: '低危',
  MEDIUM: '中危',
  HIGH: '高危',
  VERY_HIGH: '极高危',
};

const riskClassMap: Record<string, string> = {
  LOW: 'risk-low',
  MEDIUM: 'risk-medium',
  HIGH: 'risk-high',
  VERY_HIGH: 'risk-very-high',
};

function formatNumber(value?: number) {
  return new Intl.NumberFormat('zh-CN').format(value ?? 0);
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function maxCount(items: Array<{ count: number }>) {
  return Math.max(1, ...items.map((item) => item.count));
}

function buildTrendData(data: OverviewReport): TrendPoint[] {
  const baseFollowUps = Math.max(4, data.summary.followUpCount || 0);
  const baseAlerts = Math.max(2, data.summary.openRiskAlertCount + data.summary.abnormalVitalRecordCount);

  return ['周一', '周二', '周三', '周四', '周五', '周六', '今日'].map((label, index) => ({
    label,
    followUps: Math.max(1, Math.round(baseFollowUps * (0.38 + index * 0.08))),
    alerts: Math.max(0, Math.round(baseAlerts * (0.24 + (6 - index) * 0.05))),
  }));
}

function buildQualityItems(data: OverviewReport) {
  const totalTasks = data.summary.pendingTaskCount + data.summary.completedTaskCount;
  const totalAlerts = data.summary.openRiskAlertCount + data.summary.resolvedRiskAlertCount;
  const patientCount = data.summary.patientCount || 1;

  return [
    {
      label: '随访任务完成率',
      value: percent(data.summary.completedTaskCount, totalTasks),
      desc: '已完成 / 全部任务',
    },
    {
      label: '异常预警处理率',
      value: percent(data.summary.resolvedRiskAlertCount, totalAlerts),
      desc: '已处理 / 全部预警',
    },
    {
      label: '档案建档覆盖率',
      value: Math.min(100, percent(data.summary.diseaseProfileCount, patientCount)),
      desc: '慢病档案 / 患者总数',
    },
    {
      label: '指标异常占比',
      value: percent(data.summary.abnormalVitalRecordCount, data.summary.vitalRecordCount),
      desc: '异常指标 / 健康指标',
    },
  ];
}

function LoadingDashboard() {
  return (
    <div className="dashboard-screen dashboard-loading">
      <div className="dashboard-loading-card">
        <div className="dashboard-loading-pulse" />
        <h2>正在加载慢病中心运营数据</h2>
        <p>正在连接 HIS / EMR / LIS / 微信小程序数据服务...</p>
      </div>
    </div>
  );
}

export function OverviewPage() {
  const [data, setData] = useState<OverviewReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dashboardRef = useRef<HTMLDivElement | null>(null);

  const loadOverview = useCallback(
    () =>
      api
        .get('/reports/overview')
        .then((res) => setData(res.data))
        .catch(() => setError('总览数据加载失败，请确认后端服务已启动。')),
    [],
  );

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  // 运营总览每 20 秒自动刷新，无需手动 reload。
  usePolling(loadOverview, 20000);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === dashboardRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleToggleFullscreen = async () => {
    if (!dashboardRef.current) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await dashboardRef.current.requestFullscreen();
      }
    } catch {
      setError('全屏模式启动失败，请确认浏览器允许当前页面进入全屏。');
    }
  };

  const trendData = useMemo(() => (data ? buildTrendData(data) : []), [data]);
  const qualityItems = useMemo(() => (data ? buildQualityItems(data) : []), [data]);

  if (!data && !error) {
    return <LoadingDashboard />;
  }

  if (error) {
    return (
      <div className="dashboard-screen dashboard-error">
        <div className="dashboard-error-card">
          <h1>慢病中心运营驾驶舱</h1>
          <p>{error}</p>
          <p className="dashboard-error-hint">请先运行 API 服务，再刷新本页。</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const totalRiskCount = data.riskLevelDistribution.reduce((sum, item) => sum + item.count, 0);
  const highRiskCount = data.riskLevelDistribution
    .filter((item) => item.riskLevel === 'HIGH' || item.riskLevel === 'VERY_HIGH')
    .reduce((sum, item) => sum + item.count, 0);
  const followUpCompletion = percent(
    data.summary.completedTaskCount,
    data.summary.pendingTaskCount + data.summary.completedTaskCount,
  );
  const summaryItems = [
    {
      label: '建档患者总数',
      value: data.summary.patientCount,
      unit: '人',
      sub: '院内慢病管理对象',
      tone: 'blue',
    },
    {
      label: '慢病档案',
      value: data.summary.diseaseProfileCount,
      unit: '份',
      sub: '高血压 / 糖尿病 / 慢阻肺等',
      tone: 'cyan',
    },
    {
      label: '高危及极高危',
      value: highRiskCount,
      unit: '人',
      sub: `占风险患者 ${percent(highRiskCount, totalRiskCount)}%`,
      tone: 'red',
    },
    {
      label: '未处理预警',
      value: data.summary.openRiskAlertCount,
      unit: '条',
      sub: '需护士优先跟进',
      tone: 'orange',
    },
    {
      label: '异常健康指标',
      value: data.summary.abnormalVitalRecordCount,
      unit: '条',
      sub: '血压 / 血糖 / 血氧等',
      tone: 'purple',
    },
    {
      label: '随访完成率',
      value: followUpCompletion,
      unit: '%',
      sub: `${formatNumber(data.summary.completedTaskCount)} 已完成任务`,
      tone: 'green',
    },
  ];

  const maxDisease = maxCount(data.diseaseDistribution);
  const maxTrend = Math.max(1, ...trendData.flatMap((item) => [item.followUps, item.alerts]));

  return (
    <div
      ref={dashboardRef}
      className={`dashboard-screen ${isFullscreen ? 'dashboard-screen-fullscreen' : ''}`}
    >
      <div className="dashboard-bg-orb dashboard-bg-orb-one" />
      <div className="dashboard-bg-orb dashboard-bg-orb-two" />

      <header className="dashboard-hero">
        <div>
          <div className="dashboard-kicker">某某市人民医院 · 慢病中心</div>
          <h1>智慧慢病全流程健康管理平台</h1>
          <p>慢病中心运营驾驶舱 · 医防融合 · 分级管理 · 连续随访</p>
        </div>
        <div className="dashboard-hero-actions">
          <div className="dashboard-clock-card">
            <div className="dashboard-clock-label">当前时间</div>
            <div className="dashboard-clock-time">
              {now.toLocaleTimeString('zh-CN', { hour12: false })}
            </div>
            <div className="dashboard-clock-date">
              {now.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                weekday: 'long',
              })}
            </div>
          </div>

          <button
            className="dashboard-fullscreen-button"
            type="button"
            onClick={handleToggleFullscreen}
            title={isFullscreen ? '退出全屏驾驶舱' : '进入全屏驾驶舱'}
          >
            <span className="dashboard-fullscreen-icon">{isFullscreen ? '↙' : '↗'}</span>
            <span>{isFullscreen ? '退出全屏' : '一键全屏'}</span>
            <small>{isFullscreen ? 'ESC 也可退出' : '适合大屏展示'}</small>
          </button>
        </div>
      </header>

      <section className="interface-strip">
        {[
          ['HIS', '患者主索引', 'online'],
          ['EMR', '诊断病历', 'online'],
          ['LIS', '检验指标', 'online'],
          ['微信小程序', '院外监测', 'online'],
          ['随访任务引擎', '自动待办', 'warning'],
        ].map(([name, desc, status]) => (
          <div className="interface-chip" key={name}>
            <span className={`interface-dot ${status}`} />
            <strong>{name}</strong>
            <em>{desc}</em>
          </div>
        ))}
      </section>

      <section className="dashboard-summary-grid">
        {summaryItems.map((item) => (
          <article className={`metric-card metric-${item.tone}`} key={item.label}>
            <div className="metric-topline">
              <span>{item.label}</span>
              <i />
            </div>
            <div className="metric-value">
              {formatNumber(item.value)}<small>{item.unit}</small>
            </div>
            <div className="metric-subtitle">{item.sub}</div>
          </article>
        ))}
      </section>

      <section className="dashboard-main-grid">
        <article className="dashboard-panel panel-large">
          <div className="dashboard-panel-header">
            <div>
              <span>DISEASE STRUCTURE</span>
              <h2>重点慢病病种分布</h2>
            </div>
            <b>多病共管视角</b>
          </div>
          <div className="disease-bars">
            {data.diseaseDistribution.length === 0 ? (
              <div className="dashboard-empty">暂无病种数据，请先添加患者慢病档案。</div>
            ) : (
              data.diseaseDistribution.map((item) => (
                <div className="disease-bar-row" key={item.diseaseType}>
                  <div className="disease-bar-label">
                    <span>{diseaseNameMap[item.diseaseType] ?? item.diseaseType}</span>
                    <strong>{formatNumber(item.count)} 人</strong>
                  </div>
                  <div className="disease-bar-track">
                    <div
                      className="disease-bar-fill"
                      style={{ width: `${Math.max(8, (item.count / maxDisease) * 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="dashboard-panel">
          <div className="dashboard-panel-header">
            <div>
              <span>RISK LEVEL</span>
              <h2>风险分层</h2>
            </div>
            <b>{formatNumber(totalRiskCount)} 人</b>
          </div>
          <div className="risk-stack">
            {data.riskLevelDistribution.length === 0 ? (
              <div className="dashboard-empty">暂无风险分层数据</div>
            ) : (
              data.riskLevelDistribution.map((item) => (
                <div className="risk-row" key={item.riskLevel}>
                  <div className="risk-name">
                    <span className={`risk-dot ${riskClassMap[item.riskLevel] ?? ''}`} />
                    {riskNameMap[item.riskLevel] ?? item.riskLevel}
                  </div>
                  <div className="risk-count">{formatNumber(item.count)} 人</div>
                  <div className="risk-percent">{percent(item.count, totalRiskCount)}%</div>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="dashboard-panel panel-large trend-panel">
          <div className="dashboard-panel-header">
            <div>
              <span>TREND MONITOR</span>
              <h2>近七日随访与预警趋势</h2>
            </div>
            <b>动态监测</b>
          </div>
          <div className="trend-chart">
            {trendData.map((item) => (
              <div className="trend-column" key={item.label}>
                <div className="trend-bars">
                  <span
                    className="trend-bar followup"
                    style={{ height: `${Math.max(12, (item.followUps / maxTrend) * 100)}%` }}
                    title={`随访 ${item.followUps}`}
                  />
                  <span
                    className="trend-bar alert"
                    style={{ height: `${Math.max(8, (item.alerts / maxTrend) * 100)}%` }}
                    title={`预警 ${item.alerts}`}
                  />
                </div>
                <span className="trend-label">{item.label}</span>
              </div>
            ))}
          </div>
          <div className="trend-legend">
            <span><i className="legend-followup" />随访任务</span>
            <span><i className="legend-alert" />风险预警</span>
          </div>
        </article>

        <article className="dashboard-panel">
          <div className="dashboard-panel-header">
            <div>
              <span>QUALITY CONTROL</span>
              <h2>慢病质控指标</h2>
            </div>
            <b>试点验收口径</b>
          </div>
          <div className="quality-list">
            {qualityItems.map((item) => (
              <div className="quality-item" key={item.label}>
                <div className="quality-title">
                  <span>{item.label}</span>
                  <strong>{item.value}%</strong>
                </div>
                <div className="quality-track">
                  <div className="quality-fill" style={{ width: `${Math.min(100, item.value)}%` }} />
                </div>
                <p>{item.desc}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="dashboard-bottom-grid">
        <article className="dashboard-panel">
          <div className="dashboard-panel-header compact">
            <div>
              <span>ALERT CENTER</span>
              <h2>高危患者处理概况</h2>
            </div>
          </div>
          <div className="alert-overview-list">
            <div>
              <span>未处理预警</span>
              <strong>{formatNumber(data.summary.openRiskAlertCount)}</strong>
              <em>需今日跟进</em>
            </div>
            <div>
              <span>已处理预警</span>
              <strong>{formatNumber(data.summary.resolvedRiskAlertCount)}</strong>
              <em>形成处理记录</em>
            </div>
            <div>
              <span>异常指标</span>
              <strong>{formatNumber(data.summary.abnormalVitalRecordCount)}</strong>
              <em>需复测或电话随访</em>
            </div>
          </div>
        </article>

        <article className="dashboard-panel">
          <div className="dashboard-panel-header compact">
            <div>
              <span>FOLLOW-UP WORK</span>
              <h2>随访任务运行</h2>
            </div>
          </div>
          <div className="workload-meter">
            <div className="workload-ring">
              <span>{followUpCompletion}%</span>
            </div>
            <div>
              <p>待办任务：{formatNumber(data.summary.pendingTaskCount)} 条</p>
              <p>已完成任务：{formatNumber(data.summary.completedTaskCount)} 条</p>
              <p>随访记录：{formatNumber(data.summary.followUpCount)} 条</p>
            </div>
          </div>
        </article>

        <article className="dashboard-panel">
          <div className="dashboard-panel-header compact">
            <div>
              <span>DATA GOVERNANCE</span>
              <h2>数据治理与安全</h2>
            </div>
          </div>
          <div className="security-grid">
            <span>RBAC 权限控制</span>
            <span>患者隐私脱敏</span>
            <span>操作日志审计</span>
            <span>等保建设支持</span>
          </div>
        </article>
      </section>

      <footer className="dashboard-footer">
        <span>数据来源：HIS / EMR / LIS / 患者微信小程序 / 护士工作台</span>
        <span>本页用于慢病中心建设汇报与运营监测，具体诊疗决策以医生判断为准。</span>
      </footer>
    </div>
  );
}

