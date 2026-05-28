/**
 * oracle-intermediate-db.adapter.ts
 *
 * gateway-production-hardening: 真正可上线的 Oracle 前置机适配器.
 *
 * 部署:
 *   1. 在 apps/api 内: `npm install oracledb`
 *      Oracle 客户端在 oracledb >= 6 默认走 thin 模式, 不再需要本机装
 *      Oracle Instant Client (兼容 11.2+).
 *      如果对端是 Oracle 11g 之前, 仍然需要装 Instant Client + 设置
 *      LD_LIBRARY_PATH / DYLD_LIBRARY_PATH.
 *   2. 在 apps/api/.env:
 *
 *      GATEWAY_INTERMEDIATE_ADAPTER=oracle
 *      GATEWAY_INTERMEDIATE_ORACLE_USER=chronic_readonly
 *      GATEWAY_INTERMEDIATE_ORACLE_PASSWORD=...
 *      GATEWAY_INTERMEDIATE_ORACLE_CONNECT_STRING=10.1.0.51:1521/HIS_BRIDGE
 *      # 默认表名:
 *      GATEWAY_INTERMEDIATE_ORACLE_PATIENT_TABLE=V_CHRONIC_PATIENT
 *      GATEWAY_INTERMEDIATE_ORACLE_DIAGNOSIS_TABLE=V_CHRONIC_DIAGNOSIS
 *      GATEWAY_INTERMEDIATE_ORACLE_LAB_TABLE=V_CHRONIC_LAB_RESULT
 *      GATEWAY_INTERMEDIATE_ORACLE_PRESCRIPTION_TABLE=V_CHRONIC_PRESCRIPTION
 *      GATEWAY_INTERMEDIATE_ORACLE_DISCHARGE_TABLE=V_CHRONIC_DISCHARGE
 *
 * 与 SqlServer 适配器对比:
 *   - Oracle 没有 DateTime2, 用 TO_CHAR / TO_TIMESTAMP 显式转字符串
 *   - bind 变量风格 是 `:since` 而不是 `@since`
 *   - 默认 outFormat=OBJECT, 字段名 大写, 因此我们手动 lowercase
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  IntermediateDbAdapter,
  IntermediateDiagnosisRow,
  IntermediateDischargeRow,
  IntermediateLabRow,
  IntermediatePatientRow,
  IntermediatePrescriptionRow,
} from '../interfaces/intermediate-db.adapter';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OracleModule = any;

@Injectable()
export class OracleIntermediateDbAdapter implements IntermediateDbAdapter {
  readonly name = 'OracleIntermediateDbAdapter';

  private readonly logger = new Logger('OracleIntermediateDbAdapter');
  private pool: any = null;
  private oracledb: OracleModule | null = null;

  async connect(): Promise<void> {
    if (this.pool) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      this.oracledb = require('oracledb');
    } catch (err) {
      throw new Error(
        'oracledb package is not installed. Run `npm install oracledb` in apps/api before enabling GATEWAY_INTERMEDIATE_ADAPTER=oracle. ' +
          `Original error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.oracledb.outFormat = this.oracledb.OUT_FORMAT_OBJECT;
    this.pool = await this.oracledb.createPool({
      user: required('GATEWAY_INTERMEDIATE_ORACLE_USER'),
      password: required('GATEWAY_INTERMEDIATE_ORACLE_PASSWORD'),
      connectString: required('GATEWAY_INTERMEDIATE_ORACLE_CONNECT_STRING'),
      poolMin: 0,
      poolMax: 4,
      poolIncrement: 1,
    });
    this.logger.log('Connected to Oracle pool');
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.close(10);
      } catch (err) {
        this.logger.warn(`Failed to close Oracle pool: ${err instanceof Error ? err.message : err}`);
      }
      this.pool = null;
    }
  }

  private get t() {
    return {
      patient: process.env.GATEWAY_INTERMEDIATE_ORACLE_PATIENT_TABLE ?? 'V_CHRONIC_PATIENT',
      diagnosis:
        process.env.GATEWAY_INTERMEDIATE_ORACLE_DIAGNOSIS_TABLE ?? 'V_CHRONIC_DIAGNOSIS',
      lab: process.env.GATEWAY_INTERMEDIATE_ORACLE_LAB_TABLE ?? 'V_CHRONIC_LAB_RESULT',
      prescription:
        process.env.GATEWAY_INTERMEDIATE_ORACLE_PRESCRIPTION_TABLE ?? 'V_CHRONIC_PRESCRIPTION',
      discharge:
        process.env.GATEWAY_INTERMEDIATE_ORACLE_DISCHARGE_TABLE ?? 'V_CHRONIC_DISCHARGE',
    };
  }

  private async query<T>(sql: string, since: Date): Promise<T[]> {
    if (!this.pool) await this.connect();
    const conn = await this.pool.getConnection();
    try {
      const result = await conn.execute(sql, { since }, {});
      return (result.rows ?? []) as T[];
    } finally {
      try {
        await conn.close();
      } catch (err) {
        this.logger.warn(`Failed to close Oracle conn: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  /* ----------------------------------------------------------------- */

  async fetchPatientsModifiedAfter(since: Date): Promise<IntermediatePatientRow[]> {
    const rows = await this.query<any>(
      `SELECT
         ROW_ID                                   AS "rowId",
         HOSPITAL_PAT_ID                          AS "hospitalPatientId",
         NAME                                     AS "name",
         GENDER_CODE                              AS "genderCode",
         TO_CHAR(BIRTH_DATE, 'YYYY-MM-DD')        AS "birthDate",
         PHONE                                    AS "phone",
         ID_CARD_NO                               AS "idCardNo",
         ADDRESS                                  AS "address",
         UPDATED_AT                               AS "updatedAt"
       FROM ${this.t.patient}
       WHERE UPDATED_AT > :since
       ORDER BY UPDATED_AT ASC`,
      since,
    );
    return rows.map(coerceUpdatedAt);
  }

  async fetchDiagnosesModifiedAfter(since: Date): Promise<IntermediateDiagnosisRow[]> {
    const rows = await this.query<any>(
      `SELECT
         ROW_ID                                   AS "rowId",
         HOSPITAL_PAT_ID                          AS "hospitalPatientId",
         ICD_CODE                                 AS "icdCode",
         ICD_NAME                                 AS "icdName",
         TO_CHAR(DIAGNOSIS_DATE, 'YYYY-MM-DD')    AS "diagnosisDate",
         RISK_LEVEL_TEXT                          AS "riskLevelText",
         COMPLICATIONS                            AS "complications",
         COMORBIDITIES                            AS "comorbidities",
         UPDATED_AT                               AS "updatedAt"
       FROM ${this.t.diagnosis}
       WHERE UPDATED_AT > :since
       ORDER BY UPDATED_AT ASC`,
      since,
    );
    return rows.map(coerceUpdatedAt);
  }

  async fetchLabResultsAfter(since: Date): Promise<IntermediateLabRow[]> {
    const rows = await this.query<any>(
      `SELECT
         ROW_ID                                              AS "rowId",
         HOSPITAL_PAT_ID                                     AS "hospitalPatientId",
         ITEM_CODE                                           AS "itemCode",
         ITEM_NAME                                           AS "itemName",
         RESULT_VALUE                                        AS "value",
         RESULT_UNIT                                         AS "unit",
         REFERENCE_RANGE                                     AS "referenceRange",
         ABNORMAL_FLAG                                       AS "abnormalFlag",
         TO_CHAR(REPORTED_AT, 'YYYY-MM-DD"T"HH24:MI:SS')     AS "reportedAt",
         UPDATED_AT                                          AS "updatedAt"
       FROM ${this.t.lab}
       WHERE UPDATED_AT > :since
       ORDER BY UPDATED_AT ASC`,
      since,
    );
    return rows.map((r) => ({
      ...coerceUpdatedAt(r),
      value: typeof r.value === 'number' ? r.value : Number(r.value),
    }));
  }

  async fetchPrescriptionsAfter(since: Date): Promise<IntermediatePrescriptionRow[]> {
    const rows = await this.query<any>(
      `SELECT
         ROW_ID                                   AS "rowId",
         HOSPITAL_PAT_ID                          AS "hospitalPatientId",
         DRUG_NAME                                AS "drugName",
         DOSAGE                                   AS "dosage",
         FREQUENCY                                AS "frequency",
         INSTRUCTIONS                             AS "instructions",
         TO_CHAR(START_DATE, 'YYYY-MM-DD')        AS "startDate",
         TO_CHAR(END_DATE,   'YYYY-MM-DD')        AS "endDate",
         UPDATED_AT                               AS "updatedAt"
       FROM ${this.t.prescription}
       WHERE UPDATED_AT > :since
       ORDER BY UPDATED_AT ASC`,
      since,
    );
    return rows.map(coerceUpdatedAt);
  }

  async fetchDischargesAfter(since: Date): Promise<IntermediateDischargeRow[]> {
    const rows = await this.query<any>(
      `SELECT
         ROW_ID                                   AS "rowId",
         HOSPITAL_PAT_ID                          AS "hospitalPatientId",
         TO_CHAR(ADMISSION_DATE, 'YYYY-MM-DD')    AS "admissionDate",
         TO_CHAR(DISCHARGE_DATE, 'YYYY-MM-DD')    AS "dischargeDate",
         DEPARTMENT                               AS "department",
         DIAGNOSIS_TEXT                           AS "diagnosisText",
         DIAGNOSIS_ICD                            AS "diagnosisIcd",
         SUMMARY                                  AS "summary",
         UPDATED_AT                               AS "updatedAt"
       FROM ${this.t.discharge}
       WHERE UPDATED_AT > :since
       ORDER BY UPDATED_AT ASC`,
      since,
    );
    return rows.map(coerceUpdatedAt);
  }
}

function required(envName: string): string {
  const v = process.env[envName];
  if (!v) {
    throw new Error(`Environment variable ${envName} is required for OracleIntermediateDbAdapter`);
  }
  return v;
}

function coerceUpdatedAt<T extends { updatedAt: any }>(row: T): T {
  return {
    ...row,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt),
  };
}
