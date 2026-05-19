import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

type Patient = {
  id: string;
  name: string;
  hospitalPatientId?: string;
  phone?: string;
  responsibleDoctorId?: string;
  responsibleNurseId?: string;
};

type Task = {
  id: string;
  title: string;
  type: string;
  status: string;
  dueAt?: string;
  patient?: Patient;
};

type VitalRecord = {
  id: string;
  type: string;
  value: number;
  unit: string;
  measuredAt: string;
  note?: string;
  patient: Patient;
};

type RiskAlert = {
  id: string;
  title: string;
  riskType: string;
  riskLevel: string;
  status: string;
  description?: string;
  patient: Patient;
};

type NurseDashboard = {
  nurseId: string;
  summary: {
    patientCount: number;
    pendingTaskCount: number;
    todayTaskCount: number;
    overdueTaskCount: number;
    openRiskAlertCount: number;
    recentAbnormalVitalCount: number;
    completedTaskCount: number;
  };
  myPatients: Patient[];
  pendingTasks: Task[];
  todayTasks: Task[];
  overdueTasks: Task[];
  openRiskAlerts: RiskAlert[];
  recentAbnormalVitals: VitalRecord[];
};

const taskTypeLabelMap: Record<string, string> = {
  FOLLOW_UP: '随访任务',
  REVIEW_ALERT: '预警复核',
  RECHECK: '异常复测',
  RETURN_VISIT: '复诊提醒',
  QUESTIONNAIRE: '问卷提醒',
  MEDICATION: '用药随访',
};

const riskLabelMap: Record<string, string> = {
  LOW: '低危',
  MEDIUM: '中危',
  HIGH: '高危',
  VERY_HIGH: '极高危',
};

const vitalTypeLabelMap: Record<string, string> = {
  blood_pressure_systolic: '收缩压',
  blood_pressure_diastolic: '舒张压',
  fasting_glucose: '空腹血糖',
  postprandial_glucose: '餐后血糖',
  heart_rate: '心率',
  spo2: '血氧',
  weight: '体重',
};

