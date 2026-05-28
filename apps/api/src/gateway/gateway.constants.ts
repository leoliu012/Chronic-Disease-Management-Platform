/**
 * gateway.constants.ts
 *
 * 标准化数据接入网关 — 常量与字典
 *
 * 这个文件集中维护：
 *   1. 网关支持的接入通道 (Channel) 标识
 *   2. 内部规范化事件 (NormalizedEvent) 的资源类型枚举
 *   3. HL7 v2 触发事件 → 内部资源类型 的映射表
 *   4. FHIR R4 ResourceType → 内部资源类型 的映射表
 *   5. ICD-10 → 我们 Prisma 中的 DiseaseType 简易映射（仅常见慢病）
 *
 * 所有外部规范（HL7 v2、FHIR R4、国内中间表）在进入业务逻辑之前
 * 都要先归一化成下面这些常量，避免后端各处散落"是不是 ADT^A03"之类的判断。
 */

import { DiseaseType } from '@prisma/client';

/**
 * 网关接入通道：所有 NormalizedEvent 都会标记自己来自哪个通道。
 * 这个字段会写入 IntegrationSyncBatch.batchType，方便审计。
 */
export const GATEWAY_CHANNEL = {
  /** HTTP 推送 — FHIR R4 资源（最现代） */
  FHIR_REST: 'GATEWAY_FHIR_REST',
  /** HTTP 推送 — 简化的 HIS 业务事件 JSON（出院 / 处方 / 检验 / 体征） */
  HIS_EVENT_REST: 'GATEWAY_HIS_EVENT_REST',
  /** HL7 v2 over MLLP TCP — 三甲医院集成平台常用 */
  HL7_MLLP: 'GATEWAY_HL7_MLLP',
  /** 中间表 / 视图 — 定时拉取 SQL Server / Oracle 前置机 */
  INTERMEDIATE_DB: 'GATEWAY_INTERMEDIATE_DB',
} as const;
export type GatewayChannel = (typeof GATEWAY_CHANNEL)[keyof typeof GATEWAY_CHANNEL];

/**
 * 网关在 IntegrationSource 表中对应的 source code。
 * 模块启动时 GatewaySourceRegistry 会 upsert 这几条记录，
 * 这样 IntegrationCenter 页面立刻能看到网关流水。
 */
export const GATEWAY_SOURCE_CODE = {
  FHIR_REST: 'GATEWAY_FHIR_REST',
  HIS_EVENT_REST: 'GATEWAY_HIS_EVENT_REST',
  HL7_MLLP: 'GATEWAY_HL7_MLLP',
  INTERMEDIATE_DB: 'GATEWAY_INTERMEDIATE_DB',
} as const;

/**
 * 内部规范化资源类型 — 所有通道进来的数据都归一化到这几种。
 * 这里故意没用 Prisma 表名，因为同一类型可能落到多张表
 * （例如 OBSERVATION 既可能是体征也可能是检验结果，由下游 promoter 决定）。
 */
export const GATEWAY_RESOURCE = {
  PATIENT: 'PATIENT',
  DIAGNOSIS: 'DIAGNOSIS',
  OBSERVATION: 'OBSERVATION', // 体征 / 检验值
  MEDICATION: 'MEDICATION',
  ENCOUNTER: 'ENCOUNTER',     // 门急诊 / 住院记录
  DISCHARGE: 'DISCHARGE',     // 出院专用（含出院诊断 + 出院小结提示）
  DOCUMENT: 'DOCUMENT',       // 病历文档摘要
  EXAM_REPORT: 'EXAM_REPORT', // 检查报告（影像 / 心电 / 病理 / 内镜 等，不走 LIS 的非数值结果）
} as const;
export type GatewayResourceType = (typeof GATEWAY_RESOURCE)[keyof typeof GATEWAY_RESOURCE];

/**
 * HL7 v2 触发事件 → 内部资源类型
 * （只覆盖慢病管理高频用到的几个，其他类型在 hl7-listener 里会被 ACK 但忽略）
 */
