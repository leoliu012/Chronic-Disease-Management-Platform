/**
 * hl7-to-normalized.mapper.ts
 *
 * 把解析后的 HL7 v2 报文翻译成网关内部统一的 NormalizedEvent。
 *
 * 当前覆盖的触发事件：
 *   ADT^A01 / A04 / A08 / A28 / A31  → PATIENT (患者基本信息变更/注册)
 *   ADT^A03                          → DISCHARGE (出院)
 *   ADT^A11                          → ENCOUNTER (撤销入院 — 标记为取消)
 *   ORM^O01                          → MEDICATION (处方下达)
 *   ORU^R01                          → OBSERVATION (检验结果，每条 OBX 拆成一个 NormalizedEvent)
 *   MDM^T02                          → DOCUMENT (病历文档通知)
 *
 * 对于不识别的触发事件，调用方应该 ACK^AR（reject）或直接忽略。
 */

import {
  GATEWAY_CHANNEL,
  GATEWAY_RESOURCE,
  HL7_TRIGGER_TO_RESOURCE,
  mapIcd10ToDiseaseType,
} from '../gateway.constants';
import { NormalizedEvent, PatientIdentifier } from '../interfaces/normalized-event.interface';
import {
  findAllSegments,
  findSegment,
  getField,
  Hl7Message,
  parseHl7Timestamp,
} from './hl7-message.parser';

/**
 * 主入口：一条 HL7 报文可能映射出 1 到 N 个 NormalizedEvent。
 *
 * 例如 ORU^R01 报文里包含多个 OBX 段（多个检验项），
 * 我们会拆成多个 OBSERVATION 事件，每个事件单独审计 + 单独写库。
 */
export function hl7ToNormalizedEvents(msg: Hl7Message): NormalizedEvent[] {
  const resourceType = HL7_TRIGGER_TO_RESOURCE[msg.triggerEvent];
  if (!resourceType) {
    return [];
  }

  const patient = extractPatientIdentifier(msg);

  // ORU^R01：每个 OBX 拆一个事件
  if (msg.triggerEvent === 'ORU^R01') {
    return extractObxObservations(msg, patient);
  }

  // ORM^O01：每个 RXE/RXO 拆一个事件
  if (msg.triggerEvent === 'ORM^O01') {
    return extractRxeMedications(msg, patient);
  }

  // 其他情况一条报文 → 一个事件
  const baseEvent: NormalizedEvent = {
    eventId: msg.messageControlId || `HL7-${Date.now()}`,
    channel: GATEWAY_CHANNEL.HL7_MLLP,
    resourceType,
    receivedAt: new Date(),
    triggerEvent: msg.triggerEvent,
    patient,
    rawPayload: msg.raw,
    normalizedPayload: {},
  };

  if (resourceType === GATEWAY_RESOURCE.PATIENT) {
    baseEvent.normalizedPayload = extractPatientPayload(msg);
  } else if (resourceType === GATEWAY_RESOURCE.DISCHARGE) {
    baseEvent.normalizedPayload = extractDischargePayload(msg);
  } else if (resourceType === GATEWAY_RESOURCE.ENCOUNTER) {
    baseEvent.normalizedPayload = extractEncounterPayload(msg);
  } else if (resourceType === GATEWAY_RESOURCE.DOCUMENT) {
    baseEvent.normalizedPayload = extractDocumentPayload(msg);
  }

  return [baseEvent];
}

/* -------------------------------------------------------------------------- */
/*  患者标识                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 从 PID 段提取患者标识符。
 *   PID-3 = 患者标识列表（PID-3.1 = ID, PID-3.4.1 = 分配机构）
 *   PID-5.1 = 姓
 *   PID-5.2 = 名
 *   PID-13.1 = 手机号（HL7 PID-13 是 patient home phone）
 *   PID-19 = 身份证号（部分实现）
 */
function extractPatientIdentifier(msg: Hl7Message): PatientIdentifier {
  const pid = findSegment(msg, 'PID');
  if (!pid) return {};

  return {
    hospitalPatientId: getField(pid, 3, 1, undefined, msg.encoding) ?? undefined,
    externalPatientId: getField(pid, 3, 1, undefined, msg.encoding) ?? undefined,
    phone: getField(pid, 13, 1, undefined, msg.encoding) ?? undefined,
    idCardNo: getField(pid, 19, undefined, undefined, msg.encoding) ?? undefined,
  };
}