function formatTime(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function getStatusClass(status: string) {
  return `status-badge status-${status.toLowerCase().replace(/_/g, '-')}`;
}

function getRiskClass(riskLevel: string) {
  return `risk-badge risk-${riskLevel.toLowerCase().replace('_', '-')}`;
}

export function NurseDashboardPage() {
  const [data, setData] = useState<NurseDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const nurseId = 'nurse-001';

  useEffect(() => {
    api
      .get(`/nurse-dashboard?nurseId=${nurseId}`)
      .then((res) => setData(res.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="loading-state">正在加载护士工作台...</div>;
  }

  if (!data) {
    return <div className="empty-state">护士工作台加载失败，请确认后端服务是否运行。</div>;
  }

  const summaryItems = [
    { label: '我的患者', value: data.summary.patientCount, note: '当前责任护士管理对象', className: '' },
    { label: '今日任务', value: data.summary.todayTaskCount, note: '今天应完成', className: 'card-warning' },
    { label: '逾期任务', value: data.summary.overdueTaskCount, note: '需优先追踪闭环', className: 'card-danger' },
    { label: '未处理预警', value: data.summary.openRiskAlertCount, note: '异常指标 / 高危风险', className: 'card-danger' },
    { label: '全部待办', value: data.summary.pendingTaskCount, note: '随访、复诊、问卷等', className: 'card-warning' },
    { label: '异常指标', value: data.summary.recentAbnormalVitalCount, note: '患者院外监测异常', className: 'card-danger' },
    { label: '已完成任务', value: data.summary.completedTaskCount, note: '工作量统计参考', className: 'card-success' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="kicker">NURSE WORKBENCH</div>
          <h1>护士慢病管理工作台</h1>
          <div className="page-description">
            当前责任护士：{data.nurseId}。本页用于处理今日随访、逾期任务、异常指标和高危患者预警。
          </div>
        </div>
        <div className="header-meta">
          <span className="meta-pill">岗位：慢病管理师</span>
          <span className="meta-pill">建议处理顺序：逾期 → 高危 → 今日任务</span>
        </div>
      </div>

      <div className="kpi-grid">
        {summaryItems.map((item) => (
          <div className={`card ${item.className}`} key={item.label}>
            <div className="label">{item.label}</div>
            <div className="value">{item.value}</div>
            <div className="card-note">{item.note}</div>
          </div>
        ))}
      </div>

      <div className="priority-strip">
        <div className="priority-card priority-danger">
          <div className="priority-title">第一优先级：逾期与高危</div>
          <div className="muted">逾期任务 {data.summary.overdueTaskCount} 个，未处理预警 {data.summary.openRiskAlertCount} 个。</div>
        </div>
        <div className="priority-card priority-warning">
          <div className="priority-title">第二优先级：今日随访</div>
          <div className="muted">今日任务 {data.summary.todayTaskCount} 个，建议完成后记录随访结果。</div>
        </div>
        <div className="priority-card priority-info">
          <div className="priority-title">工作提醒</div>
          <div className="muted">系统预警仅用于辅助筛查，异常情况需按医院流程由医护复核。</div>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">待办任务队列</h2>
            <div className="panel-subtitle">覆盖随访、复诊、异常复测、问卷提醒和患者沟通。</div>
          </div>
          <span className="meta-pill">待办 {data.pendingTasks.length}</span>
        </div>

        {data.pendingTasks.length === 0 ? (
          <div className="empty-state">暂无待办任务。</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>任务内容</th>
                  <th>类型</th>
                  <th>患者</th>
                  <th>截止时间</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {data.pendingTasks.map((task) => (
                  <tr key={task.id}>
                    <td><strong>{task.title}</strong></td>
                    <td><span className="type-badge">{taskTypeLabelMap[task.type] ?? task.type}</span></td>
                    <td>
                      {task.patient ? (
                        <Link to={`/patients/${task.patient.id}`}>{task.patient.name}</Link>
                      ) : '-'}
                    </td>
                    <td>{formatTime(task.dueAt)}</td>
                    <td><span className={getStatusClass(task.status)}>{task.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">未处理风险预警</h2>
              <div className="panel-subtitle">建议按极高危、高危、中危顺序进行复核。</div>
            </div>
            <span className="meta-pill">预警 {data.openRiskAlerts.length}</span>
          </div>

          {data.openRiskAlerts.length === 0 ? (
            <div className="empty-state">暂无未处理风险预警。</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>患者</th>
                    <th>风险等级</th>
                    <th>预警内容</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {data.openRiskAlerts.map((alert) => (
                    <tr key={alert.id}>
                      <td><Link to={`/patients/${alert.patient.id}`}>{alert.patient.name}</Link></td>
                      <td><span className={getRiskClass(alert.riskLevel)}>{riskLabelMap[alert.riskLevel] ?? alert.riskLevel}</span></td>
                      <td><strong>{alert.title}</strong></td>
                      <td>{alert.description ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">最近异常指标</h2>
              <div className="panel-subtitle">来自患者端或护士录入，需复测或随访确认。</div>
            </div>
            <span className="meta-pill">异常 {data.recentAbnormalVitals.length}</span>
          </div>

          {data.recentAbnormalVitals.length === 0 ? (
            <div className="empty-state">暂无异常指标。</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>患者</th>
                    <th>指标</th>
                    <th>数值</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentAbnormalVitals.map((record) => (
                    <tr key={record.id}>
                      <td><Link to={`/patients/${record.patient.id}`}>{record.patient.name}</Link></td>
                      <td>{vitalTypeLabelMap[record.type] ?? record.type}</td>
                      <td><strong>{record.value} {record.unit}</strong></td>
                      <td>{formatTime(record.measuredAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">我的患者</h2>
            <div className="panel-subtitle">责任护士名下患者，后续可扩展社区、病种、风险等级筛选。</div>
          </div>
          <span className="meta-pill">患者 {data.myPatients.length}</span>
        </div>

        {data.myPatients.length === 0 ? (
          <div className="empty-state">暂无负责患者。</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>院内 ID</th>
                  <th>电话</th>
                  <th>责任医生</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.myPatients.map((patient) => (
                  <tr key={patient.id}>
                    <td><strong>{patient.name}</strong></td>
                    <td>{patient.hospitalPatientId ?? '-'}</td>
                    <td>{patient.phone ?? '-'}</td>
                    <td>{patient.responsibleDoctorId ?? '-'}</td>
                    <td><Link to={`/patients/${patient.id}`}>进入档案</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
