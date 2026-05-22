import type { FormEvent, KeyboardEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, AUTH_USER_STORAGE_KEY, getApiErrorMessage } from '../api/client';
import type { CurrentUser } from './LoginPage';
import { useFeedbackMessageBridge } from '../utils/feedbackMessage';

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

type PatientWorkspace = 'index' | 'intake';

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

const diseaseOptions = Object.entries(diseaseLabelMap);
const riskOptions = Object.entries(riskLabelMap);

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

function normalizeText(value?: string | null) {
  return (value ?? '').trim().toLowerCase();
}

function patientHasDisease(patient: Patient, diseaseType: string) {
  if (diseaseType === 'ALL') return true;
  return patient.diseaseProfiles?.some((item) => item.diseaseType === diseaseType) ?? false;
}

function patientMatchesIdLast4(patient: Patient, idCardLast4: string) {
  const keyword = idCardLast4.trim();
  if (!keyword) return true;
  return (patient.idCardNo ?? '').endsWith(keyword) || (patient.idCardNo ?? '').includes(keyword);
}

export function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeWorkspace, setActiveWorkspace] = useState<PatientWorkspace>('index');

  const [nameFilter, setNameFilter] = useState('');
  const [hospitalIdFilter, setHospitalIdFilter] = useState('');
  const [phoneFilter, setPhoneFilter] = useState('');
  const [idCardLast4Filter, setIdCardLast4Filter] = useState('');
  const [genderFilter, setGenderFilter] = useState('ALL');
  const [diseaseFilter, setDiseaseFilter] = useState('ALL');
  const [riskFilter, setRiskFilter] = useState('ALL');

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [hisLoading, setHisLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [form, setForm] = useState<PatientForm>(emptyForm);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // prominent-feedback-bridge-v1
  useFeedbackMessageBridge(message, error);

  const currentUser = useMemo(() => {
    const raw = localStorage.getItem(AUTH_USER_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CurrentUser;
    } catch {
      return null;
    }
  }, []);

  const canEditPatients =
    currentUser?.role === 'ADMIN' ||
    currentUser?.role === 'DOCTOR' ||
    currentUser?.role === 'NURSE';

  const canExportPatients = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';

  async function loadPatients() {
    setLoading(true);
    try {
      const res = await api.get('/patients');
      setPatients(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err, '患者主索引加载失败，请确认后端服务是否正常。'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPatients();
  }, []);

  const filteredPatients = useMemo(() => {
    const nameKeyword = normalizeText(nameFilter);
    const hospitalIdKeyword = normalizeText(hospitalIdFilter);
    const phoneKeyword = normalizeText(phoneFilter);

    return patients.filter((patient) => {
      const highestRisk = getHighestRisk(patient);
      const nameMatched = !nameKeyword || normalizeText(patient.name).includes(nameKeyword);
      const hospitalIdMatched =
        !hospitalIdKeyword || normalizeText(patient.hospitalPatientId).includes(hospitalIdKeyword);
      const phoneMatched = !phoneKeyword || normalizeText(patient.phone).includes(phoneKeyword);
      const idCardMatched = patientMatchesIdLast4(patient, idCardLast4Filter);
      const genderMatched = genderFilter === 'ALL' || patient.gender === genderFilter;
      const diseaseMatched = patientHasDisease(patient, diseaseFilter);
      const riskMatched = riskFilter === 'ALL' || highestRisk === riskFilter;

      return (
        nameMatched &&
        hospitalIdMatched &&
        phoneMatched &&
        idCardMatched &&
        genderMatched &&
        diseaseMatched &&
        riskMatched
      );
    });
  }, [diseaseFilter, genderFilter, hospitalIdFilter, idCardLast4Filter, nameFilter, patients, phoneFilter, riskFilter]);

  const activeFilterCount = [
    nameFilter,
    hospitalIdFilter,
    phoneFilter,
    idCardLast4Filter,
    genderFilter !== 'ALL' ? genderFilter : '',
    diseaseFilter !== 'ALL' ? diseaseFilter : '',
    riskFilter !== 'ALL' ? riskFilter : '',
  ].filter(Boolean).length;

  function clearFilters() {
    setNameFilter('');
    setHospitalIdFilter('');
    setPhoneFilter('');
    setIdCardLast4Filter('');
    setGenderFilter('ALL');
    setDiseaseFilter('ALL');
    setRiskFilter('ALL');
  }

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
    if (hisLoading) {
      setMessage('HIS 查询正在进行中，请勿重复点击。');
      return;
    }

    if (!canEditPatients) {
      setError('当前角色为只读权限，不能执行 HIS 建档查询。');
      return;
    }

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
        setMessage('已匹配本平台患者，可回到患者主索引进入档案。');
      } else {
        fillFormFromHisPatient(res.data.patient);
        setShowCreateForm(true);
        setMessage(res.data.message);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'HIS 条码查询失败。请确认后端已启动，或先手工录入患者。'));
    } finally {
      setHisLoading(false);
    }
  }

  async function importHisDraft() {
    if (hisLoading) {
      setMessage('HIS 草稿正在拉取中，请勿重复点击。');
      return;
    }

    if (!canEditPatients) {
      setError('当前角色为只读权限，不能从 HIS 拉取建档草稿。');
      return;
    }

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
    } catch (err) {
      setError(getApiErrorMessage(err, 'HIS 患者草稿拉取失败。当前接口为预留模式，请检查后端是否已启动。'));
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

    if (creating) {
      setMessage('患者建档正在保存中，请勿重复提交。');
      return;
    }

    if (!canEditPatients) {
      setError('当前角色没有新增患者权限。');
      return;
    }

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
      setMessage('患者已建档。可回到患者主索引进入档案，继续补充慢病、指标、随访和任务。');
      await loadPatients();
    } catch (err) {
      setError(getApiErrorMessage(err, '患者建档失败。请检查院内 ID 是否重复，或确认后端服务是否正常。'));
    } finally {
      setCreating(false);
    }
  }

  async function exportPatientsForHis() {
    if (exporting) {
      setMessage('HIS 导出正在生成中，请勿重复点击。');
      return;
    }

    if (!canExportPatients) {
      setError('当前角色没有 HIS 导出权限。');
      return;
    }

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
    } catch (err) {
      setError(getApiErrorMessage(err, '导出失败。请确认后端 HIS 预留接口已启动。'));
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return <div className="loading-state">正在加载患者主索引...</div>;
  }

  return (
    <div className="patient-index-clean">

      <section className="panel patient-master-index-shell">
        <div className="section-title-row patient-master-index-shell-heading">
          <div>
            <h2>患者主索引</h2>
            <p className="muted">检索、筛选、进入档案；建档入口、扫码查询、HIS 草稿和手工建档统一放在本区，避免入口分散。</p>
          </div>
          <span className="type-badge">MASTER INDEX</span>
        </div>

        <section className="workspace-tabs-card patient-master-workspace-tabs" aria-label="患者主索引工作区">
          <button
            type="button"
            className={activeWorkspace === 'index' ? 'workspace-tab active' : 'workspace-tab'}
            onClick={() => setActiveWorkspace('index')}
          >
            <strong>患者主索引</strong>
            <span>检索、筛选、进入档案</span>
          </button>
          <button
            type="button"
            className={activeWorkspace === 'intake' ? 'workspace-tab active' : 'workspace-tab'}
            onClick={() => setActiveWorkspace('intake')}
            disabled={!canEditPatients}
          >
            <strong>建档入口</strong>
            <span>扫码、HIS 草稿、手工建档</span>
          </button>
        </section>
      </section>

      {activeWorkspace === 'index' && (
        <section className="panel patient-master-index-panel">
          <div className="section-title-row">
            <div>
              <h2>检索、筛选、进入档案</h2>
              <p className="muted">共 {patients.length} 名患者，当前显示 {filteredPatients.length} 名。列表默认脱敏，查看详情会写入审计日志。</p>
            </div>
            <div className="patient-index-section-actions">
              <span className="type-badge">索引区</span>
              {canExportPatients && (
                <button className="secondary-btn compact-link-btn" onClick={exportPatientsForHis} disabled={exporting} type="button">
                  {exporting ? '导出中...' : '导出给 HIS'}
                </button>
              )}
            </div>
          </div>

          <div className="index-filter-card">
            <div className="filter-card-header">
              <div>
                <h3>索引条件</h3>
                <p>不同索引方式分开录入，避免院内 ID、电话、身份证等全部塞进一个搜索框。</p>
              </div>
              <button className="ghost-btn" type="button" onClick={clearFilters} disabled={activeFilterCount === 0}>
                清空条件{activeFilterCount > 0 ? `（${activeFilterCount}）` : ''}
              </button>
            </div>

            <div className="patient-index-filter-grid">
              <label>
                患者姓名
                <input value={nameFilter} onChange={(event) => setNameFilter(event.target.value)} placeholder="按姓名检索" />
              </label>
              <label>
                院内 ID
                <input value={hospitalIdFilter} onChange={(event) => setHospitalIdFilter(event.target.value)} placeholder="如 MZ20260519001" />
              </label>
              <label>
                手机号
                <input value={phoneFilter} onChange={(event) => setPhoneFilter(event.target.value)} placeholder="支持脱敏号段检索" />
              </label>
              <label>
                身份证后四位
                <input value={idCardLast4Filter} onChange={(event) => setIdCardLast4Filter(event.target.value)} placeholder="如 0011" maxLength={8} />
              </label>
              <label>
                性别
                <select value={genderFilter} onChange={(event) => setGenderFilter(event.target.value)}>
                  <option value="ALL">全部性别</option>
                  <option value="MALE">男</option>
                  <option value="FEMALE">女</option>
                  <option value="UNKNOWN">未知</option>
                </select>
              </label>
              <label>
                慢病标签
                <select value={diseaseFilter} onChange={(event) => setDiseaseFilter(event.target.value)}>
                  <option value="ALL">全部慢病标签</option>
                  {diseaseOptions.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                综合风险
                <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}>
                  <option value="ALL">全部风险等级</option>
                  {riskOptions.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="patient-index-summary-row">
            <span>当前筛选：{activeFilterCount === 0 ? '无筛选条件' : `${activeFilterCount} 项条件`}</span>
            <span>显示 {filteredPatients.length} / {patients.length}</span>
          </div>

          <div className="table-wrap clean-table-wrap">
            <table className="table clean-hospital-table">
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
                          <div className="tag-list">
                            {patient.diseaseProfiles.map((item) => (
                              <span className="type-badge" key={`${item.diseaseType}-${item.riskLevel}`}>
                                {diseaseLabelMap[item.diseaseType] ?? item.diseaseType}
                              </span>
                            ))}
                          </div>
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
                      <td><Link className="secondary-btn compact-link-btn" to={`/patients/${patient.id}`}>进入档案</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filteredPatients.length === 0 && (
            <div className="empty-state" style={{ marginTop: 14 }}>
              没有符合条件的患者。请调整索引条件，或进入“建档入口”新增患者。
            </div>
          )}
        </section>
      )}

      {activeWorkspace === 'intake' && (
        <section className="panel patient-intake-panel">
          <div className="section-title-row">
            <div>
              <h2>建档入口</h2>
              <p className="muted">扫码、HIS 草稿、手工建档集中在同一个 section 内；保存后回到主索引进入患者档案。</p>
            </div>
            <button className="ghost-btn" type="button" onClick={() => setActiveWorkspace('index')}>
              返回主索引
            </button>
          </div>

          <div className="security-chip">建档入口已并入患者主索引工作区；患者列表默认脱敏，查看单个患者详情会写入审计日志。</div>

          <div className="intake-layout-grid">
            <section className="intake-card">
              <div className="intake-card-header">
                <h3>扫码、HIS 草稿、手工建档</h3>
                <p>扫描枪通常会把条形码当作键盘输入并自动回车；此处按 Enter 自动查询 HIS 预留接口。</p>
              </div>

              <div className="his-action-column">
                <label>
                  就诊卡 / 腕带条形码 / 院内 ID
                  <input
                    className="his-barcode-input"
                    value={barcode}
                    disabled={hisLoading}
                    onChange={(event) => setBarcode(event.target.value)}
                    onKeyDown={handleBarcodeKeyDown}
                    placeholder="扫描或输入后按 Enter"
                  />
                </label>

                <div className="intake-button-row">
                  <button className="secondary-btn" onClick={lookupBarcode} disabled={hisLoading} type="button">
                    {hisLoading ? '查询中...' : '扫码查询'}
                  </button>
                  <button className="secondary-btn" onClick={importHisDraft} disabled={hisLoading} type="button">
                    {hisLoading ? '处理中...' : '从 HIS 拉取草稿'}
                  </button>
                  <button
                    className="primary-btn"
                    type="button"
                    onClick={() => {
                      setForm(emptyForm);
                      setShowCreateForm(true);
                    }}
                    disabled={hisLoading || creating}
                  >
                    手工新增患者
                  </button>
                </div>
              </div>

              <div className="interface-note compact-interface-note">
                <strong>接口预留：</strong>
                <code>GET /his/patients/barcode/:barcode</code>
                <code>POST /his/patients/import</code>
              </div>
            </section>

            <section className="intake-card intake-guide-card">
              <h3>建档流程</h3>
              <ol>
                <li>先通过院内 ID / 条形码查询 HIS 草稿。</li>
                <li>HIS 未返回的字段由护士或医生补充。</li>
                <li>保存后回到主索引进入患者详情页。</li>
                <li>慢病档案、监测计划、随访任务在患者详情页继续维护。</li>
              </ol>
            </section>
          </div>

          {showCreateForm && canEditPatients && (
            <form className="form form-card clean-create-form" onSubmit={createPatient} aria-busy={creating}>
              <div className="section-title-row compact">
                <div>
                  <h3>新增患者建档</h3>
                  <p className="muted">表单仅在建档入口展开，避免影响主索引检索和筛选。</p>
                </div>
                <button className="ghost-btn" type="button" onClick={() => setShowCreateForm(false)}>
                  收起表单
                </button>
              </div>

              <div className="form-grid three-columns">
                <label>
                  院内 ID / HIS 主索引号
                  <input value={form.hospitalPatientId} onChange={(event) => updateForm('hospitalPatientId', event.target.value)} placeholder="例如 MZ20260519001" />
                </label>

                <label>
                  患者姓名
                  <input value={form.name} onChange={(event) => updateForm('name', event.target.value)} placeholder="请输入患者姓名" required />
                </label>

                <label>
                  性别
                  <select value={form.gender} onChange={(event) => updateForm('gender', event.target.value as PatientForm['gender'])}>
                    <option value="UNKNOWN">未知</option>
                    <option value="MALE">男</option>
                    <option value="FEMALE">女</option>
                  </select>
                </label>

                <label>
                  出生日期
                  <input type="date" value={form.birthDate} onChange={(event) => updateForm('birthDate', event.target.value)} />
                </label>

                <label>
                  联系电话
                  <input value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} placeholder="手机号" />
                </label>

                <label>
                  身份证号
                  <input value={form.idCardNo} onChange={(event) => updateForm('idCardNo', event.target.value)} placeholder="可选" />
                </label>

                <label className="wide-field">
                  地址
                  <input value={form.address} onChange={(event) => updateForm('address', event.target.value)} placeholder="患者常住地址" />
                </label>

                <label>
                  责任医生
                  <input value={form.responsibleDoctorId} onChange={(event) => updateForm('responsibleDoctorId', event.target.value)} />
                </label>

                <label>
                  责任护士
                  <input value={form.responsibleNurseId} onChange={(event) => updateForm('responsibleNurseId', event.target.value)} />
                </label>
              </div>

              <div className="form-actions operation-safe-actions">
                <button className="primary-btn" type="submit" disabled={creating}>
                  {creating ? '保存中，请勿重复提交...' : '保存患者档案'}
                </button>
                <button className="ghost-btn" type="button" onClick={() => setForm(emptyForm)} disabled={creating}>
                  清空表单
                </button>
                <span className="operation-form-hint">保存成功后会显示绿色提示，并自动刷新患者主索引。</span>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  );
}




