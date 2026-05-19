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
  RISK_ALERT_FOLLOW_UP: '风险预警处理',
  RECHECK_REMINDER: '复查提醒',
  MEDICATION_REMINDER: '用药提醒',
  LAB_TEST_REMINDER: '检查提醒',
};

const riskLabelMap: Record<string, string> = {
  LOW: '低危',
  MEDIUM: '中危',
  HIGH: '高危',
  VERY_HIGH: '极高危',
};

const vitalTypeLabelMap: Record<string, string> = {
  SYSTOLIC_BP: '收缩压',
  DIASTOLIC_BP: '舒张压',
  BLOOD_GLUCOSE: '血糖',
  WEIGHT: '体重',
  HEART_RATE: '心率',
  SPO2: '血氧',
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

function formatTime(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function getStatusClass(status: string) {
  return `status-badge status-${status.toLowerCase().replace(/_/g, '-')}`;
}

function getRiskClass(riskLevel: string) {
  return `risk-badge risk-${riskLevel.toLowerCase().replace(/_/g, '-')}`;
}

export function NurseDashboardPage() {
  const [data, setData] = useState<NurseDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [resolvingAlertId, setResolvingAlertId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const nurseId = 'nurse-001';

  async function loadDashboard() {
    setLoading(true);
    setError('');

    try {
      const res = await api.get(`/nurse-dashboard?nurseId=${nurseId}`);
      setData(res.data);
    } catch (err) {
      console.error(err);
      setError('护士工作台加载失败，请确认后端服务已启动。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  async function markTaskDone(taskId: string) {
    setUpdatingTaskId(taskId);
    setMessage('');
    setError('');

    try {
      await api.patch(`/tasks/${taskId}/status`, {
        status: 'DONE',
      });

      setMessage('任务已标记完成。');
      await loadDashboard();
    } catch (err) {
      console.error(err);
      setError('任务处理失败，请稍后重试。');
    } finally {
      setUpdatingTaskId(null);
    }
  }

  async function resolveRiskAlert(alertId: string) {
    setResolvingAlertId(alertId);
    setMessage('');
    setError('');

    try {
      await api.patch(`/risk-alerts/${alertId}/resolve`, {
        handledBy: nurseId,
        handlingNote: '护士已在工作台处理该风险预警',
      });

      setMessage('风险预警已标记为已处理。');
      await loadDashboard();
    } catch (err) {
      console.error(err);
      setError('风险预警处理失败，请稍后重试。');
    } finally {
      setResolvingAlertId(null);
    }
  }

  if (loading && !data) {
    return <div className="loading-state">正在加载护士工作台...</div>;
  }

  if (!data) {
    return <div className="empty-state">护士工作台加载失败</div>;
  }

  const summaryItems = [
    ['我的患者', data.summary.patientCount],
    ['待办任务', data.summary.pendingTaskCount],
    ['今日任务', data.summary.todayTaskCount],
    ['逾期任务', data.summary.overdueTaskCount],
    ['未处理预警', data.summary.openRiskAlertCount],
    ['异常指标', data.summary.recentAbnormalVitalCount],
    ['已完成任务', data.summary.completedTaskCount],
  ];

  return (
    <div className="business-page">
      <div className="page-header">
        <div>
          <div className="page-kicker">NURSE WORKBENCH</div>
          <h1>护士工作台</h1>
          <p className="page-subtitle">当前护士：{data.nurseId} · 聚合患者、任务、风险预警和异常指标</p>
        </div>
        <button className="secondary-btn" onClick={loadDashboard} disabled={loading}>
          {loading ? '刷新中...' : '刷新数据'}
        </button>
      </div>

      {message && <div className="notice-success">{message}</div>}
      {error && <div className="notice-error">{error}</div>}

      <div className="grid">
        {summaryItems.map(([label, value]) => (
          <div className="card" key={label}>
            <div className="label">{label}</div>
            <div className="value">{value}</div>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="section-title-row">
          <h2>未处理风险预警</h2>
          <span className="muted">OPEN 风险预警可在此直接处理</span>
        </div>

        {data.openRiskAlerts.length === 0 ? (
          <div className="empty-state">暂无未处理风险预警</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>预警</th>
                <th>等级</th>
                <th>患者</th>
                <th>说明</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.openRiskAlerts.map((alert) => (
                <tr key={alert.id}>
                  <td>{alert.title}</td>
                  <td>
                    <span className={getRiskClass(alert.riskLevel)}>
                      {riskLabelMap[alert.riskLevel] ?? alert.riskLevel}
                    </span>
                  </td>
                  <td>
                    <Link to={`/patients/${alert.patient.id}`}>{alert.patient.name}</Link>
                  </td>
                  <td>{alert.description ?? '-'}</td>
                  <td>
                    <span className={getStatusClass(alert.status)}>
                      {statusLabelMap[alert.status] ?? alert.status}
                    </span>
                  </td>
                  <td>
                    <button
                      className="primary-btn"
                      disabled={resolvingAlertId === alert.id}
                      onClick={() => resolveRiskAlert(alert.id)}
                    >
                      {resolvingAlertId === alert.id ? '处理中...' : '标记已处理'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <div className="section-title-row">
          <h2>待办任务</h2>
          <span className="muted">PENDING 任务可直接标记完成</span>
        </div>

        {data.pendingTasks.length === 0 ? (
          <div className="empty-state">暂无待办任务</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>任务</th>
                <th>类型</th>
                <th>患者</th>
                <th>截止时间</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.pendingTasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.title}</td>
                  <td>{taskTypeLabelMap[task.type] ?? task.type}</td>
                  <td>
                    {task.patient ? <Link to={`/patients/${task.patient.id}`}>{task.patient.name}</Link> : '-'}
                  </td>
                  <td>{formatTime(task.dueAt)}</td>
                  <td>
                    <span className={getStatusClass(task.status)}>
                      {statusLabelMap[task.status] ?? task.status}
                    </span>
                  </td>
                  <td>
                    <button
                      className="primary-btn"
                      disabled={updatingTaskId === task.id}
                      onClick={() => markTaskDone(task.id)}
                    >
                      {updatingTaskId === task.id ? '处理中...' : '标记完成'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>最近异常指标</h2>
        {data.recentAbnormalVitals.length === 0 ? (
          <div className="empty-state">暂无异常指标</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>患者</th>
                <th>指标</th>
                <th>数值</th>
                <th>时间</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {data.recentAbnormalVitals.map((record) => (
                <tr key={record.id}>
                  <td>
                    <Link to={`/patients/${record.patient.id}`}>{record.patient.name}</Link>
                  </td>
                  <td>{vitalTypeLabelMap[record.type] ?? record.type}</td>
                  <td>
                    {record.value} {record.unit}
                  </td>
                  <td>{formatTime(record.measuredAt)}</td>
                  <td>{record.note ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>我的患者</h2>
        {data.myPatients.length === 0 ? (
          <div className="empty-state">暂无负责患者</div>
        ) : (
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
                  <td>{patient.name}</td>
                  <td>{patient.hospitalPatientId ?? '-'}</td>
                  <td>{patient.phone ?? '-'}</td>
                  <td>{patient.responsibleDoctorId ?? '-'}</td>
                  <td>
                    <Link to={`/patients/${patient.id}`}>查看详情</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}


