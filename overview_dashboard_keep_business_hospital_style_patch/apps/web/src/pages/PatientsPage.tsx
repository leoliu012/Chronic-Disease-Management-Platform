import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

type Patient = {
  id: string;
  hospitalPatientId?: string;
  name: string;
  gender: string;
  birthDate?: string;
  phone?: string;
  responsibleDoctorId?: string;
  responsibleNurseId?: string;
  diseaseProfiles?: Array<{
    diseaseType: string;
    riskLevel: string;
  }>;
};

const genderLabelMap: Record<string, string> = {
  MALE: '男',
  FEMALE: '女',
  UNKNOWN: '未知',
};

const diseaseLabelMap: Record<string, string> = {
  HYPERTENSION: '高血压',
  TYPE_2_DIABETES: '2 型糖尿病',
  COPD: '慢阻肺',
  CORONARY_HEART_DISEASE: '冠心病',
  HYPERLIPIDEMIA: '高脂血症',
  OBESITY: '肥胖',
  OTHER: '其他',
};

const riskLabelMap: Record<string, string> = {
  LOW: '低危',
  MEDIUM: '中危',
  HIGH: '高危',
  VERY_HIGH: '极高危',
};

function getRiskClass(riskLevel: string) {
  return `risk-badge risk-${riskLevel.toLowerCase().replace('_', '-')}`;
}

function getHighestRisk(patient: Patient) {
  const order = ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];
  return patient.diseaseProfiles?.reduce((highest, item) => {
    return order.indexOf(item.riskLevel) > order.indexOf(highest) ? item.riskLevel : highest;
  }, 'LOW') ?? 'LOW';
}

export function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [riskFilter, setRiskFilter] = useState('ALL');

  useEffect(() => {
    api
      .get('/patients')
      .then((res) => setPatients(res.data))
      .finally(() => setLoading(false));
  }, []);

  const filteredPatients = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return patients.filter((patient) => {
      const risk = getHighestRisk(patient);
      const matchesRisk = riskFilter === 'ALL' || risk === riskFilter;
      const matchesKeyword =
        !normalized ||
        patient.name.toLowerCase().includes(normalized) ||
        (patient.hospitalPatientId ?? '').toLowerCase().includes(normalized) ||
        (patient.phone ?? '').toLowerCase().includes(normalized);

      return matchesRisk && matchesKeyword;
    });
  }, [patients, keyword, riskFilter]);

  if (loading) {
    return <div className="loading-state">正在加载患者主索引...</div>;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="kicker">PATIENT MASTER INDEX</div>
          <h1>慢病患者档案</h1>
          <div className="page-description">
            面向院内慢病中心使用，支持按姓名、院内 ID、手机号和风险等级快速检索患者。
          </div>
        </div>
        <div className="header-meta">
          <span className="meta-pill">患者数 {patients.length}</span>
          <span className="meta-pill">当前显示 {filteredPatients.length}</span>
        </div>
      </div>

      <section className="panel">
        <div className="toolbar">
          <input
            className="search-input"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索姓名 / 院内 ID / 手机号"
          />
          <select
            className="select-input"
            value={riskFilter}
            onChange={(event) => setRiskFilter(event.target.value)}
          >
            <option value="ALL">全部风险等级</option>
            <option value="VERY_HIGH">极高危</option>
            <option value="HIGH">高危</option>
            <option value="MEDIUM">中危</option>
            <option value="LOW">低危</option>
          </select>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>患者姓名</th>
                <th>院内 ID</th>
                <th>性别</th>
                <th>联系电话</th>
                <th>慢病标签</th>
                <th>综合风险</th>
                <th>责任护士</th>
                <th>操作</th>
              </tr>
            </thead>

            <tbody>
              {filteredPatients.map((patient) => {
                const highestRisk = getHighestRisk(patient);
                return (
                  <tr key={patient.id}>
                    <td><strong>{patient.name}</strong></td>
                    <td>{patient.hospitalPatientId ?? '-'}</td>
                    <td>{genderLabelMap[patient.gender] ?? patient.gender}</td>
                    <td>{patient.phone ?? '-'}</td>
                    <td>
                      {patient.diseaseProfiles?.length
                        ? patient.diseaseProfiles.map((item) => (
                            <span className="type-badge" key={`${item.diseaseType}-${item.riskLevel}`}>
                              {diseaseLabelMap[item.diseaseType] ?? item.diseaseType}
                            </span>
                          ))
                        : <span className="muted">未建慢病档案</span>}
                    </td>
                    <td>
                      <span className={getRiskClass(highestRisk)}>
                        {riskLabelMap[highestRisk] ?? highestRisk}
                      </span>
                    </td>
                    <td>{patient.responsibleNurseId ?? '-'}</td>
                    <td><Link to={`/patients/${patient.id}`}>进入档案</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredPatients.length === 0 && (
          <div className="empty-state" style={{ marginTop: 14 }}>
            没有符合条件的患者，请调整搜索条件或先导入测试患者数据。
          </div>
        )}
      </section>
    </div>
  );
}
