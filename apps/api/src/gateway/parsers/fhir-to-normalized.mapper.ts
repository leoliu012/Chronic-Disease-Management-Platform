/**
 * fhir-to-normalized.mapper.ts
 *
 * FHIR R4 资源 → NormalizedEvent 转换。
 *
 * 当前支持：
 *   Patient            → PATIENT
 *   Condition          → DIAGNOSIS
 *   Observation        → OBSERVATION
 *   MedicationRequest  → MEDICATION
 *   MedicationStatement→ MEDICATION
 *   Encounter          → ENCOUNTER
 *   DocumentReference  → DOCUMENT
 *   Composition        → DOCUMENT
 *   Bundle (transaction/batch) → 拆开每个 entry 分别映射
 *
 * 取值策略：用安全访问而不是 schema 校验，未知字段忽略；
 * 找不到关键字段时返回 null，由上层决定是 reject 还是 staged-as-warning。
 */

import {
  FHIR_RESOURCE_TO_INTERNAL,
  GATEWAY_CHANNEL,
  GATEWAY_RESOURCE,
  GatewayResourceType,
  mapIcd10ToDiseaseType,
} from '../gateway.constants';
import { NormalizedEvent, PatientIdentifier } from '../interfaces/normalized-event.interface';

type FhirResource = Record<string, unknown> & { resourceType?: string; id?: string };

export interface MapResult {
  ok: boolean;
  events: NormalizedEvent[];
  errors: string[];
}

export function fhirToNormalizedEvents(resource: FhirResource): MapResult {
  const errors: string[] = [];
  if (!resource || typeof resource !== 'object' || !resource.resourceType) {
    errors.push('Missing resourceType');
    return { ok: false, events: [], errors };
  }

  // Bundle: 递归处理每个 entry
  if (resource.resourceType === 'Bundle') {
    const events: NormalizedEvent[] = [];
    const entries = (resource as Record<string, unknown>).entry;
    if (!Array.isArray(entries)) {
      return { ok: true, events, errors };
    }
    for (const entry of entries) {
      const inner = (entry as { resource?: FhirResource } | null)?.resource;
      if (!inner) continue;
      const sub = fhirToNormalizedEvents(inner);
      events.push(...sub.events);
      errors.push(...sub.errors);
    }
    return { ok: errors.length === 0, events, errors };
  }

  const resourceType = resource.resourceType;
  const internalType = FHIR_RESOURCE_TO_INTERNAL[resourceType];
  if (!internalType) {
    errors.push(`Unsupported FHIR resourceType: ${resourceType}`);
    return { ok: false, events: [], errors };
  }

  const patient = extractPatientIdentifier(resource, internalType);
  const eventId = stableEventId(resource);

  const event: NormalizedEvent = {
    eventId,
    channel: GATEWAY_CHANNEL.FHIR_REST,
    resourceType: internalType,
    receivedAt: new Date(),
    triggerEvent: `FHIR.${resourceType}`,
    patient,
    rawPayload: resource,
    normalizedPayload: extractPayload(resource, internalType),
  };

  return { ok: true, events: [event], errors };
}

/* -------------------------------------------------------------------------- */

function stableEventId(resource: FhirResource): string {
  const id = (resource.id as string | undefined) ?? '';
  const meta = (resource.meta as { lastUpdated?: string; versionId?: string } | undefined) ?? {};
  const stamp = meta.versionId ?? meta.lastUpdated ?? '';
  return `${resource.resourceType}:${id || 'no-id'}:${stamp || 'no-meta'}`;
}

function extractPatientIdentifier(
  resource: FhirResource,
  internalType: GatewayResourceType,
): PatientIdentifier {
  if (internalType === GATEWAY_RESOURCE.PATIENT) {
    return {
      externalPatientId: resource.id as string | undefined,
      hospitalPatientId: findIdentifierBySystem(
        resource.identifier as Array<Record<string, unknown>> | undefined,
        ['hospital', 'mrn', 'urn:oid:1.2.156', 'urn:patientid'],
      ),
      idCardNo: findIdentifierBySystem(
        resource.identifier as Array<Record<string, unknown>> | undefined,
        ['idcard', 'idnumber', 'urn:oid:2.16.156'],
      ),
      phone: findTelecomValue(resource.telecom as Array<Record<string, unknown>> | undefined, 'phone'),
    };
  }

  // 其他资源类型 — 通过 subject.reference 指回 Patient
  const subject = (resource.subject as { reference?: string } | undefined) ?? {};
  const reference = subject.reference ?? '';
  // 形如 "Patient/MZ20260519011" → 取后半段
  const externalPatientId = reference.split('/').pop() || undefined;
  return { externalPatientId, hospitalPatientId: externalPatientId };
}

