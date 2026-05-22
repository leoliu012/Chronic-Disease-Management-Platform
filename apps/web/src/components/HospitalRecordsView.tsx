import { useEffect, useState } from 'react';
import { api } from '../api/client';

type EncounterRecord = {
  id: string;
  visitType: string;
  visitTime: string;
  departmentName?: string;
  doctorName?: string;
  chiefComplaint?: string;
  diagnosisSummary?: string;
  treatmentSummary?: string;
};

type MedicalRecordSummary = {
  id: string;
  recordType: string;
  recordTime: string;
  departmentName?: string;
  title: string;
  summary?: string;
  diagnosisText?: string;
  treatmentPlan?: string;
  doctorAdvice?: string;
};

type ExamReport = {
  id: string;
  examType: string;
  examName: string;
  examTime: string;
  departmentName?: string;
  finding?: string;
  conclusion?: string;
  reportUrl?: string;
};

type HospitalMedication = {
  id: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  route?: string;
  duration?: string;
  prescribedBy?: string;
  prescribedAt: string;
};

const encounterTypeLabelMap: Record<string, string> = {
  OUTPATIENT: '门诊',
  INPATIENT: '住院',
  EMERGENCY: '急诊',
  CHECKUP: '体检',
};

const medicalRecordTypeLabelMap: Record<string, string> = {
  OUTPATIENT_NOTE: '门诊病历',
  INPATIENT_RECORD: '住院病历',
  DISCHARGE_SUMMARY: '出院小结',
  PROGRESS_NOTE: '病程记录',
  CONSULTATION_NOTE: '会诊记录',
};

