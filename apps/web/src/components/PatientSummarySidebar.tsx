import { useEffect, useState } from 'react';
import { api } from '../api/client';
import '../patient-summary-sidebar.css';

type PatientSummary = {
  diseases: string[];
  latestVisit?: {
    date: string;
    department: string;
    diagnosis: string;
  };
  latestAbnormal?: {
    type: string;
    value: string;
    date: string;
  };
  currentMedications: string[];
  recentAlerts: number;
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

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit'
  });
}

export function PatientSummarySidebar({ patientId }: { patientId: string }) {
  const [summary, setSummary] = useState<PatientSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPatientSummary();
  }, [patientId]);

  async function loadPatientSummary() {
    setLoading(true);
    try {
      const [patient, encounters, vitals, medications, alerts] = await Promise.all([
        api.get(`/patients/${patientId}`),
        api.get(`/patients/${patientId}/encounter-records`),
        api.get(`/patients/${patientId}/vital-records`),
        api.get(`/patients/${patientId}/medications`),
        api.get(`/patients/${patientId}/risk-alerts`),
      ]);

      const diseases = patient.data.diseaseProfiles?.map((d: any) =>
        diseaseLabelMap[d.diseaseType] || d.diseaseType
      ) || [];

      const latestEncounter = encounters.data[0];
      const latestVisit = latestEncounter ? {
        date: latestEncounter.visitTime,
        department: latestEncounter.departmentName || '未知科室',
        diagnosis: latestEncounter.diagnosisSummary || '无诊断记录',
      } : undefined;

      const abnormalVitals = vitals.data?.filter((v: any) => v.isAbnormal) || [];
      const latestAbnormalVital = abnormalVitals[0];
      const latestAbnormal = latestAbnormalVital ? {
        type: latestAbnormalVital.type,
        value: `${latestAbnormalVital.value} ${latestAbnormalVital.unit}`,
        date: latestAbnormalVital.measuredAt,
      } : undefined;

      const currentMeds = medications.data
        ?.filter((m: any) => m.isActive)
        .map((m: any) => `${m.medicationName} ${m.dosage}`)
        .slice(0, 3) || [];

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentHighRiskAlerts = alerts.data?.filter((a: any) =>
        a.riskLevel === 'HIGH' || a.riskLevel === 'VERY_HIGH'
      ).filter((a: any) =>
        new Date(a.createdAt) > thirtyDaysAgo
      ).length || 0;

      setSummary({
        diseases,
        latestVisit,
        latestAbnormal,
        currentMedications: currentMeds,
        recentAlerts: recentHighRiskAlerts,
      });
    } catch (error) {
      console.error('Failed to load patient summary:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="patient-summary-sidebar">
        <div className="summary-loading">加载中...</div>
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  return (
    <div className="patient-summary-sidebar">
      <div className="summary-header">患者过往摘要</div>

      <div className="summary-section">
        <div className="summary-label">主要慢病</div>
        <div className="summary-value">
          {summary.diseases.length > 0 ? summary.diseases.join('、') : '无'}
        </div>
      </div>

      {summary.latestVisit && (
        <div className="summary-section">
          <div className="summary-label">最近就诊</div>
          <div className="summary-value">
            {formatDate(summary.latestVisit.date)} {summary.latestVisit.department}
          </div>
          <div className="summary-detail">{summary.latestVisit.diagnosis}</div>
        </div>
      )}

      {summary.latestAbnormal && (
        <div className="summary-section">
          <div className="summary-label">最近异常</div>
          <div className="summary-value summary-alert">
            {summary.latestAbnormal.type} {summary.latestAbnormal.value}
          </div>
          <div className="summary-detail">{formatDate(summary.latestAbnormal.date)}</div>
        </div>
      )}

      {summary.currentMedications.length > 0 && (
        <div className="summary-section">
          <div className="summary-label">当前用药</div>
          {summary.currentMedications.map((med, index) => (
            <div key={index} className="summary-value">{med}</div>
          ))}
        </div>
      )}

      {summary.recentAlerts > 0 && (
        <div className="summary-section">
          <div className="summary-label">近30天风险</div>
          <div className="summary-value summary-alert">
            高危预警 {summary.recentAlerts} 次
          </div>
        </div>
      )}
    </div>
  );
}