function findIdentifierBySystem(
  identifiers: Array<Record<string, unknown>> | undefined,
  systemHints: string[],
): string | undefined {
  if (!Array.isArray(identifiers)) return undefined;
  for (const id of identifiers) {
    const system = String((id.system ?? '') as string).toLowerCase();
    if (systemHints.some((hint) => system.includes(hint))) {
      const value = id.value as string | undefined;
      if (value) return value;
    }
  }
  // 取第一个有 value 的作为兜底
  for (const id of identifiers) {
    const value = id.value as string | undefined;
    if (value) return value;
  }
  return undefined;
}

function findTelecomValue(
  telecom: Array<Record<string, unknown>> | undefined,
  system: 'phone' | 'email',
): string | undefined {
  if (!Array.isArray(telecom)) return undefined;
  for (const item of telecom) {
    if (item.system === system && typeof item.value === 'string') {
      return item.value;
    }
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/*  各资源类型的字段提取                                                       */
/* -------------------------------------------------------------------------- */

function extractPayload(
  resource: FhirResource,
  internalType: GatewayResourceType,
): Record<string, unknown> {
  switch (internalType) {
    case GATEWAY_RESOURCE.PATIENT:
      return extractPatientPayload(resource);
    case GATEWAY_RESOURCE.DIAGNOSIS:
      return extractConditionPayload(resource);
    case GATEWAY_RESOURCE.OBSERVATION:
      return extractObservationPayload(resource);
    case GATEWAY_RESOURCE.MEDICATION:
      return extractMedicationPayload(resource);
    case GATEWAY_RESOURCE.ENCOUNTER:
      return extractEncounterPayload(resource);
    case GATEWAY_RESOURCE.DOCUMENT:
      return extractDocumentPayload(resource);
    case GATEWAY_RESOURCE.EXAM_REPORT:
      // FHIR DiagnosticReport — 影像 / 心电 / 病理 / 内镜 / 肺功能 等非数值检查报告
      return extractDiagnosticReportPayload(resource);
    default:
      return {};
  }
}

function extractPatientPayload(r: FhirResource): Record<string, unknown> {
  const names = r.name as Array<Record<string, unknown>> | undefined;
  let displayName: string | undefined;
  if (Array.isArray(names) && names.length > 0) {
    const first = names[0];
    const family = (first.family as string) ?? '';
    const given = Array.isArray(first.given) ? (first.given as string[]).join('') : '';
    displayName = `${family}${given}`.trim() || (first.text as string) || undefined;
  }

  return {
    name: displayName,
    gender: normalizeFhirGender(r.gender as string | undefined),
    birthDate: r.birthDate as string | undefined,
    address: extractAddressText(r.address as Array<Record<string, unknown>> | undefined),
  };
}

function extractConditionPayload(r: FhirResource): Record<string, unknown> {
  const code = r.code as { coding?: Array<Record<string, unknown>>; text?: string } | undefined;
  const coding = Array.isArray(code?.coding) ? code!.coding![0] : undefined;
  const icd = (coding?.code as string) ?? '';
  const display = (coding?.display as string) ?? (code?.text as string) ?? '';
  const onset = (r.onsetDateTime as string) ?? undefined;
  const recordedDate = (r.recordedDate as string) ?? undefined;

  return {
    icdCode: icd,
    icdName: display,
    diagnosisDate: onset ?? recordedDate,
    inferredDiseaseType: mapIcd10ToDiseaseType(icd),
    clinicalStatus: extractCodeableConcept(r.clinicalStatus as Record<string, unknown> | undefined),
  };
}

function extractObservationPayload(r: FhirResource): Record<string, unknown> {
  const code = r.code as { coding?: Array<Record<string, unknown>>; text?: string } | undefined;
  const coding = Array.isArray(code?.coding) ? code!.coding![0] : undefined;
  const itemCode = (coding?.code as string) ?? '';
  const itemName = (coding?.display as string) ?? (code?.text as string) ?? '';

  const vq = r.valueQuantity as Record<string, unknown> | undefined;
  const numericValue = vq && typeof vq.value === 'number' ? vq.value : undefined;
  const unit = vq && typeof vq.unit === 'string' ? vq.unit : undefined;

  const effectiveDateTime =
    (r.effectiveDateTime as string) ||
    ((r.effectivePeriod as { start?: string } | undefined)?.start) ||
    undefined;

  const category = r.category as Array<{ coding?: Array<{ code?: string }> }> | undefined;
  const categoryCode = Array.isArray(category) && category[0]?.coding?.[0]?.code;

  return {
    itemCode,
    itemName,
    value: numericValue,
    unit,
    measuredAt: effectiveDateTime,
    /** "vital-signs" | "laboratory" | ... — 用于下游决定写 VitalRecord 还是 ExamReport */
    category: categoryCode,
    interpretation: extractInterpretation(r.interpretation as Array<Record<string, unknown>> | undefined),
  };
}

function extractMedicationPayload(r: FhirResource): Record<string, unknown> {
  const med =
    (r.medicationCodeableConcept as { text?: string; coding?: Array<Record<string, unknown>> } | undefined) ??
    (r.medication as { text?: string; coding?: Array<Record<string, unknown>> } | undefined);

  const drugName =
    (med?.text as string) ??
    ((med?.coding?.[0]?.display as string) ?? '');
  const drugCode = (med?.coding?.[0]?.code as string) ?? undefined;

  const dosage = Array.isArray(r.dosageInstruction)
    ? (r.dosageInstruction as Array<{ text?: string }>)[0]?.text
    : undefined;

  const period = r.dispenseRequest as { validityPeriod?: { start?: string; end?: string } } | undefined;
  const startDate = period?.validityPeriod?.start;
  const endDate = period?.validityPeriod?.end;

  return {
    drugName,
    drugCode,
    instructions: dosage,
    startDate,
    endDate,
  };
}

function extractEncounterPayload(r: FhirResource): Record<string, unknown> {
  const cls = r.class as { code?: string; display?: string } | undefined;
  const period = r.period as { start?: string; end?: string } | undefined;
  return {
    encounterType: normalizeFhirEncounterClass(cls?.code),
    startedAt: period?.start,
    endedAt: period?.end,
    department: extractServiceProvider(r.serviceProvider as Record<string, unknown> | undefined),
    status: r.status as string | undefined,
  };
}

function extractDocumentPayload(r: FhirResource): Record<string, unknown> {
  return {
    documentType:
      extractCodeableConcept(r.type as Record<string, unknown> | undefined) ??
      (r.resourceType === 'Composition' ? 'Composition' : 'DocumentReference'),
    documentTitle: (r.title as string) ?? undefined,
    createdAt: (r.date as string) ?? undefined,
  };
}

/**
 * FHIR DiagnosticReport -> ExamReportRecord (EXAM_REPORT)
 *
 * 把影像 / 心电 / 病理 / 内镜 / 肺功能 等非数值检查报告抽成 IntegrationPromoteService
 * 已支持的 EXAM_REPORT 形状: { examType, examName, examTime, department, finding, conclusion, reportUrl }
 *
 * FHIR R4 字段对照:
 *   examType   <- category[0].coding[0].display | code | "RAD" / "CG" / "LAB" / ...
 *   examName   <- code.text | code.coding[0].display | code.coding[0].code
 *   examTime   <- effectiveDateTime | effectivePeriod.start | issued
 *   department <- performer[*].display (取第一个有值的)
 *   finding    <- presentedForm[0].title 或 result[*].display 拼接 (PDF 报告时为标题)
 *   conclusion <- conclusion (FHIR 标准字段, R4 字符串)
 *   reportUrl  <- presentedForm[0].url (PDF / DICOM 链接)
 */
function extractDiagnosticReportPayload(r: FhirResource): Record<string, unknown> {
  const code = r.code as { coding?: Array<Record<string, unknown>>; text?: string } | undefined;
  const examName =
    (code?.text as string) ??
    ((code?.coding?.[0]?.display as string) ?? (code?.coding?.[0]?.code as string) ?? '');

  const category = r.category as Array<{ coding?: Array<{ code?: string; display?: string }>; text?: string }> | undefined;
  let examType: string | undefined;
  if (Array.isArray(category) && category.length > 0) {
    const c = category[0];
    examType =
      (c.text as string | undefined) ??
      (c.coding?.[0]?.display as string | undefined) ??
      (c.coding?.[0]?.code as string | undefined);
  }
  if (!examType) examType = 'OTHER';

  const examTime =
    (r.effectiveDateTime as string) ||
    ((r.effectivePeriod as { start?: string } | undefined)?.start) ||
    (r.issued as string) ||
    undefined;

  // 多个 performer 取第一个 display 非空的
  let department: string | undefined;
  const performers = r.performer as Array<{ display?: string; reference?: string }> | undefined;
  if (Array.isArray(performers)) {
    for (const p of performers) {
      if (p?.display) { department = p.display; break; }
      if (p?.reference) { department = p.reference; break; }
    }
  }

  // presentedForm 是 Attachment[]; 第一个非空的拿来当报告链接 + 备用 finding 标题
  const presented = r.presentedForm as Array<{ url?: string; title?: string; contentType?: string }> | undefined;
  let reportUrl: string | undefined;
  let attachmentTitle: string | undefined;
  if (Array.isArray(presented)) {
    for (const a of presented) {
      if (!reportUrl && a?.url) reportUrl = a.url;
      if (!attachmentTitle && a?.title) attachmentTitle = a.title;
      if (reportUrl && attachmentTitle) break;
    }
  }

  // finding: R4 没有标准字符串字段, 我们尽量从 result[*].display 拼出来,
  // 否则退到 presentedForm[0].title.
  let finding: string | undefined;
  const resultRefs = r.result as Array<{ display?: string }> | undefined;
  if (Array.isArray(resultRefs)) {
    const labels = resultRefs
      .map((x) => x?.display)
      .filter((s): s is string => typeof s === 'string' && s.length > 0);
    if (labels.length > 0) finding = labels.join('; ');
  }
  if (!finding && attachmentTitle) finding = attachmentTitle;

  const conclusion = (r.conclusion as string | undefined) ?? undefined;

  return {
    examType,
    examName,
    examTime,
    department,
    finding,
    conclusion,
    reportUrl,
  };
}

/* -------------------------------------------------------------------------- */

function normalizeFhirGender(g: string | undefined): 'MALE' | 'FEMALE' | 'UNKNOWN' {
  if (!g) return 'UNKNOWN';
  const v = g.toLowerCase();
  if (v === 'male') return 'MALE';
  if (v === 'female') return 'FEMALE';
  return 'UNKNOWN';
}

function normalizeFhirEncounterClass(
  code: string | undefined,
): 'OUTPATIENT' | 'INPATIENT' | 'EMERGENCY' | 'CHECKUP' {
  if (!code) return 'OUTPATIENT';
  const v = code.toUpperCase();
  if (v === 'IMP' || v === 'INPATIENT') return 'INPATIENT';
  if (v === 'EMER' || v === 'EMERGENCY') return 'EMERGENCY';
  if (v === 'AMB' || v === 'OUTPATIENT') return 'OUTPATIENT';
  return 'OUTPATIENT';
}

function extractAddressText(addresses: Array<Record<string, unknown>> | undefined): string | undefined {
  if (!Array.isArray(addresses) || addresses.length === 0) return undefined;
  const a = addresses[0];
  if (typeof a.text === 'string') return a.text;
  const parts = [a.country, a.state, a.city, a.district, a.line]
    .flat()
    .filter((p) => typeof p === 'string' && p.length > 0);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function extractCodeableConcept(c: Record<string, unknown> | undefined): string | undefined {
  if (!c) return undefined;
  if (typeof c.text === 'string' && c.text) return c.text;
  const coding = c.coding as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(coding) && coding[0]) {
    return (coding[0].display as string) || (coding[0].code as string) || undefined;
  }
  return undefined;
}

function extractInterpretation(arr: Array<Record<string, unknown>> | undefined): string | undefined {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  return extractCodeableConcept(arr[0]);
}

function extractServiceProvider(sp: Record<string, unknown> | undefined): string | undefined {
  if (!sp) return undefined;
  return (sp.display as string) ?? (sp.reference as string) ?? undefined;
}


