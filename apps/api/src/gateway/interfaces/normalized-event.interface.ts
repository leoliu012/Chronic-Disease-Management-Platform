/**
 * normalized-event.interface.ts
 *
 * 网关内部的统一事件模型。
 *
 * 三种通道（FHIR REST / HL7 MLLP / 中间表 Cron）解析完外部数据后，
 * 都会构造一个 NormalizedEvent，然后交给 InboundEventService.ingest()
 * 写入审计表 (IntegrationSyncBatch / IntegrationSyncRecord)，
 * 后续如果开启 autoPromote，再分发到对应的业务表 (Patient / DiseaseProfile / VitalRecord / ...)。
 *
 * 设计原则：
 *   - eventId 必须稳定且可幂等（同一事件重复送达不应该产生两条记录）
 *   - rawPayload 永远保留原始外部数据（HL7 字符串 / FHIR JSON / SQL 行），便于回溯
 *   - normalizedPayload 是经过字段映射后的内部表示，便于下游消费
 */

import {
  GatewayChannel,
  GatewayResourceType,
} from '../gateway.constants';

/**
 * 患者标识符 — 真实生产中医院给我们的患者 ID 可能有好几种，
 * 这里全部并列保留，下游优先使用 hospitalPatientId，找不到再回退到身份证 / 手机号 / FHIR Patient.id。
 */
export interface PatientIdentifier {
  /** 院内号（最常用的稳定 ID） */
  hospitalPatientId?: string;
  /** 身份证号 */
  idCardNo?: string;
  /** 手机号 */
  phone?: string;
  /** FHIR Patient.id 或 HL7 PID-3.1 等外部系统的主键 */
  externalPatientId?: string;
}

/**
 * 内部规范化事件
 */
export interface NormalizedEvent {
  /**
   * 事件唯一 ID，用于幂等。
   * 推荐生成规则：
   *   FHIR REST       → `${resourceType}:${resource.id}:${meta.lastUpdated}`
   *   HIS_EVENT_REST  → 上游自带的 eventId / messageId
   *   HL7_MLLP        → MSH-10 (Message Control ID)
   *   INTERMEDIATE_DB → `${tableName}:${primaryKey}:${updatedAt}`
   */
  eventId: string;

  /** 接入通道 */
  channel: GatewayChannel;

  /** 资源类型（PATIENT / DIAGNOSIS / OBSERVATION / ...） */
  resourceType: GatewayResourceType;

  /** 接收到事件的时间（网关时间，不是医院时间） */
  receivedAt: Date;

  /** 患者标识符 */
  patient?: PatientIdentifier;

  /**
   * 规范化后的业务字段。
   * 不强类型，因为不同 resourceType 字段差异较大；下游 promoter 根据 resourceType
   * 自己做类型断言（例如 OBSERVATION 期望 { code, value, unit, measuredAt }）。
   */
  normalizedPayload: Record<string, unknown>;

  /** 原始数据，用于回溯排错 */
  rawPayload: unknown;

  /**
   * 可选：触发事件类型（HL7 的 MSH-9，例如 "ADT^A03"；FHIR 的 verb，例如 "create" / "update"）。
   * 仅用于审计可读性。
   */
  triggerEvent?: string;
}
