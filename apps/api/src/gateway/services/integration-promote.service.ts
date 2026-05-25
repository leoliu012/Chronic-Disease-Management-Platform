/**
 * integration-promote.service.ts
 *
 * 网关「审计 → 业务表」推进层（gateway-promote-pipeline）。
 *
 * 上一阶段：InboundEventService 把 FHIR / HIS Event / HL7 / 中间表四个通道的
 * 标准化事件统一落到 IntegrationSyncRecord（审计层）。
 *
 * 这一阶段：把 IntegrationSyncRecord.normalizedData 解开，按 resourceType
 * 映射到正式业务表：
 *
 *   PATIENT      → Patient                (upsert by hospitalPatientId)
 *   DIAGNOSIS    → DiseaseProfile         (upsert by (patientId, diseaseType))
 *   OBSERVATION  → VitalRecord            (走 VitalRecordsService，复用规则引擎)
 *                                          → 异常时由规则引擎自动产出 RiskAlert + Task
 *   MEDICATION   → HospitalMedicationOrder (院端医嘱视角；患者端 MedicationRecord
 *                                          仍由护士工作台单独维护，避免覆盖患者打卡)
 *   ENCOUNTER    → EncounterRecord
 *   DISCHARGE    → EncounterRecord + MedicalRecordSummary (DISCHARGE_SUMMARY)
 *   DOCUMENT     → MedicalRecordSummary
 *
 * 设计要点：
 *
 *   - 幂等：promote 成功之后回写 localTargetType / localTargetId / promotionStatus = PROMOTED，
 *     重复调用直接 short-circuit 返回 ALREADY_PROMOTED，不会重复入库。
 *
 *   - 冲突进队列，不落主表：
 *       * 患者尚未在本院登记                 → PATIENT_NOT_FOUND
 *       * 同院内号但姓名/身份证与本地不一致 → PATIENT_IDENTITY_MISMATCH
 *       * 目标记录已存在但来源不同         → DUPLICATE_PROMOTION_TARGET
 *       * 关键字段缺失                       → MISSING_REQUIRED_FIELDS
 *     冲突态保留 normalizedData 原文，护士 / 管理员在【接口中心 · 冲突】tab 里
 *     可以选择「强制覆盖」(forceOverwrite=true) 或 「拒绝并标记 FAILED」。
 *
 *   - 不直接耦合临床规则引擎：OBSERVATION 走 VitalRecordsService.create，
 *     这是护士在工作台手工录入体征时同一条代码路径，保证规则引擎、RiskAlert、
 *     Task、监测计划检查都被复用。
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DataSource,
  DiseaseType,
  Gender,
  IntegrationPromotionStatus,
  IntegrationSyncRecord,
  MedicalRecordType,
  Patient,
  Prisma,
  RiskLevel,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { VitalRecordsService } from '../../vital-records/vital-records.service';
import {
  GATEWAY_RESOURCE,
  GatewayResourceType,
  mapIcd10ToDiseaseType,
} from '../gateway.constants';
import { PatientIdentifier } from '../interfaces/normalized-event.interface';
import {
  PromotionConflictError,
  PromotionUnsupportedError,
} from './promotion-errors';

export type PromoteOutcome =
  | 'PROMOTED'
  | 'ALREADY_PROMOTED'
  | 'CONFLICT'
  | 'FAILED'
  | 'SKIPPED';

export interface PromoteResult {
  recordId: string;
  outcome: PromoteOutcome;
  localTargetType?: string;
  localTargetId?: string;
  message?: string;
  generatedRiskAlertId?: string;
  generatedTaskId?: string;
}

export interface PromoteBatchResult {
  total: number;
  promoted: number;
  alreadyPromoted: number;
  conflicts: number;
  failed: number;
  skipped: number;
  records: PromoteResult[];
}

/* ---------------------------------------------------------------------------
 *  conflict-resolution-ux-v1 — 给前端用的结构化冲突详情
 * ------------------------------------------------------------------------ */

export type ConflictReason =
  | 'PATIENT_NOT_FOUND'
  | 'PATIENT_IDENTITY_MISMATCH'
  | 'DUPLICATE_PROMOTION_TARGET'
  | 'MISSING_REQUIRED_FIELDS'
  | 'REJECTED_BY_OPERATOR'
  | 'UNKNOWN';

export const CONFLICT_REASON_LABELS: Record<ConflictReason, string> = {
  PATIENT_NOT_FOUND: '本地未找到对应患者',
  PATIENT_IDENTITY_MISMATCH: '院内号已存在但身份信息不一致',
  DUPLICATE_PROMOTION_TARGET: '同源记录已落入主数据',
  MISSING_REQUIRED_FIELDS: '上游缺少必填字段',
  REJECTED_BY_OPERATOR: '已由操作人驳回',
  UNKNOWN: '未知冲突类型',
};

export interface ConflictFieldDiff {
  /** 中文字段标签（UI 上直接显示） */
  label: string;
  /** 内部字段名 */
  field: string;
  /** 本地值（脱敏后） */
  local?: string;
  /** 上游值（脱敏后） */
  upstream?: string;
  /** 两个值是否不一致；UI 用它高亮 */
  changed: boolean;
}

export interface ConflictDetail {
  recordId: string;
  promotionStatus: IntegrationPromotionStatus;
  reason: ConflictReason;
  reasonLabel: string;
  resourceType: string;
  sourceName: string;
  sourceCode: string;
  externalRecordId: string;
  receivedAt: string;
  /** promotionMessage 去掉 [REASON] 前缀后的人类可读说明 */
  promotionMessage: string;
  localPatient?: {
    id: string;
    name: string;
    hospitalPatientId: string | null;
  };
  upstreamIdentifier: {
    hospitalPatientId?: string;
    idCardNo?: string;
    phone?: string;
    externalPatientId?: string;
  };
  fieldDiffs: ConflictFieldDiff[];
  rawPayloadPreview?: string;
}

