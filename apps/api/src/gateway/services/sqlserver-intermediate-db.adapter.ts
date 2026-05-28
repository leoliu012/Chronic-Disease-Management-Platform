/**
 * sqlserver-intermediate-db.adapter.ts
 *
 * gateway-production-hardening: 真正可上线的 SQL Server 前置机适配器.
 *
 * 部署:
 *   1. 在 apps/api 内: `npm install mssql`
 *      (我们把 mssql 列在了 optionalDependencies, dev / CI 不需要它)
 *   2. 在 apps/api/.env 设置 GATEWAY_INTERMEDIATE_ADAPTER=sqlserver
 *      并填入下列连接参数:
 *
 *      GATEWAY_INTERMEDIATE_MSSQL_HOST=10.1.0.50
 *      GATEWAY_INTERMEDIATE_MSSQL_PORT=1433
 *      GATEWAY_INTERMEDIATE_MSSQL_USER=chronic_readonly
 *      GATEWAY_INTERMEDIATE_MSSQL_PASSWORD=...
 *      GATEWAY_INTERMEDIATE_MSSQL_DATABASE=HIS_BRIDGE
 *      GATEWAY_INTERMEDIATE_MSSQL_ENCRYPT=true       # Azure / 默认开
 *      GATEWAY_INTERMEDIATE_MSSQL_TRUST_CERT=false   # 自签证书才设 true
 *      # 默认表名:
 *      GATEWAY_INTERMEDIATE_MSSQL_PATIENT_TABLE=v_chronic_patient
 *      GATEWAY_INTERMEDIATE_MSSQL_DIAGNOSIS_TABLE=v_chronic_diagnosis
 *      GATEWAY_INTERMEDIATE_MSSQL_LAB_TABLE=v_chronic_lab_result
 *      GATEWAY_INTERMEDIATE_MSSQL_PRESCRIPTION_TABLE=v_chronic_prescription
 *      GATEWAY_INTERMEDIATE_MSSQL_DISCHARGE_TABLE=v_chronic_discharge
 *
 * 表结构 (字段名 / 类型) 参考 docs/gateway/samples/intermediate-tables.sql.
 * 真实部署时医院可能给的列名不一样 -> 由本 adapter 的 SELECT alias 映射统一.
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

// 延迟加载 mssql, 避免 dev 环境必须装它
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MssqlModule = any;

@Injectable()
export class SqlServerIntermediateDbAdapter implements IntermediateDbAdapter {
  readonly name = 'SqlServerIntermediateDbAdapter';

  private readonly logger = new Logger('SqlServerIntermediateDbAdapter');
  private pool: any = null;
  private mssql: MssqlModule | null = null;

  async connect(): Promise<void> {
    if (this.pool) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      this.mssql = require('mssql');
    } catch (err) {
      throw new Error(
        'mssql package is not installed. Run `npm install mssql` in apps/api before enabling GATEWAY_INTERMEDIATE_ADAPTER=sqlserver. ' +
          `Original error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const config = {
      server: required('GATEWAY_INTERMEDIATE_MSSQL_HOST'),
      port: Number(process.env.GATEWAY_INTERMEDIATE_MSSQL_PORT ?? 1433),
      user: required('GATEWAY_INTERMEDIATE_MSSQL_USER'),
      password: required('GATEWAY_INTERMEDIATE_MSSQL_PASSWORD'),
      database: required('GATEWAY_INTERMEDIATE_MSSQL_DATABASE'),
      pool: { max: 4, min: 0, idleTimeoutMillis: 30_000 },
      options: {
        encrypt: parseBool(process.env.GATEWAY_INTERMEDIATE_MSSQL_ENCRYPT, true),
        trustServerCertificate: parseBool(
          process.env.GATEWAY_INTERMEDIATE_MSSQL_TRUST_CERT,
          false,
        ),
      },
      requestTimeout: 30_000,
      connectionTimeout: 15_000,
    };
    this.pool = await new this.mssql.ConnectionPool(config).connect();
    this.logger.log(
      `Connected to SQL Server ${config.server}:${config.port}/${config.database}`,
    );
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.close();
      } catch (err) {
        this.logger.warn(`Failed to close mssql pool: ${err instanceof Error ? err.message : err}`);
      }
      this.pool = null;
    }
  }

  private get t() {
    return {
      patient: process.env.GATEWAY_INTERMEDIATE_MSSQL_PATIENT_TABLE ?? 'v_chronic_patient',
      diagnosis:
        process.env.GATEWAY_INTERMEDIATE_MSSQL_DIAGNOSIS_TABLE ?? 'v_chronic_diagnosis',
      lab: process.env.GATEWAY_INTERMEDIATE_MSSQL_LAB_TABLE ?? 'v_chronic_lab_result',
      prescription:
        process.env.GATEWAY_INTERMEDIATE_MSSQL_PRESCRIPTION_TABLE ?? 'v_chronic_prescription',
      discharge:
        process.env.GATEWAY_INTERMEDIATE_MSSQL_DISCHARGE_TABLE ?? 'v_chronic_discharge',
    };
  }

  private async query<T>(sql: string, since: Date): Promise<T[]> {
    if (!this.pool) await this.connect();
    const request = this.pool.request();
    request.input('since', this.mssql.DateTime2, since);
    const result = await request.query(sql);
    return result.recordset as T[];
  }

  /* ----------------------------------------------------------------- */

  async fetchPatientsModifiedAfter(since: Date): Promise<IntermediatePatientRow[]> {
    const rows = await this.query<any>(
      `SELECT
         row_id           AS rowId,
         hospital_pat_id  AS hospitalPatientId,
         name             AS name,
         gender_code      AS genderCode,
         CONVERT(varchar(10), birth_date, 23) AS birthDate,
         phone            AS phone,
         id_card_no       AS idCardNo,
         address          AS address,
         updated_at       AS updatedAt
       FROM [${this.t.patient}]
       WHERE updated_at > @since
       ORDER BY updated_at ASC`,
      since,
    );
    return rows.map(coerceUpdatedAt);
  }

  async fetchDiagnosesModifiedAfter(since: Date): Promise<IntermediateDiagnosisRow[]> {
    const rows = await this.query<any>(
      `SELECT
         row_id           AS rowId,
         hospital_pat_id  AS hospitalPatientId,
         icd_code         AS icdCode,
         icd_name         AS icdName,
         CONVERT(varchar(10), diagnosis_date, 23) AS diagnosisDate,
         risk_level_text  AS riskLevelText,
         complications    AS complications,
         comorbidities    AS comorbidities,
         updated_at       AS updatedAt
       FROM [${this.t.diagnosis}]
       WHERE updated_at > @since
       ORDER BY updated_at ASC`,
      since,
    );
    return rows.map(coerceUpdatedAt);
  }

  async fetchLabResultsAfter(since: Date): Promise<IntermediateLabRow[]> {
    const rows = await this.query<any>(
      `SELECT
         row_id           AS rowId,
         hospital_pat_id  AS hospitalPatientId,
         item_code        AS itemCode,
         item_name        AS itemName,
         result_value     AS value,
         result_unit      AS unit,
         reference_range  AS referenceRange,
         abnormal_flag    AS abnormalFlag,
         CONVERT(varchar(23), reported_at, 126) AS reportedAt,
         updated_at       AS updatedAt
       FROM [${this.t.lab}]
       WHERE updated_at > @since
       ORDER BY updated_at ASC`,
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
         row_id           AS rowId,
         hospital_pat_id  AS hospitalPatientId,
         drug_name        AS drugName,
         dosage           AS dosage,
         frequency        AS frequency,
         instructions     AS instructions,
         CONVERT(varchar(10), start_date, 23) AS startDate,
         CONVERT(varchar(10), end_date, 23)   AS endDate,
         updated_at       AS updatedAt
       FROM [${this.t.prescription}]
       WHERE updated_at > @since
       ORDER BY updated_at ASC`,
      since,
    );
    return rows.map(coerceUpdatedAt);
  }

  async fetchDischargesAfter(since: Date): Promise<IntermediateDischargeRow[]> {
    const rows = await this.query<any>(
      `SELECT
         row_id           AS rowId,
         hospital_pat_id  AS hospitalPatientId,
         CONVERT(varchar(10), admission_date, 23) AS admissionDate,
         CONVERT(varchar(10), discharge_date, 23) AS dischargeDate,
         department       AS department,
         diagnosis_text   AS diagnosisText,
         diagnosis_icd    AS diagnosisIcd,
         summary          AS summary,
         updated_at       AS updatedAt
       FROM [${this.t.discharge}]
       WHERE updated_at > @since
       ORDER BY updated_at ASC`,
      since,
    );
    return rows.map(coerceUpdatedAt);
  }
}

function required(envName: string): string {
  const v = process.env[envName];
  if (!v) {
    throw new Error(`Environment variable ${envName} is required for SqlServerIntermediateDbAdapter`);
  }
  return v;
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  const s = v.toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return fallback;
}

function coerceUpdatedAt<T extends { updatedAt: any }>(row: T): T {
  return {
    ...row,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt),
  };
}