/* -------------------------------------------------------------------------- */
/*  ADT 事件 → PATIENT / DISCHARGE / ENCOUNTER                                */
/* -------------------------------------------------------------------------- */

function extractPatientPayload(msg: Hl7Message): Record<string, unknown> {
  const pid = findSegment(msg, 'PID');
  const familyName = getField(pid, 5, 1, undefined, msg.encoding) ?? '';
  const givenName = getField(pid, 5, 2, undefined, msg.encoding) ?? '';
  const fullName = `${familyName}${givenName}`.trim();

  return {
    name: fullName || undefined,
    gender: normalizeHl7Gender(getField(pid, 8, undefined, undefined, msg.encoding)),
    birthDate: parseHl7Timestamp(getField(pid, 7, undefined, undefined, msg.encoding)),
    address: getField(pid, 11, 1, undefined, msg.encoding),
  };
}

function extractDischargePayload(msg: Hl7Message): Record<string, unknown> {
  const pv1 = findSegment(msg, 'PV1');
  const dg1 = findSegment(msg, 'DG1');

  return {
    admissionTime: parseHl7Timestamp(getField(pv1, 44, undefined, undefined, msg.encoding)),
    dischargeTime: parseHl7Timestamp(getField(pv1, 45, undefined, undefined, msg.encoding)),
    department: getField(pv1, 3, 1, undefined, msg.encoding), // 病区/科室
    diagnosisIcd: getField(dg1, 3, 1, undefined, msg.encoding),
    diagnosisText: getField(dg1, 4, undefined, undefined, msg.encoding),
    inferredDiseaseType: mapIcd10ToDiseaseType(
      getField(dg1, 3, 1, undefined, msg.encoding) ?? '',
    ),
  };
}

function extractEncounterPayload(msg: Hl7Message): Record<string, unknown> {
  const pv1 = findSegment(msg, 'PV1');
  const patientClass = getField(pv1, 2, undefined, undefined, msg.encoding); // I=Inpatient, O=Outpatient, E=Emergency

  return {
    encounterType: normalizeHl7PatientClass(patientClass),
    startedAt: parseHl7Timestamp(getField(pv1, 44, undefined, undefined, msg.encoding)),
    endedAt: parseHl7Timestamp(getField(pv1, 45, undefined, undefined, msg.encoding)),
    department: getField(pv1, 3, 1, undefined, msg.encoding),
    doctor: getField(pv1, 7, 2, undefined, msg.encoding), // PV1-7.2 = attending doctor family name
  };
}

function extractDocumentPayload(msg: Hl7Message): Record<string, unknown> {
  const txa = findSegment(msg, 'TXA'); // MDM 报文里文档元数据在 TXA
  return {
    documentType: getField(txa, 2, undefined, undefined, msg.encoding),
    documentTitle: getField(txa, 3, undefined, undefined, msg.encoding),
    createdAt: parseHl7Timestamp(getField(txa, 4, undefined, undefined, msg.encoding)),
  };
}

/* -------------------------------------------------------------------------- */
/*  ORU^R01 → OBSERVATION                                                     */
/* -------------------------------------------------------------------------- */

/**
 * OBX 段格式 (R01)：
 *   OBX-2 = Value Type (NM = numeric, ST = string, CE = coded, ...)
 *   OBX-3 = Observation Identifier (代码^名称^编码系统)
 *   OBX-5 = Observation Value
 *   OBX-6 = Units
 *   OBX-7 = Reference Range
 *   OBX-8 = Abnormal Flags (H/L/N/HH/LL/A)
 *   OBX-14 = Observation Date/Time
 */
