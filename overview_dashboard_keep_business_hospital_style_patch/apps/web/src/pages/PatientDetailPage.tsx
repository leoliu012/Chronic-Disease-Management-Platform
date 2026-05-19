import { useEffect, useState } from 'react';
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

const genderLabelMap: Record<string, string> = {
  MALE: '男',
  FEMALE: '女',
  UNKNOWN: '未知',
};

const timelineTypeLabelMap: Record<string, string> = {
  DISEASE_PROFILE: '慢病档案',
  VITAL_RECORD: '健康指标',
  RISK_ALERT: '风险预警',
  FOLLOW_UP: '随访记录',
  TASK: '待办任务',
};

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
  return 'timeline-card';
}

export function PatientDetailPage() {
  const { patientId } = useParams();
  const [data, setData] = useState<PatientTimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!patientId) return;

    api
      .get(`/patients/${patientId}/timeline`)
      .then((res) => setData(res.data))
      .finally(() => setLoading(false));
  }, [patientId]);

  if (loading) {
    return <div className="loading-state">正在加载患者长期健康档案...</div>;
  }

  if (!data) {
    return <div className="empty-state">未找到患者档案。</div>;
  }

  const { patient, timeline } = data;

  return (
    <div>
      <div className="page-header">
        <div>
          <Link className="link" to="/patients">← 返回患者档案</Link>
          <div className="kicker" style={{ marginTop: 12 }}>PATIENT LONGITUDINAL RECORD</div>
          <h1>{patient.name} · 慢病长期档案</h1>
          <div className="page-description">
            汇总院内诊疗数据、患者院外监测、随访记录、风险预警和任务处理记录。
          </div>
        </div>
        <div className="header-meta">
          <span className="meta-pill">院内 ID：{patient.hospitalPatientId ?? '-'}</span>
          <span className="meta-pill">时间轴事件：{timeline.length}</span>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">患者基本信息</h2>
            <div className="panel-subtitle">当前为演示环境，后续应加入身份证号、手机号等敏感信息脱敏规则。</div>
          </div>
          <span className="meta-pill">责任护士：{patient.responsibleNurseId ?? '-'}</span>
        </div>

        <div className="detail-grid">
          <div className="info-cell">
            <span className="label">院内 ID</span>
            <div className="info-value">{patient.hospitalPatientId ?? '-'}</div>
          </div>
          <div className="info-cell">
            <span className="label">性别</span>
            <div className="info-value">{genderLabelMap[patient.gender] ?? patient.gender}</div>
          </div>
          <div className="info-cell">
            <span className="label">出生日期</span>
            <div className="info-value">{formatDate(patient.birthDate)}</div>
          </div>
          <div className="info-cell">
            <span className="label">联系电话</span>
            <div className="info-value">{patient.phone ?? '-'}</div>
          </div>
          <div className="info-cell">
            <span className="label">责任医生</span>
            <div className="info-value">{patient.responsibleDoctorId ?? '-'}</div>
          </div>
          <div className="info-cell">
            <span className="label">责任护士</span>
            <div className="info-value">{patient.responsibleNurseId ?? '-'}</div>
          </div>
          <div className="info-cell" style={{ gridColumn: '1 / -1' }}>
            <span className="label">住址 / 社区</span>
            <div className="info-value">{patient.address ?? '-'}</div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">疾病进程时间轴</h2>
            <div className="panel-subtitle">按时间倒序展示确诊、指标、用药调整、随访、预警和任务变化。</div>
          </div>
          <span className="meta-pill">长期追踪</span>
        </div>

        <div className="warning-note" style={{ marginBottom: 16 }}>
          医疗安全提示：系统预警和时间轴用于辅助慢病管理，不替代医生诊断。高危或极高危情况应按医院流程进行人工复核和转诊处理。
        </div>

        {timeline.length === 0 ? (
          <div className="empty-state">暂无时间轴记录。请先录入慢病档案、健康指标或随访记录。</div>
        ) : (
          <div className="timeline">
            {timeline.map((item, index) => (
              <div className="timeline-item" key={`${item.type}-${item.time}-${index}`}>
                <div className="timeline-time">{formatTime(item.time)}</div>
                <div className={getTimelineCardClass(item.type)}>
                  <div className="badge">{timelineTypeLabelMap[item.type] ?? item.type}</div>
                  <h3>{item.title}</h3>
                  <p>{item.description || '暂无补充说明'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