export const HL7_TRIGGER_TO_RESOURCE: Record<string, GatewayResourceType> = {
  // ADT (Admission Discharge Transfer)
  'ADT^A01': GATEWAY_RESOURCE.ENCOUNTER,  // Admit
  'ADT^A03': GATEWAY_RESOURCE.DISCHARGE,  // Discharge
  'ADT^A04': GATEWAY_RESOURCE.ENCOUNTER,  // Register outpatient
  'ADT^A08': GATEWAY_RESOURCE.PATIENT,    // Update patient info
  'ADT^A11': GATEWAY_RESOURCE.ENCOUNTER,  // Cancel admit (相当于撤销 encounter)
  'ADT^A28': GATEWAY_RESOURCE.PATIENT,    // Add person info
  'ADT^A31': GATEWAY_RESOURCE.PATIENT,    // Update person info

  // ORM (Order)
  'ORM^O01': GATEWAY_RESOURCE.MEDICATION, // 主要用于处方下达

  // ORU (Observation Result)
  'ORU^R01': GATEWAY_RESOURCE.OBSERVATION, // 检验/体征结果

  // MDM (Medical Document Management)
  'MDM^T02': GATEWAY_RESOURCE.DOCUMENT,   // 病历文档通知
};

/**
 * FHIR R4 ResourceType → 内部资源类型
 */
export const FHIR_RESOURCE_TO_INTERNAL: Record<string, GatewayResourceType> = {
  Patient: GATEWAY_RESOURCE.PATIENT,
  Condition: GATEWAY_RESOURCE.DIAGNOSIS,
  Observation: GATEWAY_RESOURCE.OBSERVATION,
  MedicationRequest: GATEWAY_RESOURCE.MEDICATION,
  MedicationStatement: GATEWAY_RESOURCE.MEDICATION,
  Encounter: GATEWAY_RESOURCE.ENCOUNTER,
  DocumentReference: GATEWAY_RESOURCE.DOCUMENT,
  Composition: GATEWAY_RESOURCE.DOCUMENT,
  // 影像 / 心电 / 病理 报告：FHIR R4 用 DiagnosticReport 表达非数值检查结果。
  DiagnosticReport: GATEWAY_RESOURCE.EXAM_REPORT,
};

/**
 * ICD-10 编码段 → DiseaseType（粗映射，覆盖产品当前支持的几个慢病）
 * 真实上线时建议由临床配置中心维护这张表，这里只是默认值。
 */
export function mapIcd10ToDiseaseType(code: string | undefined | null): DiseaseType {
  if (!code) return DiseaseType.OTHER;
  const upper = code.toUpperCase().replace(/\s+/g, '');
  if (upper.startsWith('I10') || upper.startsWith('I11') || upper.startsWith('I12') || upper.startsWith('I13') || upper.startsWith('I15')) {
    return DiseaseType.HYPERTENSION;
  }
  if (upper.startsWith('E11')) return DiseaseType.TYPE_2_DIABETES;
  if (upper.startsWith('J44')) return DiseaseType.COPD;
  if (upper.startsWith('I20') || upper.startsWith('I21') || upper.startsWith('I24') || upper.startsWith('I25')) {
    return DiseaseType.CORONARY_HEART_DISEASE;
  }
  if (upper.startsWith('E78')) return DiseaseType.HYPERLIPIDEMIA;
  if (upper.startsWith('E66')) return DiseaseType.OBESITY;
  return DiseaseType.OTHER;
}

/**
 * MLLP 帧分隔符（HL7 v2 传输层）
 *   <SB>  Start Block  = 0x0B
 *   <EB>  End Block    = 0x1C
 *   <CR>  Carriage Ret = 0x0D
 *
 * MLLP 帧格式： <SB> message <EB> <CR>
 */
export const MLLP = {
  SB: 0x0b,
  EB: 0x1c,
  CR: 0x0d,
} as const;

/** 默认 MLLP 端口（HL7 v2 在国内集成平台几乎都用 2575） */
export const DEFAULT_HL7_MLLP_PORT = 2575;


