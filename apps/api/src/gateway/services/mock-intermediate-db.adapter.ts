/**
 * mock-intermediate-db.adapter.ts
 *
 * 一个本地内存版的中间表适配器，供开发 / Demo / 单测使用。
 *
 * 它伪装成医院前置机：返回一组"假装是从 SQL Server 拉来"的患者/诊断/检验/处方/出院数据。
 * 每次调用时只返回 updatedAt > since 的行，且第一次调用之后会推进 "已被消费" 指针，
 * 这样 Poller 能体验到完整的"增量同步"行为。
 *
 * 真实上线时：
 *   1. 把这个 provider 替换为自己的 SqlServerIntermediateAdapter（用 mssql 包）
 *      或 OracleIntermediateAdapter（用 oracledb 包）
 *   2. 在 gateway.module.ts 的 providers 数组里改 `useClass`
 *
 * 参考 docs/gateway/samples/intermediate-tables.sql 中给出的标准前置机表结构。
 */

import { Injectable } from '@nestjs/common';
import {
  IntermediateDbAdapter,
  IntermediateDiagnosisRow,
  IntermediateDischargeRow,
  IntermediateLabRow,
  IntermediatePatientRow,
  IntermediatePrescriptionRow,
} from '../interfaces/intermediate-db.adapter';

function minutesAgo(min: number): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() - min);
  return d;
}

@Injectable()
export class MockIntermediateDbAdapter implements IntermediateDbAdapter {
  readonly name = 'MockIntermediateDbAdapter';

  /* ----- patients ----- */
  private readonly patients: IntermediatePatientRow[] = [
    {
      rowId: 'MOCK-PAT-001',
      hospitalPatientId: 'MZ20260520001',
      name: '李海洋',
      genderCode: 'M',
      birthDate: '1965-03-21',
      phone: '13912340001',
      idCardNo: '610102196503210011',
      address: '碑林区南大街社区',
      updatedAt: minutesAgo(15),
    },
    {
      rowId: 'MOCK-PAT-002',
      hospitalPatientId: 'MZ20260520002',
      name: '陈秀英',
      genderCode: 'F',
      birthDate: '1958-07-09',
      phone: '13912340002',
      idCardNo: '610112195807090022',
      address: '碑林区柏树林社区',
      updatedAt: minutesAgo(10),
    },
  ];

  /* ----- diagnoses ----- */
  private readonly diagnoses: IntermediateDiagnosisRow[] = [
    {
      rowId: 'MOCK-DIAG-001',
      hospitalPatientId: 'MZ20260520001',
      icdCode: 'I10',
      icdName: '原发性高血压',
      diagnosisDate: '2026-05-12',
      riskLevelText: '高危',
      complications: '靶器官损害待评估',
      comorbidities: '2 型糖尿病',
      updatedAt: minutesAgo(20),
    },
    {
      rowId: 'MOCK-DIAG-002',
      hospitalPatientId: 'MZ20260520002',
      icdCode: 'E11.9',
      icdName: '2 型糖尿病',
      diagnosisDate: '2026-04-30',
      riskLevelText: '中危',
      updatedAt: minutesAgo(18),
    },
  ];

  /* ----- lab results ----- */
  private readonly labs: IntermediateLabRow[] = [
    {
      rowId: 'MOCK-LAB-001',
      hospitalPatientId: 'MZ20260520001',
      itemCode: 'GLU',
      itemName: '空腹血糖',
      value: 8.7,
      unit: 'mmol/L',
      referenceRange: '3.9-6.1',
      abnormalFlag: 'H',
      reportedAt: new Date().toISOString(),
      updatedAt: minutesAgo(8),
    },
    {
      rowId: 'MOCK-LAB-002',
      hospitalPatientId: 'MZ20260520002',
      itemCode: 'HBA1C',
      itemName: '糖化血红蛋白',
      value: 7.4,
      unit: '%',
      referenceRange: '<6.5',
      abnormalFlag: 'H',
      reportedAt: new Date().toISOString(),
      updatedAt: minutesAgo(5),
    },
  ];

  /* ----- prescriptions ----- */
  private readonly prescriptions: IntermediatePrescriptionRow[] = [
    {
      rowId: 'MOCK-RX-001',
      hospitalPatientId: 'MZ20260520001',
      drugName: '苯磺酸氨氯地平片',
      dosage: '5mg',
      frequency: 'qd',
      instructions: '晨起空腹口服',
      startDate: '2026-05-12',
      endDate: '2026-08-12',
      updatedAt: minutesAgo(25),
    },
    {
      rowId: 'MOCK-RX-002',
      hospitalPatientId: 'MZ20260520002',
      drugName: '盐酸二甲双胍片',
      dosage: '500mg',
      frequency: 'bid',
      instructions: '随餐服用',
      startDate: '2026-04-30',
      endDate: '2026-07-30',
      updatedAt: minutesAgo(22),
    },
  ];

  /* ----- discharges ----- */
  private readonly discharges: IntermediateDischargeRow[] = [
    {
      rowId: 'MOCK-DC-001',
      hospitalPatientId: 'MZ20260520001',
      admissionDate: '2026-05-08',
      dischargeDate: '2026-05-12',
      department: '心血管内科',
      diagnosisText: '原发性高血压，靶器官损害',
      diagnosisIcd: 'I10',
      summary: '建议出院后规律服药，2 周后门诊随访。',
      updatedAt: minutesAgo(30),
    },
  ];

  /* ------------------------------------------------------------------ */

  async fetchPatientsModifiedAfter(since: Date): Promise<IntermediatePatientRow[]> {
    return this.patients.filter((r) => r.updatedAt > since);
  }

  async fetchDiagnosesModifiedAfter(since: Date): Promise<IntermediateDiagnosisRow[]> {
    return this.diagnoses.filter((r) => r.updatedAt > since);
  }

  async fetchLabResultsAfter(since: Date): Promise<IntermediateLabRow[]> {
    return this.labs.filter((r) => r.updatedAt > since);
  }

  async fetchPrescriptionsAfter(since: Date): Promise<IntermediatePrescriptionRow[]> {
    return this.prescriptions.filter((r) => r.updatedAt > since);
  }

  async fetchDischargesAfter(since: Date): Promise<IntermediateDischargeRow[]> {
    return this.discharges.filter((r) => r.updatedAt > since);
  }
}
