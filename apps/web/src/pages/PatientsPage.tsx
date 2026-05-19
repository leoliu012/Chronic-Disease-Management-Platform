import type { FormEvent, KeyboardEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

type DiseaseProfile = {
  diseaseType: string;
  riskLevel: string;
};

type Patient = {
  id: string;
  hospitalPatientId?: string;
  name: string;
  gender: string;
  birthDate?: string | null;
  phone?: string | null;
  idCardNo?: string | null;
  address?: string | null;
  responsibleDoctorId?: string | null;
  responsibleNurseId?: string | null;
  diseaseProfiles?: DiseaseProfile[];
};

type PatientForm = {
  hospitalPatientId: string;
  name: string;
  gender: 'MALE' | 'FEMALE' | 'UNKNOWN';
  birthDate: string;
  phone: string;
  idCardNo: string;
  address: string;
  responsibleDoctorId: string;
  responsibleNurseId: string;
};

type HisLookupResponse = {
  sourceSystem: string;
  interfaceStatus: string;
  message: string;
  patient: Partial<PatientForm> & {
    id?: string;
    hospitalPatientId?: string;
    name?: string;
    gender?: 'MALE' | 'FEMALE' | 'UNKNOWN';
    birthDate?: string | null;
  };
};

const emptyForm: PatientForm = {
  hospitalPatientId: '',
  name: '',
  gender: 'UNKNOWN',
  birthDate: '',
  phone: '',
  idCardNo: '',
  address: '',
  responsibleDoctorId: 'doctor-001',
  responsibleNurseId: 'nurse-001',
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
  return (
    patient.diseaseProfiles?.reduce((highest, item) => {
      return order.indexOf(item.riskLevel) > order.indexOf(highest)
        ? item.riskLevel
        : highest;
    }, 'LOW') ?? 'LOW'
  );
}

function normalizeDateForInput(value?: string | null) {
  if (!value) return '';
  return value.slice(0, 10);
}

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(',')),
  ].join('\n');

  const blob = new Blob([`\ufeff${csv}`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('ALL');

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [hisLoading, setHisLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [form, setForm] = useState<PatientForm>(emptyForm);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function loadPatients() {
    setLoading(true);
    try {
      const res = await api.get('/patients');
      setPatients(res.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPatients();
  }, []);

  const filteredPatients = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return patients.filter((patient) => {
      const highestRisk = getHighestRisk(patient);
      const keywordMatched =
        !keyword ||
        patient.name.toLowerCase().includes(keyword) ||
        patient.hospitalPatientId?.toLowerCase().includes(keyword) ||
        patient.phone?.toLowerCase().includes(keyword) ||
        patient.idCardNo?.toLowerCase().includes(keyword);

      const riskMatched = riskFilter === 'ALL' || highestRisk === riskFilter;

      return keywordMatched && riskMatched;
    });
  }, [patients, riskFilter, search]);

  function updateForm<K extends keyof PatientForm>(key: K, value: PatientForm[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function fillFormFromHisPatient(patient: HisLookupResponse['patient']) {
    setForm({
      hospitalPatientId: patient.hospitalPatientId ?? barcode.trim(),
      name: patient.name ?? '',
      gender: patient.gender ?? 'UNKNOWN',
      birthDate: normalizeDateForInput(patient.birthDate),
      phone: patient.phone ?? '',
      idCardNo: patient.idCardNo ?? '',
      address: patient.address ?? '',
      responsibleDoctorId: patient.responsibleDoctorId ?? 'doctor-001',
      responsibleNurseId: patient.responsibleNurseId ?? 'nurse-001',
    });
  }

  async function lookupBarcode() {
    const trimmedBarcode = barcode.trim();
    if (!trimmedBarcode) {
      setError('请先扫描或输入就诊卡号、腕带条形码、院内 ID。');
      return;
    }

    setHisLoading(true);
    setError('');
    setMessage('');

    try {
      const res = await api.get<HisLookupResponse>(
        `/his/patients/barcode/${encodeURIComponent(trimmedBarcode)}`,
      );

      if (res.data.interfaceStatus === 'MATCHED_LOCAL_PATIENT' && res.data.patient.id) {
        setMessage('已匹配本平台患者，可直接在列表中进入档案。');
      } else {
        fillFormFromHisPatient(res.data.patient);
        setShowCreateForm(true);
        setMessage(res.data.message);
      }
    } catch {
      setError('HIS 条码查询失败。请确认后端已更新并重启，或先手工录入患者。');
    } finally {
      setHisLoading(false);
    }
  }

  async function importHisDraft() {
    const trimmedBarcode = barcode.trim();
    if (!trimmedBarcode) {
      setError('请先扫描或输入条形码/院内 ID，再从 HIS 拉取患者草稿。');
      return;
    }

    setHisLoading(true);
    setError('');
    setMessage('');

    try {
      const res = await api.post<HisLookupResponse>('/his/patients/import', {
        barcode: trimmedBarcode,
      });

      fillFormFromHisPatient(res.data.patient);
      setShowCreateForm(true);
      setMessage(res.data.message);
    } catch {
      setError('HIS 患者草稿拉取失败。当前接口为预留模式，请检查后端是否已应用补丁。');
    } finally {
      setHisLoading(false);
    }
  }

  function handleBarcodeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      lookupBarcode();
    }
  }

  async function createPatient(event: FormEvent) {
    event.preventDefault();

    if (!form.name.trim()) {
      setError('患者姓名为必填项。HIS 未返回姓名时，请手工补充。');
      return;
    }

    setCreating(true);
    setError('');
    setMessage('');

    try {
      await api.post('/patients', {
        hospitalPatientId: form.hospitalPatientId || undefined,
        name: form.name,
        gender: form.gender,
        birthDate: form.birthDate || undefined,
        phone: form.phone || undefined,
        idCardNo: form.idCardNo || undefined,
        address: form.address || undefined,
        responsibleDoctorId: form.responsibleDoctorId || undefined,
        responsibleNurseId: form.responsibleNurseId || undefined,
      });

      setForm(emptyForm);
      setBarcode('');
      setShowCreateForm(false);
      setMessage('患者已建档。后续可进入档案补充慢病、指标、随访和任务。');
      await loadPatients();
    } catch {
      setError('患者建档失败。请检查院内 ID 是否重复，或确认后端服务是否正常。');
    } finally {
      setCreating(false);
    }
  }

  async function exportPatientsForHis() {
    setExporting(true);
    setError('');
    setMessage('');

    try {
      const res = await api.get('/his/patients/export');
      const rows = res.data.patients.map((patient: Patient) => ({
        hospitalPatientId: patient.hospitalPatientId ?? '',
        name: patient.name,
        gender: patient.gender,
        birthDate: patient.birthDate ? patient.birthDate.slice(0, 10) : '',
        phone: patient.phone ?? '',
        idCardNo: patient.idCardNo ?? '',
        responsibleDoctorId: patient.responsibleDoctorId ?? '',
        responsibleNurseId: patient.responsibleNurseId ?? '',
        diseaseTypes:
          patient.diseaseProfiles?.map((item) => item.diseaseType).join('|') ?? '',
        highestRisk: getHighestRisk(patient),
        sourceSystem: 'CHRONIC_CARE_PLATFORM',
        targetSystem: 'HIS_RESERVED_INTERFACE',
        exportedAt: res.data.exportedAt,
      }));

      if (rows.length === 0) {
        setMessage('当前没有可导出的患者。');
        return;
      }

      downloadCsv(`his_patient_export_${new Date().toISOString().slice(0, 10)}.csv`, rows);
      setMessage('已生成 HIS 预留格式患者导出文件。真实上线时可替换为 HL7/FHIR/WebService/中间库推送。');
    } catch {
      setError('导出失败。请确认后端 HIS 预留接口已启动。');
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return <div className="loading-state">正在加载患者主索引...</div>;
  }

  return (
    <div>
      <div className="page-heading">
        <div>
          <span>Patient Master Index</span>
          <h1>患者档案</h1>
          <p>支持手工建档、扫码录入，并预留 HIS 患者主索引同步与导出接口。</p>
        </div>
      </div>

      <section className="panel patient-his-panel">
        <div className="section-title-row">
          <div>
            <h2>建档入口 / HIS 接口预留</h2>
            <p className="muted">
              扫描枪通常会把条形码当作键盘输入并自动回车；此处按 Enter 会自动查询 HIS 预留接口。
            </p>
          </div>
          <span className="type-badge">HIS RESERVED</span>
        </div>

        <div className="his-action-row">
          <input
            className="his-barcode-input"
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            onKeyDown={handleBarcodeKeyDown}
            placeholder="扫描就诊卡 / 腕带条形码 / 输入院内 ID 后回车"
          />
          <button className="secondary-btn" onClick={lookupBarcode} disabled={hisLoading}>
            {hisLoading ? '查询中...' : '扫码查询'}
          </button>
          <button className="secondary-btn" onClick={importHisDraft} disabled={hisLoading}>
            从 HIS 拉取草稿
          </button>
          <button
            className="primary-btn"
            onClick={() => {
              setForm(emptyForm);
              setShowCreateForm((current) => !current);
            }}
          >
            新增患者
          </button>
          <button className="ghost-btn" onClick={exportPatientsForHis} disabled={exporting}>
            {exporting ? '导出中...' : '导出给 HIS'}
          </button>
        </div>

        <div className="interface-note">
          <strong>接口预留：</strong>
          <code>GET /his/patients/barcode/:barcode</code>
          <code>POST /his/patients/import</code>
          <code>GET /his/patients/export</code>
        </div>

        {message && <div className="status-message">{message}</div>}
        {error && <div className="status-error">{error}</div>}

        {showCreateForm && (
          <form className="form form-card" onSubmit={createPatient}>
            <div className="section-title-row compact">
              <div>
                <h3>新增患者建档</h3>
                <p className="muted">HIS 未返回的字段可先手工补充，后续可用真实接口自动填充。</p>
              </div>
              <button
                className="ghost-btn"
                type="button"
                onClick={() => setShowCreateForm(false)}
              >
                收起
              </button>
            </div>

            <div className="form-grid three-columns">
              <label>
                院内 ID / HIS 主索引号
                <input
                  value={form.hospitalPatientId}
                  onChange={(event) => updateForm('hospitalPatientId', event.target.value)}
                  placeholder="例如 HIS-000001"
                />
              </label>

              <label>
                患者姓名
                <input
                  value={form.name}
                  onChange={(event) => updateForm('name', event.target.value)}
                  placeholder="请输入患者姓名"
                  required
                />
              </label>

              <label>
                性别
                <select
                  value={form.gender}
                  onChange={(event) => updateForm('gender', event.target.value as PatientForm['gender'])}
                >
                  <option value="UNKNOWN">未知</option>
                  <option value="MALE">男</option>
                  <option value="FEMALE">女</option>
                </select>
              </label>

              <label>
                出生日期
                <input
                  type="date"
                  value={form.birthDate}
                  onChange={(event) => updateForm('birthDate', event.target.value)}
                />
              </label>

              <label>
                联系电话
                <input
                  value={form.phone}
                  onChange={(event) => updateForm('phone', event.target.value)}
                  placeholder="手机号"
                />
              </label>

              <label>
                身份证号
                <input
                  value={form.idCardNo}
                  onChange={(event) => updateForm('idCardNo', event.target.value)}
                  placeholder="可选"
                />
              </label>

              <label className="wide-field">
                地址
                <input
                  value={form.address}
                  onChange={(event) => updateForm('address', event.target.value)}
                  placeholder="患者常住地址"
                />
              </label>

              <label>
                责任医生
                <input
                  value={form.responsibleDoctorId}
                  onChange={(event) => updateForm('responsibleDoctorId', event.target.value)}
                />
              </label>

              <label>
                责任护士
                <input
                  value={form.responsibleNurseId}
                  onChange={(event) => updateForm('responsibleNurseId', event.target.value)}
                />
              </label>
            </div>

            <div className="form-actions">
              <button className="primary-btn" type="submit" disabled={creating}>
                {creating ? '保存中...' : '保存患者档案'}
              </button>
              <button className="ghost-btn" type="button" onClick={() => setForm(emptyForm)}>
                清空表单
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="panel">
        <div className="section-title-row">
          <div>
            <h2>患者主索引</h2>
            <p className="muted">共 {patients.length} 名患者，当前显示 {filteredPatients.length} 名。</p>
          </div>
        </div>

        <div className="filter-bar">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="按姓名、院内 ID、电话、身份证搜索"
          />
          <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}>
            <option value="ALL">全部风险等级</option>
            <option value="LOW">低危</option>
            <option value="MEDIUM">中危</option>
            <option value="HIGH">高危</option>
            <option value="VERY_HIGH">极高危</option>
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
                      {patient.diseaseProfiles?.length ? (
                        patient.diseaseProfiles.map((item) => (
                          <span className="type-badge" key={`${item.diseaseType}-${item.riskLevel}`}>
                            {diseaseLabelMap[item.diseaseType] ?? item.diseaseType}
                          </span>
                        ))
                      ) : (
                        <span className="muted">未建慢病档案</span>
                      )}
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
            没有符合条件的患者。可扫描条形码从 HIS 预留接口拉取草稿，或手工新增患者。
          </div>
        )}
      </section>
    </div>
  );
}