function extractObxObservations(msg: Hl7Message, patient: PatientIdentifier): NormalizedEvent[] {
  const obxList = findAllSegments(msg, 'OBX');
  return obxList.map((obx, index) => {
    const valueType = getField(obx, 2, undefined, undefined, msg.encoding);
    const code = getField(obx, 3, 1, undefined, msg.encoding) ?? '';
    const codeName = getField(obx, 3, 2, undefined, msg.encoding) ?? '';
    const rawValue = getField(obx, 5, undefined, undefined, msg.encoding) ?? '';
    const unit = getField(obx, 6, 1, undefined, msg.encoding);
    const referenceRange = getField(obx, 7, undefined, undefined, msg.encoding);
    const abnormalFlag = getField(obx, 8, undefined, undefined, msg.encoding);
    const measuredAt =
      parseHl7Timestamp(getField(obx, 14, undefined, undefined, msg.encoding)) ??
      new Date().toISOString();

    let numericValue: number | undefined;
    if (valueType === 'NM' || /^-?\d+(\.\d+)?$/.test(rawValue)) {
      const n = Number(rawValue);
      if (!Number.isNaN(n)) numericValue = n;
    }

    return {
      eventId: `${msg.messageControlId}:OBX:${index + 1}`,
      channel: GATEWAY_CHANNEL.HL7_MLLP,
      resourceType: GATEWAY_RESOURCE.OBSERVATION,
      receivedAt: new Date(),
      triggerEvent: msg.triggerEvent,
      patient,
      rawPayload: obx.fields.join('|'),
      normalizedPayload: {
        code,
        codeName,
        rawValue,
        value: numericValue,
        unit,
        referenceRange,
        abnormalFlag,
        measuredAt,
      },
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  ORM^O01 → MEDICATION                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 处方下达：药品在 RXE / RXO 段。
 *   RXE-2.1 / RXO-1.1 = 药品代码
 *   RXE-2.2 / RXO-1.2 = 药品名称
 *   RXE-3   / RXO-2   = 单次剂量
 *   RXE-5.1 = 剂量单位
 *   RXE-7   = 用药说明 (provider's administration instructions)
 *   RXE-1   = quantity / timing — 也可以从 TQ1 段读频次
 */
function extractRxeMedications(msg: Hl7Message, patient: PatientIdentifier): NormalizedEvent[] {
  const rxes = findAllSegments(msg, 'RXE');
  const rxos = findAllSegments(msg, 'RXO');
  const drugSegments = rxes.length > 0 ? rxes : rxos;
  if (drugSegments.length === 0) return [];

  return drugSegments.map((seg, index) => {
    const drugCode = getField(seg, seg.type === 'RXE' ? 2 : 1, 1, undefined, msg.encoding);
    const drugName = getField(seg, seg.type === 'RXE' ? 2 : 1, 2, undefined, msg.encoding);
    const dose = getField(seg, seg.type === 'RXE' ? 3 : 2, undefined, undefined, msg.encoding);
    const doseUnit = getField(seg, seg.type === 'RXE' ? 5 : 4, 1, undefined, msg.encoding);
    const instructions = getField(seg, 7, undefined, undefined, msg.encoding);

    // TQ1 段（HL7 v2.5+）保存频次和起止
    const tq1 = findSegment(msg, 'TQ1');
    const frequency = getField(tq1, 6, 1, undefined, msg.encoding);
    const startDate = parseHl7Timestamp(getField(tq1, 7, undefined, undefined, msg.encoding));
    const endDate = parseHl7Timestamp(getField(tq1, 8, undefined, undefined, msg.encoding));

    return {
      eventId: `${msg.messageControlId}:RX:${index + 1}`,
      channel: GATEWAY_CHANNEL.HL7_MLLP,
      resourceType: GATEWAY_RESOURCE.MEDICATION,
      receivedAt: new Date(),
      triggerEvent: msg.triggerEvent,
      patient,
      rawPayload: seg.fields.join('|'),
      normalizedPayload: {
        drugCode,
        drugName,
        dosage: dose && doseUnit ? `${dose}${doseUnit}` : dose,
        frequency,
        instructions,
        startDate,
        endDate,
      },
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function normalizeHl7Gender(value: string | undefined): 'MALE' | 'FEMALE' | 'UNKNOWN' {
  if (!value) return 'UNKNOWN';
  const v = value.toUpperCase();
  if (v === 'M' || v === '1') return 'MALE';
  if (v === 'F' || v === '2') return 'FEMALE';
  return 'UNKNOWN';
}

function normalizeHl7PatientClass(
  value: string | undefined,
): 'INPATIENT' | 'OUTPATIENT' | 'EMERGENCY' | 'CHECKUP' {
  if (!value) return 'OUTPATIENT';
  const v = value.toUpperCase();
  if (v === 'I') return 'INPATIENT';
  if (v === 'E') return 'EMERGENCY';
  if (v === 'P' || v === 'C') return 'CHECKUP';
  return 'OUTPATIENT';
}