function formatDateTime(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

export function HospitalRecordsView({ patientId }: { patientId: string }) {
  const [activeTab, setActiveTab] = useState<'encounters' | 'summaries' | 'exams' | 'medications'>('encounters');
  const [encounters, setEncounters] = useState<EncounterRecord[]>([]);
  const [summaries, setSummaries] = useState<MedicalRecordSummary[]>([]);
  const [exams, setExams] = useState<ExamReport[]>([]);
  const [medications, setMedications] = useState<HospitalMedication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHospitalRecords();
  }, [patientId]);

  async function loadHospitalRecords() {
    setLoading(true);
    try {
      const [encountersRes, summariesRes, examsRes, medicationsRes] = await Promise.all([
        api.get(`/patients/${patientId}/encounter-records`),
        api.get(`/patients/${patientId}/medical-record-summaries`),
        api.get(`/patients/${patientId}/exam-reports`),
        api.get(`/patients/${patientId}/hospital-medications`),
      ]);
      setEncounters(encountersRes.data);
      setSummaries(summariesRes.data);
      setExams(examsRes.data);
      setMedications(medicationsRes.data);
    } catch (error) {
      console.error('Failed to load hospital records:', error);
    } finally {
      setLoading(false);
    }
  }

  const latestEncounter = encounters[0];
  const latestInpatient = encounters.find(e => e.visitType === 'INPATIENT');
  const recentExams = exams.slice(0, 3);
  const recentMedications = medications.slice(0, 5);

  if (loading) {
    return <div className="hospital-records-loading">加载中...</div>;
  }

  return (
    <div className="hospital-records-view">
      {/* Overview Cards */}
      <div className="hospital-records-overview">
        <div className="hospital-overview-card">
          <div className="overview-card-label">最近就诊</div>
          {latestEncounter ? (
            <>
              <div className="overview-card-value">
                {formatDate(latestEncounter.visitTime)} · {encounterTypeLabelMap[latestEncounter.visitType]}
              </div>
              <div className="overview-card-detail">
                {latestEncounter.departmentName} · {latestEncounter.diagnosisSummary || '无诊断记录'}
              </div>
            </>
          ) : (
            <div className="overview-card-empty">暂无就诊记录</div>
          )}
        </div>

        <div className="hospital-overview-card">
          <div className="overview-card-label">最近住院</div>
          {latestInpatient ? (
            <>
              <div className="overview-card-value">
                {formatDate(latestInpatient.visitTime)}
              </div>
              <div className="overview-card-detail">
                {latestInpatient.departmentName} · {latestInpatient.diagnosisSummary || '无诊断记录'}
              </div>
            </>
          ) : (
            <div className="overview-card-empty">暂无住院记录</div>
          )}
        </div>

        <div className="hospital-overview-card">
          <div className="overview-card-label">最近检查</div>
          {recentExams.length > 0 ? (
            <>
              <div className="overview-card-value">{recentExams[0].examName}</div>
              <div className="overview-card-detail">
                {formatDate(recentExams[0].examTime)} · {recentExams[0].conclusion || '查看详情'}
              </div>
            </>
          ) : (
            <div className="overview-card-empty">暂无检查记录</div>
          )}
        </div>

        <div className="hospital-overview-card">
          <div className="overview-card-label">院内用药</div>
          {recentMedications.length > 0 ? (
            <>
              <div className="overview-card-value">{recentMedications.length} 条处方记录</div>
              <div className="overview-card-detail">
                最近：{recentMedications[0].medicationName}
              </div>
            </>
          ) : (
            <div className="overview-card-empty">暂无处方记录</div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="hospital-records-tabs">
        <button
          className={activeTab === 'encounters' ? 'hospital-tab active' : 'hospital-tab'}
          onClick={() => setActiveTab('encounters')}
        >
          就诊记录 ({encounters.length})
        </button>
        <button
          className={activeTab === 'summaries' ? 'hospital-tab active' : 'hospital-tab'}
          onClick={() => setActiveTab('summaries')}
        >
          病历摘要 ({summaries.length})
        </button>
        <button
          className={activeTab === 'exams' ? 'hospital-tab active' : 'hospital-tab'}
          onClick={() => setActiveTab('exams')}
        >
          检查报告 ({exams.length})
        </button>
        <button
          className={activeTab === 'medications' ? 'hospital-tab active' : 'hospital-tab'}
          onClick={() => setActiveTab('medications')}
        >
          院内处方 ({medications.length})
        </button>
      </div>

      {/* Tab Content */}
      <div className="hospital-records-content">
        {activeTab === 'encounters' && (
          <div className="encounter-records-list">
            {encounters.length === 0 ? (
              <div className="empty-state">暂无就诊记录</div>
            ) : (
              encounters.map((encounter) => (
                <div key={encounter.id} className="encounter-record-card">
                  <div className="encounter-header">
                    <span className={`encounter-type-badge ${encounter.visitType.toLowerCase()}`}>
                      {encounterTypeLabelMap[encounter.visitType]}
                    </span>
                    <span className="encounter-time">{formatDateTime(encounter.visitTime)}</span>
                  </div>
                  <div className="encounter-body">
                    {encounter.departmentName && (
                      <div className="encounter-field">
                        <span className="field-label">科室：</span>
                        <span className="field-value">{encounter.departmentName}</span>
                      </div>
                    )}
                    {encounter.doctorName && (
                      <div className="encounter-field">
                        <span className="field-label">医生：</span>
                        <span className="field-value">{encounter.doctorName}</span>
                      </div>
                    )}
                    {encounter.chiefComplaint && (
                      <div className="encounter-field">
                        <span className="field-label">主诉：</span>
                        <span className="field-value">{encounter.chiefComplaint}</span>
                      </div>
                    )}
                    {encounter.diagnosisSummary && (
                      <div className="encounter-field">
                        <span className="field-label">诊断：</span>
                        <span className="field-value">{encounter.diagnosisSummary}</span>
                      </div>
                    )}
                    {encounter.treatmentSummary && (
                      <div className="encounter-field">
                        <span className="field-label">治疗：</span>
                        <span className="field-value">{encounter.treatmentSummary}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'summaries' && (
          <div className="medical-summaries-list">
            {summaries.length === 0 ? (
              <div className="empty-state">暂无病历摘要</div>
            ) : (
              summaries.map((summary) => (
                <div key={summary.id} className="medical-summary-card">
                  <div className="summary-header">
                    <span className="summary-type-badge">
                      {medicalRecordTypeLabelMap[summary.recordType]}
                    </span>
                    <span className="summary-time">{formatDateTime(summary.recordTime)}</span>
                  </div>
                  <div className="summary-title">{summary.title}</div>
                  <div className="summary-body">
                    {summary.departmentName && (
                      <div className="summary-field">
                        <span className="field-label">科室：</span>
                        <span className="field-value">{summary.departmentName}</span>
                      </div>
                    )}
                    {summary.diagnosisText && (
                      <div className="summary-field">
                        <span className="field-label">诊断：</span>
                        <span className="field-value">{summary.diagnosisText}</span>
                      </div>
                    )}
                    {summary.treatmentPlan && (
                      <div className="summary-field">
                        <span className="field-label">治疗方案：</span>
                        <span className="field-value">{summary.treatmentPlan}</span>
                      </div>
                    )}
                    {summary.doctorAdvice && (
                      <div className="summary-field">
                        <span className="field-label">医嘱：</span>
                        <span className="field-value">{summary.doctorAdvice}</span>
                      </div>
                    )}
                    {summary.summary && (
                      <div className="summary-field">
                        <span className="field-label">摘要：</span>
                        <span className="field-value">{summary.summary}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'exams' && (
          <div className="exam-reports-list">
            {exams.length === 0 ? (
              <div className="empty-state">暂无检查报告</div>
            ) : (
              exams.map((exam) => (
                <div key={exam.id} className="exam-report-card">
                  <div className="exam-header">
                    <span className="exam-type-badge">{exam.examType}</span>
                    <span className="exam-time">{formatDateTime(exam.examTime)}</span>
                  </div>
                  <div className="exam-name">{exam.examName}</div>
                  <div className="exam-body">
                    {exam.departmentName && (
                      <div className="exam-field">
                        <span className="field-label">科室：</span>
                        <span className="field-value">{exam.departmentName}</span>
                      </div>
                    )}
                    {exam.finding && (
                      <div className="exam-field">
                        <span className="field-label">检查所见：</span>
                        <span className="field-value">{exam.finding}</span>
                      </div>
                    )}
                    {exam.conclusion && (
                      <div className="exam-field">
                        <span className="field-label">检查结论：</span>
                        <span className="field-value">{exam.conclusion}</span>
                      </div>
                    )}
                    {exam.reportUrl && (
                      <div className="exam-field">
                        <a href={exam.reportUrl} target="_blank" rel="noopener noreferrer" className="exam-report-link">
                          查看完整报告 →
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'medications' && (
          <div className="hospital-medications-list">
            {medications.length === 0 ? (
              <div className="empty-state">暂无院内处方记录</div>
            ) : (
              medications.map((med) => (
                <div key={med.id} className="hospital-medication-card">
                  <div className="medication-header">
                    <span className="medication-name">{med.medicationName}</span>
                    <span className="medication-time">{formatDateTime(med.prescribedAt)}</span>
                  </div>
                  <div className="medication-body">
                    <div className="medication-field">
                      <span className="field-label">剂量：</span>
                      <span className="field-value">{med.dosage}</span>
                    </div>
                    <div className="medication-field">
                      <span className="field-label">频次：</span>
                      <span className="field-value">{med.frequency}</span>
                    </div>
                    {med.route && (
                      <div className="medication-field">
                        <span className="field-label">途径：</span>
                        <span className="field-value">{med.route}</span>
                      </div>
                    )}
                    {med.duration && (
                      <div className="medication-field">
                        <span className="field-label">疗程：</span>
                        <span className="field-value">{med.duration}</span>
                      </div>
                    )}
                    {med.prescribedBy && (
                      <div className="medication-field">
                        <span className="field-label">开方医生：</span>
                        <span className="field-value">{med.prescribedBy}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