interface PromoteOptions {
  /** 强制覆盖 — 用于人工核验后接受冲突 */
  forceOverwrite?: boolean;
  operatorId?: string;
}

/**
 * 内部 dispatch 返回的“成功 promote 出来的本地对象”。
 */
interface DispatchSuccess {
  localTargetType: string;
  localTargetId: string;
  message?: string;
  generatedRiskAlertId?: string;
  generatedTaskId?: string;
}

@Injectable()
export class IntegrationPromoteService {
  private readonly logger = new Logger('IntegrationPromote');

  constructor(
    private readonly prisma: PrismaService,
    private readonly vitalRecordsService: VitalRecordsService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /*  公共入口                                                                  */
  /* ------------------------------------------------------------------------ */

  /**
   * 单条 promote。
   * 调用方：
   *   1) 管理员在【接口中心】点「入库」按钮 → GatewayPromoteController.promoteOne
   *   2) 批量 promote 内部 loop
   *   3) InboundEventService.ingest*() 在 source.autoPromote = true 时同步调用
   */
  async promoteRecord(
    recordId: string,
    options: PromoteOptions = {},
  ): Promise<PromoteResult> {
    const record = await this.prisma.integrationSyncRecord.findUnique({
      where: { id: recordId },
    });
    if (!record) throw new NotFoundException(`Sync record ${recordId} not found`);

    // 幂等：已经 promote 过的不要再动主数据
    if (
      record.promotionStatus === IntegrationPromotionStatus.PROMOTED &&
      record.localTargetId
    ) {
      return {
        recordId,
        outcome: 'ALREADY_PROMOTED',
        localTargetType: record.localTargetType ?? undefined,
        localTargetId: record.localTargetId ?? undefined,
        message: '记录已在主数据中，跳过。',
      };
    }

    // 重复审计（SKIPPED）不属于推进流，原样保留
    if (record.status === 'SKIPPED') {
      await this.markStatus(recordId, IntegrationPromotionStatus.NOT_REQUIRED, '审计层标记为重复事件，不推进入库。');
      return { recordId, outcome: 'SKIPPED', message: '审计层标记为重复事件，不推进入库。' };
    }

    try {
      const dispatched = await this.dispatch(record, options);
      await this.prisma.integrationSyncRecord.update({
        where: { id: recordId },
        data: {
          localTargetType: dispatched.localTargetType,
          localTargetId: dispatched.localTargetId,
          promotionStatus: IntegrationPromotionStatus.PROMOTED,
          promotionMessage: dispatched.message ?? null,
          promotedAt: new Date(),
        },
      });
      this.logger.log(
        `Promoted record ${recordId} (${record.externalRecordType}) → ${dispatched.localTargetType}/${dispatched.localTargetId}`,
      );
      return {
        recordId,
        outcome: 'PROMOTED',
        localTargetType: dispatched.localTargetType,
        localTargetId: dispatched.localTargetId,
        message: dispatched.message,
        generatedRiskAlertId: dispatched.generatedRiskAlertId,
        generatedTaskId: dispatched.generatedTaskId,
      };
    } catch (err) {
      if (err instanceof PromotionConflictError) {
        const message = `[${err.reason}] ${err.message}`;
        await this.markStatus(recordId, IntegrationPromotionStatus.CONFLICT, message);
        this.logger.warn(`Promote conflict record ${recordId}: ${message}`);
        return { recordId, outcome: 'CONFLICT', message };
      }
      if (err instanceof PromotionUnsupportedError) {
        const message = err.message;
        await this.markStatus(recordId, IntegrationPromotionStatus.FAILED, message);
        return { recordId, outcome: 'FAILED', message };
      }
      const message = err instanceof Error ? err.message : String(err);
      await this.markStatus(recordId, IntegrationPromotionStatus.FAILED, message);
      this.logger.error(`Promote failed for record ${recordId}: ${message}`);
      return { recordId, outcome: 'FAILED', message };
    }
  }

  /**
   * 批量 promote — 用于管理员在【接口中心】点「一键安全入库」时。
   * 安全语义：默认 forceOverwrite=false，碰冲突自动 park 进 CONFLICT，
   * 不会把所有 batch 都 fail 掉。
   */
  async promoteBatch(
    recordIds: string[],
    options: PromoteOptions = {},
  ): Promise<PromoteBatchResult> {
    const records: PromoteResult[] = [];
    for (const id of recordIds) {
      records.push(await this.promoteRecord(id, options));
    }
    const counts = records.reduce(
      (acc, r) => {
        if (r.outcome === 'PROMOTED') acc.promoted += 1;
        else if (r.outcome === 'ALREADY_PROMOTED') acc.alreadyPromoted += 1;
        else if (r.outcome === 'CONFLICT') acc.conflicts += 1;
        else if (r.outcome === 'FAILED') acc.failed += 1;
        else acc.skipped += 1;
        return acc;
      },
      { promoted: 0, alreadyPromoted: 0, conflicts: 0, failed: 0, skipped: 0 },
    );
    return { total: records.length, ...counts, records };
  }

  /**
   * 取所有可推进的待入库记录（默认按 createdAt asc，先到先 promote）。
   * 用于「一键安全入库 PENDING 队列」。
   */
  async listPendingRecordIds(limit = 200, sourceId?: string): Promise<string[]> {
    const rows = await this.prisma.integrationSyncRecord.findMany({
      where: {
        promotionStatus: IntegrationPromotionStatus.PENDING,
        ...(sourceId ? { sourceId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /* ------------------------------------------------------------------------ */
  /*  conflict-resolution-ux-v1                                                 */
  /* ------------------------------------------------------------------------ */

  /**
   * 把一条 CONFLICT 记录的「冲突详情」组织成结构化对象，便于前端逐字段展示
   * 「本地是什么 / 上游是什么 / 哪一行不一致」。不再让人去人肉解析 promotionMessage。
   *
   * 不限定 promotionStatus 为 CONFLICT — 对 FAILED / PENDING 的记录也允许调用，
   * 但 fieldDiffs 可能为空（仅展示上游 payload）。
   */
  async describeConflict(recordId: string): Promise<ConflictDetail> {
    const record = await this.prisma.integrationSyncRecord.findUnique({
      where: { id: recordId },
      include: { source: true, batch: true },
    });
    if (!record) throw new NotFoundException(`Sync record ${recordId} not found`);

    const normalized = this.unwrapNormalized(record);
    const ident = normalized.patient ?? {};
    const payload = normalized.payload ?? {};
    const localPatient = await this.resolveLocalPatient(ident);

    // promotionMessage 形如 "[REASON] 人类可读说明"，把两段拆开。
    let reason: ConflictReason = 'UNKNOWN';
    let humanMessage = record.promotionMessage ?? '';
    if (record.promotionMessage) {
      const match = /^\[([A-Z_]+)\]\s*(.*)$/s.exec(record.promotionMessage);
      if (match) {
        reason = (CONFLICT_REASON_LABELS[match[1] as ConflictReason]
          ? (match[1] as ConflictReason)
          : 'UNKNOWN');
        humanMessage = match[2];
      }
    }

    const fieldDiffs = this.buildFieldDiffs(record, ident, payload, localPatient);

    return {
      recordId: record.id,
      promotionStatus: record.promotionStatus,
      reason,
      reasonLabel: CONFLICT_REASON_LABELS[reason] ?? '未知冲突',
      resourceType: record.externalRecordType,
      sourceName: record.source?.name ?? '未知来源',
      sourceCode: record.source?.code ?? '',
      externalRecordId: record.externalRecordId,
      receivedAt: record.createdAt.toISOString(),
      promotionMessage: humanMessage,
      localPatient: localPatient
        ? {
            id: localPatient.id,
            name: localPatient.name,
            hospitalPatientId: localPatient.hospitalPatientId,
          }
        : undefined,
      upstreamIdentifier: {
        hospitalPatientId: ident?.hospitalPatientId ?? undefined,
        idCardNo: ident?.idCardNo ? this.maskIdCard(ident.idCardNo) : undefined,
        phone: ident?.phone ? this.maskPhone(ident.phone) : undefined,
        externalPatientId: ident?.externalPatientId ?? undefined,
      },
      fieldDiffs,
      rawPayloadPreview: this.previewJson(payload),
    };
  }

  /**
   * 「保留本地、驳回上游变更」—— 把一条 CONFLICT 移到 FAILED，并把操作人和注释
   * 写到 promotionMessage 里供审计追踪。不动主数据，不重试。
   */
  async rejectConflict(
    recordId: string,
    options: { operatorId?: string; operatorName?: string; note?: string } = {},
  ): Promise<{ recordId: string; outcome: 'REJECTED'; message: string }> {
    const record = await this.prisma.integrationSyncRecord.findUnique({
      where: { id: recordId },
    });
    if (!record) throw new NotFoundException(`Sync record ${recordId} not found`);
    if (record.promotionStatus !== IntegrationPromotionStatus.CONFLICT) {
      throw new BadRequestException(
        `仅冲突队列内的记录可以驳回；当前 promotionStatus=${record.promotionStatus}。`,
      );
    }
    const operatorLabel = options.operatorName
      ? `${options.operatorName}${options.operatorId ? `（${options.operatorId.slice(0, 6)}…）` : ''}`
      : options.operatorId
        ? `操作人 ${options.operatorId.slice(0, 6)}…`
        : '操作人';
    const noteFragment = options.note ? `；备注：${options.note}` : '';
    const message = `[REJECTED_BY_OPERATOR] ${operatorLabel} 已驳回上游变更，保留本地数据${noteFragment}。`;

    await this.prisma.integrationSyncRecord.update({
      where: { id: recordId },
      data: {
        promotionStatus: IntegrationPromotionStatus.FAILED,
        promotionMessage: message,
      },
    });
    this.logger.log(`Conflict rejected for record ${recordId} by ${operatorLabel}`);
    return {
      recordId,
      outcome: 'REJECTED',
      message: '已保留本地数据，驳回上游变更。',
    };
  }

  /**
   * Build a field-by-field diff so the frontend doesn't have to parse strings.
   * Field set depends on resourceType — only the fields that participate in the
   * upstream payload are compared.
   */
  private buildFieldDiffs(
    record: IntegrationSyncRecord,
    ident: PatientIdentifier,
    payload: Record<string, unknown>,
    localPatient: Patient | null,
  ): ConflictFieldDiff[] {
    const diffs: ConflictFieldDiff[] = [];

    if (record.externalRecordType === GATEWAY_RESOURCE.PATIENT) {
      const upstreamGender = this.coerceGender(payload['gender']);
      const upstreamBirth = this.coerceDate(payload['birthDate']);
      diffs.push(
        this.diff(
          '院内号',
          'hospitalPatientId',
          localPatient?.hospitalPatientId,
          ident?.hospitalPatientId ?? (payload['hospitalPatientId'] as string | undefined),
        ),
        this.diff('姓名', 'name', localPatient?.name, payload['name'] as string | undefined),
        this.diff(
          '身份证号',
          'idCardNo',
          localPatient?.idCardNo ? this.maskIdCard(localPatient.idCardNo) : undefined,
          ident?.idCardNo ? this.maskIdCard(ident.idCardNo) : undefined,
        ),
        this.diff(
          '手机号',
          'phone',
          localPatient?.phone ? this.maskPhone(localPatient.phone) : undefined,
          ident?.phone ? this.maskPhone(ident.phone) : undefined,
        ),
        this.diff('性别', 'gender', localPatient?.gender, upstreamGender),
        this.diff(
          '出生日期',
          'birthDate',
          localPatient?.birthDate ? localPatient.birthDate.toISOString().slice(0, 10) : undefined,
          upstreamBirth ? upstreamBirth.toISOString().slice(0, 10) : undefined,
        ),
        this.diff('家庭住址', 'address', localPatient?.address, payload['address'] as string | undefined),
      );
    } else if (record.externalRecordType === GATEWAY_RESOURCE.DIAGNOSIS) {
      diffs.push(
        this.diff('本地患者', 'patient', localPatient?.name, ident?.hospitalPatientId),
        this.diff('ICD-10', 'icdCode', undefined, (payload['icdCode'] as string) ?? (payload['diagnosisIcd'] as string)),
        this.diff('诊断名称', 'diagnosisText', undefined, payload['diagnosisText'] as string),
        this.diff('诊断日期', 'diagnosisDate', undefined, payload['diagnosisDate'] as string),
      );
    } else if (record.externalRecordType === GATEWAY_RESOURCE.OBSERVATION) {
      diffs.push(
        this.diff('本地患者', 'patient', localPatient?.name, ident?.hospitalPatientId),
        this.diff('项目代码', 'itemCode', undefined, (payload['itemCode'] as string) ?? (payload['vitalType'] as string)),
        this.diff('项目名称', 'itemName', undefined, payload['itemName'] as string),
        this.diff(
          '数值',
          'value',
          undefined,
          payload['value'] !== undefined
            ? `${payload['value']}${(payload['unit'] as string) ?? ''}`
            : undefined,
        ),
        this.diff('参考区间', 'referenceRange', undefined, payload['referenceRange'] as string),
        this.diff('上游异常标记', 'abnormalFlag', undefined, payload['abnormalFlag'] as string),
        this.diff('检验时间', 'reportedAt', undefined, (payload['reportedAt'] as string) ?? (payload['measuredAt'] as string)),
      );
    } else if (record.externalRecordType === GATEWAY_RESOURCE.MEDICATION) {
      diffs.push(
        this.diff('本地患者', 'patient', localPatient?.name, ident?.hospitalPatientId),
        this.diff('药品', 'drugName', undefined, payload['drugName'] as string),
        this.diff('剂量', 'dosage', undefined, payload['dosage'] as string),
        this.diff('频次', 'frequency', undefined, payload['frequency'] as string),
        this.diff('起始日期', 'startDate', undefined, payload['startDate'] as string),
      );
    } else if (
      record.externalRecordType === GATEWAY_RESOURCE.ENCOUNTER ||
      record.externalRecordType === GATEWAY_RESOURCE.DISCHARGE
    ) {
      diffs.push(
        this.diff('本地患者', 'patient', localPatient?.name, ident?.hospitalPatientId),
        this.diff('就诊类型', 'encounterType', undefined, payload['encounterType'] as string),
        this.diff('科室', 'department', undefined, payload['department'] as string),
        this.diff('诊断', 'diagnosisText', undefined, payload['diagnosisText'] as string),
        this.diff(
          '时间',
          'visitTime',
          undefined,
          (payload['startedAt'] as string) ??
            (payload['dischargeTime'] as string) ??
            (payload['endedAt'] as string),
        ),
      );
    }

    // 只保留有内容的字段，免得在 UI 上拉一堆空行
    return diffs.filter((d) => d.local || d.upstream);
  }

  private diff(
    label: string,
    field: string,
    local: unknown,
    upstream: unknown,
  ): ConflictFieldDiff {
    const localStr = local === undefined || local === null ? undefined : String(local);
    const upstreamStr = upstream === undefined || upstream === null ? undefined : String(upstream);
    return {
      label,
      field,
      local: localStr,
      upstream: upstreamStr,
      changed: (localStr ?? '') !== (upstreamStr ?? ''),
    };
  }

  private previewJson(value: unknown, max = 1500): string | undefined {
    if (value === undefined || value === null) return undefined;
    try {
      const text = JSON.stringify(value, null, 2);
      if (text.length <= max) return text;
      return `${text.slice(0, max)}\n... (已截断)`;
    } catch {
      return undefined;
    }
  }

  /* ------------------------------------------------------------------------ */
  /*  内部 dispatch                                                            */
  /* ------------------------------------------------------------------------ */

  private async dispatch(
    record: IntegrationSyncRecord,
    options: PromoteOptions,
  ): Promise<DispatchSuccess> {
    const normalized = this.unwrapNormalized(record);
    const patientIdent = normalized.patient ?? {};
    const payload = normalized.payload ?? {};

    switch (record.externalRecordType as GatewayResourceType) {
      case GATEWAY_RESOURCE.PATIENT:
        return this.promotePatient(patientIdent, payload, options);
      case GATEWAY_RESOURCE.DIAGNOSIS:
        return this.promoteDiagnosis(patientIdent, payload, options);
      case GATEWAY_RESOURCE.OBSERVATION:
        return this.promoteObservation(patientIdent, payload, record, options);
      case GATEWAY_RESOURCE.MEDICATION:
        return this.promoteMedication(patientIdent, payload, record, options);
      case GATEWAY_RESOURCE.ENCOUNTER:
        return this.promoteEncounter(patientIdent, payload, record, options, false);
      case GATEWAY_RESOURCE.DISCHARGE:
        return this.promoteEncounter(patientIdent, payload, record, options, true);
      case GATEWAY_RESOURCE.DOCUMENT:
        return this.promoteDocument(patientIdent, payload, record, options);
      default:
        throw new PromotionUnsupportedError(record.externalRecordType);
    }
  }

  /**
   * normalizedData 由 InboundEventService 写入时形如：
   *   { channel, triggerEvent, patient, payload, receivedAt }
   * 旧的 IntegrationsService.mockSync* 写入时是直接的本地对象（没有外层包装），
   * 所以我们 tolerant 处理。
   */
  private unwrapNormalized(record: IntegrationSyncRecord): {
    patient?: PatientIdentifier;
    payload?: Record<string, unknown>;
    channel?: string;
    triggerEvent?: string;
  } {
    const raw = (record.normalizedData ?? {}) as Record<string, unknown>;
    if (raw && typeof raw === 'object' && 'payload' in raw) {
      return {
        patient: (raw['patient'] as PatientIdentifier) ?? {},
        payload: (raw['payload'] as Record<string, unknown>) ?? {},
        channel: (raw['channel'] as string) ?? undefined,
        triggerEvent: (raw['triggerEvent'] as string) ?? undefined,
      };
    }
    // 老格式：normalizedData 就是 payload 本身（例如旧的 mock-sync），
    // 但这种行通常 localTargetId 已经被填上了，根本不会走到这里。
    return { payload: raw as Record<string, unknown> };
  }

  /* ------------------------------------------------------------------------ */
  /*  Patient 解析（所有非 PATIENT 资源 promote 前都要先找到对应的本地 Patient）  */
  /* ------------------------------------------------------------------------ */

  private async resolveLocalPatient(ident: PatientIdentifier) {
    if (ident?.hospitalPatientId) {
      const byHpid = await this.prisma.patient.findUnique({
        where: { hospitalPatientId: ident.hospitalPatientId },
      });
      if (byHpid) return byHpid;
    }
    if (ident?.idCardNo) {
      const byId = await this.prisma.patient.findFirst({ where: { idCardNo: ident.idCardNo } });
      if (byId) return byId;
    }
    if (ident?.phone) {
      const byPhone = await this.prisma.patient.findFirst({ where: { phone: ident.phone } });
      if (byPhone) return byPhone;
    }
    if (ident?.externalPatientId) {
      // FHIR / HIS 给的外部主键，最后兜底当作 hospitalPatientId 试一次
      const byExt = await this.prisma.patient.findUnique({
        where: { hospitalPatientId: ident.externalPatientId },
      });
      if (byExt) return byExt;
    }
    return null;
  }

  private requirePatient(ident: PatientIdentifier) {
    return this.resolveLocalPatient(ident).then((p) => {
      if (p) return p;
      throw new PromotionConflictError(
        'PATIENT_NOT_FOUND',
        `本地未找到对应患者（hospitalPatientId=${ident?.hospitalPatientId ?? '空'} / idCard=${this.maskIdCard(ident?.idCardNo)} / phone=${this.maskPhone(ident?.phone)}）。请先 promote 该患者的 PATIENT 事件，或在【患者档案】里手工建档后再重试。`,
        { ident },
      );
    });
  }

  private maskIdCard(v?: string | null) {
    if (!v) return '空';
    if (v.length < 8) return '***';
    return `${v.substring(0, 3)}***${v.substring(v.length - 4)}`;
  }
  private maskPhone(v?: string | null) {
    if (!v) return '空';
    if (v.length < 7) return '***';
    return `${v.substring(0, 3)}****${v.substring(v.length - 4)}`;
  }

  /* ------------------------------------------------------------------------ */
  /*  PATIENT                                                                  */
  /* ------------------------------------------------------------------------ */

  private async promotePatient(
    ident: PatientIdentifier,
    payload: Record<string, unknown>,
    options: PromoteOptions,
  ): Promise<DispatchSuccess> {
    const hospitalPatientId = ident?.hospitalPatientId ?? ident?.externalPatientId;
    if (!hospitalPatientId) {
      throw new PromotionConflictError(
        'MISSING_REQUIRED_FIELDS',
        'PATIENT 事件缺少 hospitalPatientId / externalPatientId，无法落主数据。',
        { ident },
      );
    }

    const name = (payload['name'] as string | undefined) ?? '';
    const gender = this.coerceGender(payload['gender'] as string | undefined);
    const birthDate = this.coerceDate(payload['birthDate']);
    const address = (payload['address'] as string | undefined) ?? undefined;

    const existing = await this.prisma.patient.findUnique({
      where: { hospitalPatientId },
    });

    if (existing) {
      // 冲突检测：名字 / 身份证不一致
      const nameMismatch = name && existing.name && existing.name !== name;
      const idMismatch =
        ident?.idCardNo && existing.idCardNo && existing.idCardNo !== ident.idCardNo;

      if ((nameMismatch || idMismatch) && !options.forceOverwrite) {
        throw new PromotionConflictError(
          'PATIENT_IDENTITY_MISMATCH',
          `院内号 ${hospitalPatientId} 已存在的本地档案与上游数据不一致 — 本地姓名=${existing.name} / 上游姓名=${name || '空'}；本地身份证=${this.maskIdCard(existing.idCardNo)} / 上游身份证=${this.maskIdCard(ident?.idCardNo)}。请人工核验后再「强制覆盖」。`,
          { existingPatientId: existing.id },
        );
      }

      const updated = await this.prisma.patient.update({
        where: { id: existing.id },
        data: {
          name: name || existing.name,
          gender: gender ?? existing.gender,
          birthDate: birthDate ?? existing.birthDate,
          phone: ident?.phone ?? existing.phone,
          idCardNo: ident?.idCardNo ?? existing.idCardNo,
          address: address ?? existing.address,
        },
      });
      return {
        localTargetType: 'Patient',
        localTargetId: updated.id,
        message: `已更新患者档案：${updated.name}`,
      };
    }

    // 全新患者：name 不可空（schema 约束）
    if (!name) {
      throw new PromotionConflictError(
        'MISSING_REQUIRED_FIELDS',
        `PATIENT 事件未携带姓名，本地又无 ${hospitalPatientId} 的现有档案，无法新建。`,
      );
    }

    const created = await this.prisma.patient.create({
      data: {
        hospitalPatientId,
        name,
        gender: gender ?? Gender.UNKNOWN,
        birthDate: birthDate ?? undefined,
        phone: ident?.phone ?? undefined,
        idCardNo: ident?.idCardNo ?? undefined,
        address: address ?? undefined,
      },
    });
    return {
      localTargetType: 'Patient',
      localTargetId: created.id,
      message: `已新建患者档案：${created.name}（来自上游 ${hospitalPatientId}）`,
    };
  }

  /* ------------------------------------------------------------------------ */
  /*  DIAGNOSIS                                                                */
  /* ------------------------------------------------------------------------ */

  private async promoteDiagnosis(
    ident: PatientIdentifier,
    payload: Record<string, unknown>,
    _options: PromoteOptions,
  ): Promise<DispatchSuccess> {
    const patient = await this.requirePatient(ident);
    const icdCode =
      (payload['icdCode'] as string | undefined) ??
      (payload['diagnosisIcd'] as string | undefined) ??
      '';
    const inferredFromPayload = payload['inferredDiseaseType'] as DiseaseType | undefined;
    const diseaseType: DiseaseType =
      inferredFromPayload ?? mapIcd10ToDiseaseType(icdCode);

    const diagnosisDate =
      this.coerceDate(payload['diagnosisDate']) ??
      this.coerceDate(payload['recordedDate']);

    const existing = await this.prisma.diseaseProfile.findFirst({
      where: { patientId: patient.id, diseaseType },
    });

    if (existing) {
      const updated = await this.prisma.diseaseProfile.update({
        where: { id: existing.id },
        data: {
          diagnosisDate: diagnosisDate ?? existing.diagnosisDate,
          diseaseStage:
            (payload['diseaseStage'] as string | undefined) ?? existing.diseaseStage,
          complications:
            (payload['complications'] as string | undefined) ?? existing.complications,
          comorbidities:
            (payload['comorbidities'] as string | undefined) ?? existing.comorbidities,
          dataSource: DataSource.EMR,
        },
      });
      return {
        localTargetType: 'DiseaseProfile',
        localTargetId: updated.id,
        message: `已更新慢病档案：${diseaseType}`,
      };
    }

    const created = await this.prisma.diseaseProfile.create({
      data: {
        patientId: patient.id,
        diseaseType,
        diagnosisDate: diagnosisDate ?? undefined,
        diseaseStage: (payload['diseaseStage'] as string | undefined) ?? undefined,
        complications: (payload['complications'] as string | undefined) ?? undefined,
        comorbidities: (payload['comorbidities'] as string | undefined) ?? undefined,
        riskLevel: this.coerceRiskLevel(payload['riskLevel']),
        dataSource: DataSource.EMR,
      },
    });
    return {
      localTargetType: 'DiseaseProfile',
      localTargetId: created.id,
      message: `已新建慢病档案：${diseaseType}`,
    };
  }

  /* ------------------------------------------------------------------------ */
  /*  OBSERVATION                                                              */
  /* ------------------------------------------------------------------------ */

  private async promoteObservation(
    ident: PatientIdentifier,
    payload: Record<string, unknown>,
    record: IntegrationSyncRecord,
    _options: PromoteOptions,
  ): Promise<DispatchSuccess> {
    const patient = await this.requirePatient(ident);
    const dataSource = this.coerceObservationDataSource(payload);

    // OBSERVATION 既可能是 LIS 检验值，也可能是病房体征 / FHIR Observation。
    // 体征 promote 走 VitalRecordsService，复用规则引擎、监测计划、RiskAlert/Task 生成。
    const vitalType = this.resolveVitalType(payload);
    if (!vitalType) {
      throw new PromotionConflictError(
        'MISSING_REQUIRED_FIELDS',
        'OBSERVATION 事件无法识别 vitalType / itemCode 对应的体征类型，先 park 等扩展映射。',
        { itemCode: payload['itemCode'], itemName: payload['itemName'] },
      );
    }
    const valueRaw = payload['value'];
    const value =
      typeof valueRaw === 'number' ? valueRaw : Number(valueRaw as unknown as string);
    if (!Number.isFinite(value)) {
      throw new PromotionConflictError(
        'MISSING_REQUIRED_FIELDS',
        `OBSERVATION 事件缺少有效的数值 value（${String(valueRaw)}）。`,
      );
    }
    const unit =
      (payload['unit'] as string | undefined) ?? this.defaultUnitFor(vitalType);
    const measuredAt =
      this.coerceDate(payload['measuredAt']) ??
      this.coerceDate(payload['reportedAt']) ??
      this.coerceDate(payload['effectiveDateTime']) ??
      new Date();

    const abnormalFlag = (payload['abnormalFlag'] as string | undefined) ?? undefined;
    const upstreamAbnormal = abnormalFlag
      ? !['N', 'NORMAL'].includes(abnormalFlag.toUpperCase())
      : undefined;

    const result = await this.vitalRecordsService.create(patient.id, {
      type: vitalType,
      value,
      unit,
      measuredAt: measuredAt.toISOString(),
      dataSource,
      isAbnormal: upstreamAbnormal ?? false,
      note: this.buildObservationNote(payload, record),
    } as any);

    const vitalRecord =
      (result as any)?.vitalRecord ?? (result as any)?.bloodPressurePair?.systolicRecord;
    const generatedRiskAlertId = (result as any)?.generatedRiskAlert?.id ?? undefined;
    const generatedTaskId = (result as any)?.generatedTask?.id ?? undefined;

    return {
      localTargetType: 'VitalRecord',
      localTargetId: vitalRecord?.id ?? '',
      message: generatedRiskAlertId
        ? `已记录 ${vitalType}=${value}${unit}，命中规则并生成预警 + 任务。`
        : `已记录 ${vitalType}=${value}${unit}。`,
      generatedRiskAlertId,
      generatedTaskId,
    };
  }

  /* ------------------------------------------------------------------------ */
  /*  MEDICATION                                                               */
  /* ------------------------------------------------------------------------ */

  private async promoteMedication(
    ident: PatientIdentifier,
    payload: Record<string, unknown>,
    record: IntegrationSyncRecord,
    _options: PromoteOptions,
  ): Promise<DispatchSuccess> {
    const patient = await this.requirePatient(ident);
    const medicationName =
      (payload['drugName'] as string | undefined) ??
      (payload['medicationName'] as string | undefined) ??
      '';
    if (!medicationName) {
      throw new PromotionConflictError(
        'MISSING_REQUIRED_FIELDS',
        'MEDICATION 事件缺少 drugName / medicationName。',
      );
    }

    const dosage = (payload['dosage'] as string | undefined) ?? '—';
    const frequency = (payload['frequency'] as string | undefined) ?? '—';
    const prescribedAt =
      this.coerceDate(payload['startDate']) ??
      this.coerceDate(payload['prescribedAt']) ??
      new Date();

    // 同一个 externalRecordId 防重：先看院端医嘱表有没有这条 externalOrderId
    const externalOrderId = record.externalRecordId;
    const existing = await this.prisma.hospitalMedicationOrder.findFirst({
      where: { patientId: patient.id, externalOrderId },
    });
    if (existing) {
      return {
        localTargetType: 'HospitalMedicationOrder',
        localTargetId: existing.id,
        message: '同源处方已存在，仅刷新 localTargetId。',
      };
    }

    const created = await this.prisma.hospitalMedicationOrder.create({
      data: {
        patientId: patient.id,
        externalOrderId,
        medicationName,
        dosage,
        frequency,
        prescribedAt,
        dataSource: DataSource.HIS,
        sourceSystem: this.unwrapNormalized(record).channel,
        rawData: this.safeJson(payload),
      },
    });
    return {
      localTargetType: 'HospitalMedicationOrder',
      localTargetId: created.id,
      message: `已落院端医嘱：${medicationName} ${dosage} ${frequency}`,
    };
  }

  /* ------------------------------------------------------------------------ */
  /*  ENCOUNTER / DISCHARGE                                                    */
  /* ------------------------------------------------------------------------ */

  private async promoteEncounter(
    ident: PatientIdentifier,
    payload: Record<string, unknown>,
    record: IntegrationSyncRecord,
    _options: PromoteOptions,
    isDischarge: boolean,
  ): Promise<DispatchSuccess> {
    const patient = await this.requirePatient(ident);
    const visitTime =
      this.coerceDate(payload['dischargeTime']) ??
      this.coerceDate(payload['startedAt']) ??
      this.coerceDate(payload['endedAt']) ??
      new Date();
    const visitType = this.coerceEncounterType(payload, isDischarge);

    const externalVisitId = record.externalRecordId;
    const existing = await this.prisma.encounterRecord.findFirst({
      where: { patientId: patient.id, externalVisitId },
    });
    const encounter = existing
      ? await this.prisma.encounterRecord.update({
          where: { id: existing.id },
          data: {
            visitTime,
            visitType,
            departmentName:
              (payload['department'] as string | undefined) ?? existing.departmentName,
            doctorName:
              (payload['doctor'] as string | undefined) ?? existing.doctorName,
            chiefComplaint:
              (payload['chiefComplaint'] as string | undefined) ?? existing.chiefComplaint,
            diagnosisSummary:
              (payload['diagnosisText'] as string | undefined) ?? existing.diagnosisSummary,
            treatmentSummary:
              (payload['summary'] as string | undefined) ?? existing.treatmentSummary,
            sourceSystem: this.unwrapNormalized(record).channel,
            rawData: this.safeJson(payload),
          },
        })
      : await this.prisma.encounterRecord.create({
          data: {
            patientId: patient.id,
            hospitalPatientId: patient.hospitalPatientId,
            externalVisitId,
            visitType,
            departmentName: (payload['department'] as string | undefined) ?? undefined,
            doctorName: (payload['doctor'] as string | undefined) ?? undefined,
            visitTime,
            chiefComplaint: (payload['chiefComplaint'] as string | undefined) ?? undefined,
            diagnosisSummary: (payload['diagnosisText'] as string | undefined) ?? undefined,
            treatmentSummary: (payload['summary'] as string | undefined) ?? undefined,
            dataSource: DataSource.HIS,
            sourceSystem: this.unwrapNormalized(record).channel,
            rawData: this.safeJson(payload),
          },
        });

    // 出院事件额外落一条「出院小结」病历摘要，便于在患者详情页一眼看到
    if (isDischarge) {
      await this.prisma.medicalRecordSummary.create({
        data: {
          patientId: patient.id,
          externalRecordId: `${externalVisitId}-discharge`,
          recordType: MedicalRecordType.DISCHARGE_SUMMARY,
          recordTime: visitTime,
          departmentName: (payload['department'] as string | undefined) ?? undefined,
          title: `出院小结：${(payload['diagnosisText'] as string | undefined) ?? '诊断待补充'}`,
          summary: (payload['summary'] as string | undefined) ?? undefined,
          diagnosisText: (payload['diagnosisText'] as string | undefined) ?? undefined,
          dataSource: DataSource.HIS,
          sourceSystem: this.unwrapNormalized(record).channel,
          rawData: this.safeJson(payload),
        },
      });
    }

    return {
      localTargetType: 'EncounterRecord',
      localTargetId: encounter.id,
      message: isDischarge
        ? `已落出院记录 + 出院小结：${(payload['department'] as string | undefined) ?? ''}`
        : `已落就诊记录：${visitType}`,
    };
  }

  /* ------------------------------------------------------------------------ */
  /*  DOCUMENT                                                                 */
  /* ------------------------------------------------------------------------ */

  private async promoteDocument(
    ident: PatientIdentifier,
    payload: Record<string, unknown>,
    record: IntegrationSyncRecord,
    _options: PromoteOptions,
  ): Promise<DispatchSuccess> {
    const patient = await this.requirePatient(ident);
    const created = await this.prisma.medicalRecordSummary.create({
      data: {
        patientId: patient.id,
        externalRecordId: record.externalRecordId,
        recordType: this.coerceMedicalRecordType(payload),
        recordTime: this.coerceDate(payload['createdAt']) ?? new Date(),
        title:
          (payload['documentTitle'] as string | undefined) ??
          (payload['documentType'] as string | undefined) ??
          '病历文档',
        summary: (payload['summary'] as string | undefined) ?? undefined,
        dataSource: DataSource.EMR,
        sourceSystem: this.unwrapNormalized(record).channel,
        rawData: this.safeJson(payload),
      },
    });
    return {
      localTargetType: 'MedicalRecordSummary',
      localTargetId: created.id,
      message: '已落病历摘要。',
    };
  }

  /* ------------------------------------------------------------------------ */
  /*  小工具                                                                   */
  /* ------------------------------------------------------------------------ */

  private async markStatus(
    recordId: string,
    promotionStatus: IntegrationPromotionStatus,
    promotionMessage: string,
  ) {
    await this.prisma.integrationSyncRecord.update({
      where: { id: recordId },
      data: { promotionStatus, promotionMessage },
    });
  }

  private coerceDate(value: unknown): Date | undefined {
    if (!value) return undefined;
    if (value instanceof Date) return value;
    if (typeof value === 'string' && value.length > 0) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return undefined;
  }

  private coerceGender(g: unknown): Gender | undefined {
    if (!g) return undefined;
    const v = String(g).toUpperCase();
    if (v === 'M' || v === '1' || v === 'MALE') return Gender.MALE;
    if (v === 'F' || v === '2' || v === 'FEMALE') return Gender.FEMALE;
    if (v === '0' || v === 'UNKNOWN') return Gender.UNKNOWN;
    return undefined;
  }

  private coerceRiskLevel(v: unknown): RiskLevel {
    const candidates: RiskLevel[] = [
      RiskLevel.LOW,
      RiskLevel.MEDIUM,
      RiskLevel.HIGH,
      RiskLevel.VERY_HIGH,
    ];
    if (typeof v === 'string') {
      const upper = v.toUpperCase();
      const match = candidates.find((c) => c === upper);
      if (match) return match;
    }
    return RiskLevel.LOW;
  }

  private coerceObservationDataSource(payload: Record<string, unknown>): DataSource {
    const kind = (payload['observationKind'] as string | undefined) ?? '';
    const category = (payload['category'] as string | undefined) ?? '';
    if (kind === 'LAB' || category === 'laboratory') return DataSource.LIS;
    return DataSource.HIS;
  }

  /**
   * 上游字段 → 我们体征字典的简单映射。识别不到返回 undefined，
   * 让 promote 报 MISSING_REQUIRED_FIELDS（不偷偷写脏体征数据）。
   */
  private resolveVitalType(payload: Record<string, unknown>): string | undefined {
    const explicit =
      (payload['vitalType'] as string | undefined) ??
      (payload['type'] as string | undefined);
    if (explicit) return explicit.toUpperCase();

    const itemCode = ((payload['itemCode'] as string | undefined) ?? '').toUpperCase();
    if (!itemCode) return undefined;

    if (['SBP', 'SYSTOLIC', 'SYS_BP', 'BP_SYSTOLIC'].includes(itemCode)) return 'SYSTOLIC_BP';
    if (['DBP', 'DIASTOLIC', 'DIA_BP', 'BP_DIASTOLIC'].includes(itemCode)) return 'DIASTOLIC_BP';
    if (['FPG', 'GLU', 'GLU_FAST', 'BLOOD_GLUCOSE'].includes(itemCode)) return 'BLOOD_GLUCOSE';
    if (['HR', 'HEART_RATE', 'PULSE'].includes(itemCode)) return 'HEART_RATE';
    if (['SPO2', 'SPO_2', 'SAT_O2'].includes(itemCode)) return 'SPO2';
    if (['WEIGHT', 'BODY_WEIGHT'].includes(itemCode)) return 'WEIGHT';
    return undefined;
  }

  private defaultUnitFor(vitalType: string): string {
    switch (vitalType) {
      case 'SYSTOLIC_BP':
      case 'DIASTOLIC_BP':
        return 'mmHg';
      case 'BLOOD_GLUCOSE':
        return 'mmol/L';
      case 'HEART_RATE':
        return 'bpm';
      case 'SPO2':
        return '%';
      case 'WEIGHT':
        return 'kg';
      default:
        return '';
    }
  }

  private buildObservationNote(payload: Record<string, unknown>, record: IntegrationSyncRecord) {
    const parts: string[] = [];
    const channel = this.unwrapNormalized(record).channel;
    if (channel) parts.push(`通道：${channel}`);
    const itemName = (payload['itemName'] as string | undefined) ?? undefined;
    const itemCode = (payload['itemCode'] as string | undefined) ?? undefined;
    if (itemName) parts.push(`项目：${itemName}${itemCode ? `（${itemCode}）` : ''}`);
    const flag = (payload['abnormalFlag'] as string | undefined) ?? undefined;
    if (flag) parts.push(`上游异常标记：${flag}`);
    const ref = (payload['referenceRange'] as string | undefined) ?? undefined;
    if (ref) parts.push(`参考区间：${ref}`);
    if (parts.length === 0) return undefined;
    return parts.join(' · ');
  }

  private coerceEncounterType(
    payload: Record<string, unknown>,
    isDischarge: boolean,
  ) {
    const raw = (payload['encounterType'] as string | undefined) ?? '';
    const v = raw.toUpperCase();
    if (v === 'INPATIENT' || isDischarge) return 'INPATIENT' as const;
    if (v === 'EMERGENCY') return 'EMERGENCY' as const;
    if (v === 'CHECKUP') return 'CHECKUP' as const;
    return 'OUTPATIENT' as const;
  }

  private coerceMedicalRecordType(payload: Record<string, unknown>): MedicalRecordType {
    const v = ((payload['documentType'] as string | undefined) ?? '').toLowerCase();
    if (v.includes('discharge')) return MedicalRecordType.DISCHARGE_SUMMARY;
    if (v.includes('inpatient')) return MedicalRecordType.INPATIENT_RECORD;
    if (v.includes('progress')) return MedicalRecordType.PROGRESS_NOTE;
    if (v.includes('consult')) return MedicalRecordType.CONSULTATION_NOTE;
    return MedicalRecordType.OUTPATIENT_NOTE;
  }

  private safeJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) return undefined;
    try {
      return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    } catch {
      return undefined;
    }
  }
}
