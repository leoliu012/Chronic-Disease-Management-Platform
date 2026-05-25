/**
 * intermediate-poller.service.ts
 *
 * 中间表 / 视图模式的"定时拉取"任务。
 *
 * 默认禁用：需要 GATEWAY_INTERMEDIATE_POLLER_ENABLED=true 才会启动。
 * 启动后每隔 GATEWAY_INTERMEDIATE_POLLER_INTERVAL_MS 毫秒（默认 5 分钟）
 * 轮询一次中间库，把"自上次轮询以来变化过的"行包装成 NormalizedEvent 推给统一摄取层。
 *
 * 实现要点：
 *   - 不引入 @nestjs/schedule。直接用 setInterval + NestJS 生命周期钩子。
 *   - 单实例锁：用一个 isRunning 标记避免上一轮没跑完时启动下一轮（防止"血崩"重复拉）。
 *   - 增量游标：每个 fetchXxx 方法各自维护一个 lastUpdatedAt 指针，
 *     成功后才推进，失败下一轮会重试同一段时间。
 *   - Adapter 是注入的，默认 MockIntermediateDbAdapter；上线时换成 SQL Server / Oracle 实现。
 */

import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  GATEWAY_CHANNEL,
  GATEWAY_RESOURCE,
  mapIcd10ToDiseaseType,
} from '../gateway.constants';
import {
  INTERMEDIATE_DB_ADAPTER,
  type IntermediateDbAdapter,
} from '../interfaces/intermediate-db.adapter';
import { NormalizedEvent } from '../interfaces/normalized-event.interface';
import { InboundEventService } from './inbound-event.service';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class IntermediatePollerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('GatewayIntermediatePoller');
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private cursors = {
    patient: new Date(0),
    diagnosis: new Date(0),
    lab: new Date(0),
    prescription: new Date(0),
    discharge: new Date(0),
  };
  private lastRunAt: Date | null = null;
  private lastRunSummary: string | null = null;

  constructor(
    private readonly inbound: InboundEventService,
    @Inject(INTERMEDIATE_DB_ADAPTER) private readonly adapter: IntermediateDbAdapter,
  ) {}

  /* ------------------------------------------------------------------------ */

  async onApplicationBootstrap() {
    if (process.env.GATEWAY_INTERMEDIATE_POLLER_ENABLED !== 'true') {
      this.logger.log(
        'Intermediate poller disabled (set GATEWAY_INTERMEDIATE_POLLER_ENABLED=true to enable).',
      );
      return;
    }

    if (this.adapter.connect) {
      try {
        await this.adapter.connect();
        this.logger.log(`Adapter connected: ${this.adapter.name}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Adapter.connect failed: ${message}. Poller will keep retrying.`);
      }
    }

    const interval = Number(
      process.env.GATEWAY_INTERMEDIATE_POLLER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
    );

    // 首次延迟 5s 启动，避免和模块初始化竞争
    setTimeout(() => {
      this.pollOnce().catch((err) => this.logger.error(`Initial poll failed: ${err.message}`));
      this.timer = setInterval(() => {
        this.pollOnce().catch((err) => this.logger.error(`Scheduled poll failed: ${err.message}`));
      }, interval);
    }, 5000);

    this.logger.log(`Intermediate poller scheduled (adapter=${this.adapter.name}, interval=${interval}ms).`);
  }

  async onApplicationShutdown() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.adapter.disconnect) {
      try {
        await this.adapter.disconnect();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Adapter.disconnect failed: ${message}`);
      }
    }
  }

  /* ------------------------------------------------------------------------ */

  getStatus() {
    return {
      enabled: process.env.GATEWAY_INTERMEDIATE_POLLER_ENABLED === 'true',
      running: this.timer !== null,
      inFlight: this.inFlight,
      adapter: this.adapter.name,
      intervalMs: Number(
        process.env.GATEWAY_INTERMEDIATE_POLLER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
      ),
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      lastRunSummary: this.lastRunSummary,
      cursors: {
        patient: this.cursors.patient.toISOString(),
        diagnosis: this.cursors.diagnosis.toISOString(),
        lab: this.cursors.lab.toISOString(),
        prescription: this.cursors.prescription.toISOString(),
        discharge: this.cursors.discharge.toISOString(),
      },
    };
  }

  /**
   * 手动触发一次同步（不等定时器到点）— 给 GatewayAdminController 用。
   */
  async pollNow(): Promise<{ accepted: number; duplicated: number; failed: number; total: number }> {
    return this.pollOnce();
  }

  /* ------------------------------------------------------------------------ */

  private async pollOnce() {
    if (this.inFlight) {
      this.logger.warn('Skipping poll: previous run still in flight.');
      return { accepted: 0, duplicated: 0, failed: 0, total: 0 };
    }
    this.inFlight = true;
    this.lastRunAt = new Date();

    try {
      const allEvents: NormalizedEvent[] = [];

      /* ----- patients ----- */
      const patientRows = await this.adapter.fetchPatientsModifiedAfter(this.cursors.patient);
      for (const row of patientRows) {
        allEvents.push({
          eventId: `INTERMEDIATE:PATIENT:${row.rowId}:${row.updatedAt.toISOString()}`,
          channel: GATEWAY_CHANNEL.INTERMEDIATE_DB,
          resourceType: GATEWAY_RESOURCE.PATIENT,
          receivedAt: new Date(),
          patient: {
            hospitalPatientId: row.hospitalPatientId,
            idCardNo: row.idCardNo,
            phone: row.phone,
          },
          rawPayload: row,
          normalizedPayload: {
            name: row.name,
            gender: normalizeGenderCode(row.genderCode),
            birthDate: row.birthDate,
            address: row.address,
          },
        });
      }
      this.advanceCursor('patient', patientRows.map((r) => r.updatedAt));

      /* ----- diagnoses ----- */
      const diagRows = await this.adapter.fetchDiagnosesModifiedAfter(this.cursors.diagnosis);
      for (const row of diagRows) {
        allEvents.push({
          eventId: `INTERMEDIATE:DIAGNOSIS:${row.rowId}:${row.updatedAt.toISOString()}`,
          channel: GATEWAY_CHANNEL.INTERMEDIATE_DB,
          resourceType: GATEWAY_RESOURCE.DIAGNOSIS,
          receivedAt: new Date(),
          patient: { hospitalPatientId: row.hospitalPatientId },
          rawPayload: row,
          normalizedPayload: {
            icdCode: row.icdCode,
            icdName: row.icdName,
            diagnosisDate: row.diagnosisDate,
            inferredDiseaseType: mapIcd10ToDiseaseType(row.icdCode),
            riskLevelText: row.riskLevelText,
            complications: row.complications,
            comorbidities: row.comorbidities,
          },
        });
      }
      this.advanceCursor('diagnosis', diagRows.map((r) => r.updatedAt));

      /* ----- lab results ----- */
      const labRows = await this.adapter.fetchLabResultsAfter(this.cursors.lab);
      for (const row of labRows) {
        allEvents.push({
          eventId: `INTERMEDIATE:LAB:${row.rowId}:${row.updatedAt.toISOString()}`,
          channel: GATEWAY_CHANNEL.INTERMEDIATE_DB,
          resourceType: GATEWAY_RESOURCE.OBSERVATION,
          receivedAt: new Date(),
          patient: { hospitalPatientId: row.hospitalPatientId },
          rawPayload: row,
          normalizedPayload: {
            itemCode: row.itemCode,
            itemName: row.itemName,
            value: row.value,
            unit: row.unit,
            referenceRange: row.referenceRange,
            abnormalFlag: row.abnormalFlag,
            measuredAt: row.reportedAt,
            category: 'laboratory',
          },
        });
      }
      this.advanceCursor('lab', labRows.map((r) => r.updatedAt));

      /* ----- prescriptions ----- */
      const rxRows = await this.adapter.fetchPrescriptionsAfter(this.cursors.prescription);
      for (const row of rxRows) {
        allEvents.push({
          eventId: `INTERMEDIATE:RX:${row.rowId}:${row.updatedAt.toISOString()}`,
          channel: GATEWAY_CHANNEL.INTERMEDIATE_DB,
          resourceType: GATEWAY_RESOURCE.MEDICATION,
          receivedAt: new Date(),
          patient: { hospitalPatientId: row.hospitalPatientId },
          rawPayload: row,
          normalizedPayload: {
            drugName: row.drugName,
            dosage: row.dosage,
            frequency: row.frequency,
            instructions: row.instructions,
            startDate: row.startDate,
            endDate: row.endDate,
          },
        });
      }
      this.advanceCursor('prescription', rxRows.map((r) => r.updatedAt));

      /* ----- discharges ----- */
      const dcRows = await this.adapter.fetchDischargesAfter(this.cursors.discharge);
      for (const row of dcRows) {
        allEvents.push({
          eventId: `INTERMEDIATE:DISCHARGE:${row.rowId}:${row.updatedAt.toISOString()}`,
          channel: GATEWAY_CHANNEL.INTERMEDIATE_DB,
          resourceType: GATEWAY_RESOURCE.DISCHARGE,
          receivedAt: new Date(),
          patient: { hospitalPatientId: row.hospitalPatientId },
          rawPayload: row,
          normalizedPayload: {
            admissionTime: row.admissionDate,
            dischargeTime: row.dischargeDate,
            department: row.department,
            diagnosisIcd: row.diagnosisIcd,
            diagnosisText: row.diagnosisText,
            inferredDiseaseType: mapIcd10ToDiseaseType(row.diagnosisIcd ?? ''),
            summary: row.summary,
          },
        });
      }
      this.advanceCursor('discharge', dcRows.map((r) => r.updatedAt));

      if (allEvents.length === 0) {
        this.lastRunSummary = 'No new rows.';
        return { accepted: 0, duplicated: 0, failed: 0, total: 0 };
      }

      const result = await this.inbound.ingestBatch(GATEWAY_CHANNEL.INTERMEDIATE_DB, allEvents, {
        batchType: `INTERMEDIATE_POLL:${this.adapter.name}`,
      });
      this.lastRunSummary = `accepted=${result.accepted} dup=${result.duplicated} failed=${result.failed} total=${result.total}`;
      this.logger.log(`Intermediate poll done — ${this.lastRunSummary}`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Poll failed: ${message}`);
      this.lastRunSummary = `error: ${message}`;
      return { accepted: 0, duplicated: 0, failed: 0, total: 0 };
    } finally {
      this.inFlight = false;
    }
  }

  private advanceCursor(
    key: keyof typeof this.cursors,
    dates: Date[],
  ): void {
    if (dates.length === 0) return;
    const maxDate = dates.reduce((max, d) => (d > max ? d : max), this.cursors[key]);
    this.cursors[key] = maxDate;
  }
}

function normalizeGenderCode(code: string | undefined): 'MALE' | 'FEMALE' | 'UNKNOWN' {
  if (!code) return 'UNKNOWN';
  const v = code.toUpperCase();
  if (v === 'M' || v === '1' || v === 'MALE') return 'MALE';
  if (v === 'F' || v === '2' || v === 'FEMALE') return 'FEMALE';
  return 'UNKNOWN';
}
