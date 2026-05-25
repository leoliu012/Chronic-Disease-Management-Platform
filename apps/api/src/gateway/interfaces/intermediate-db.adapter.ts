/**
 * intermediate-db.adapter.ts
 *
 * 中间表/视图模式的"前置机"适配器接口。
 *
 * 国内最常见的医院数据接入模式：医院给我们一个只读账号，连接他们
 * 内网的"前置机"中间库（一般是 SQL Server 或 Oracle）。HIS 会每晚 12 点
 * 把当天的患者/诊断/检验/处方/出院数据，按事先约定好的表结构，
 * ETL 到这个中间库里。
 *
 * 我们要做的就是定时 (Cron) 从这个中间库读最近变更，包装成 NormalizedEvent
 * 推给统一摄取层。生产上每家医院的中间表名/字段名/类型都可能略有不同，
 * 因此用 Adapter Pattern 把"具体怎么连"和"业务逻辑"解耦。
 *
 * 上线时通常的实现方式是：
 *   - 安装 `mssql` (SQL Server) 或 `oracledb` (Oracle) 包
 *   - 在 OnModuleInit 中建立连接池
 *   - 在每个 fetchXxxAfter 方法里用 SQL 查询「最近 N 分钟」的增量
 *
 * 本模块默认提供 MockIntermediateDbAdapter，使用前请通过自定义 NestJS provider
 * 替换为真正的实现。
 */

export interface IntermediatePatientRow {
  /** 中间表主键 */
  rowId: string;
  /** 院内患者号 */
  hospitalPatientId: string;
  /** 姓名（必填） */
  name: string;
  /** 性别代码（医院通常用 "1"=男 / "2"=女 / "0"=未知 或 "M"/"F"） */
  genderCode?: string;
  /** 出生日期 yyyy-MM-dd */
  birthDate?: string;
  /** 手机号 */
  phone?: string;
  /** 身份证号 */
  idCardNo?: string;
  /** 户籍地址或常住地址 */
  address?: string;
  /** 该行最后修改时间（增量同步必需） */
  updatedAt: Date;
}

export interface IntermediateDiagnosisRow {
  rowId: string;
  hospitalPatientId: string;
  /** ICD-10 编码 */
  icdCode: string;
  /** ICD-10 名称 */
  icdName?: string;
  /** 诊断时间 */
  diagnosisDate?: string;
  /** 风险等级（医院给的，可选） */
  riskLevelText?: string;
  /** 并发症描述 */
  complications?: string;
  /** 合并症描述 */
  comorbidities?: string;
  updatedAt: Date;
}

export interface IntermediateLabRow {
  rowId: string;
  hospitalPatientId: string;
  /** 检验项目编码（LOINC 或 院内自定编码） */
  itemCode: string;
  /** 检验项目名称 */
  itemName: string;
  /** 数值结果（医院字段一般是字符串，由适配器层转 number） */
  value: number;
  unit: string;
  /** 参考范围 "70-110" 等，可选 */
  referenceRange?: string;
  /** 异常标志：H / L / N / HH / LL，可选 */
  abnormalFlag?: string;
  /** 报告时间 */
  reportedAt: string;
  updatedAt: Date;
}

export interface IntermediatePrescriptionRow {
  rowId: string;
  hospitalPatientId: string;
  /** 药品名称 */
  drugName: string;
  /** 剂量字符串，例如 "5mg" / "10ml" */
  dosage?: string;
  /** 频次字符串，例如 "qd" / "bid" / "每日 3 次" */
  frequency?: string;
  /** 用药说明 */
  instructions?: string;
  /** 用药起始日期 */
  startDate?: string;
  /** 用药终止日期 */
  endDate?: string;
  updatedAt: Date;
}

export interface IntermediateDischargeRow {
  rowId: string;
  hospitalPatientId: string;
  /** 入院日期 */
  admissionDate?: string;
  /** 出院日期 */
  dischargeDate: string;
  /** 出院科室 */
  department?: string;
  /** 出院主诊断描述 */
  diagnosisText?: string;
  /** 出院主诊断 ICD-10 */
  diagnosisIcd?: string;
  /** 出院小结摘要（如有） */
  summary?: string;
  updatedAt: Date;
}

/**
 * 中间表适配器统一接口。
 *
 * 所有方法都接收 `since: Date`，返回自该时间点（不含）以来更新过的行。
 * Poller 在每次轮询后会把 since 推进到 max(updatedAt)，避免重复处理。
 */
export interface IntermediateDbAdapter {
  /** 适配器名称，用于审计日志 */
  readonly name: string;

  /** 启动连接（可选实现，启动失败 Poller 会自动退避重试） */
  connect?(): Promise<void>;

  /** 释放连接 */
  disconnect?(): Promise<void>;

  fetchPatientsModifiedAfter(since: Date): Promise<IntermediatePatientRow[]>;
  fetchDiagnosesModifiedAfter(since: Date): Promise<IntermediateDiagnosisRow[]>;
  fetchLabResultsAfter(since: Date): Promise<IntermediateLabRow[]>;
  fetchPrescriptionsAfter(since: Date): Promise<IntermediatePrescriptionRow[]>;
  fetchDischargesAfter(since: Date): Promise<IntermediateDischargeRow[]>;
}

/** NestJS DI token */
export const INTERMEDIATE_DB_ADAPTER = Symbol('INTERMEDIATE_DB_ADAPTER');
