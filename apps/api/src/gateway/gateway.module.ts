/**
 * gateway.module.ts
 *
 * 标准化数据接入网关 — 把以下三种主流医疗对接方式统一到一个内部审计层：
 *
 *   1. RESTful / FHIR R4         — POST /gateway/fhir/...
 *   2. 简化 HIS 业务事件 REST     — POST /gateway/his/events/...
 *   3. HL7 v2 over MLLP (TCP)    — 由 Hl7ListenerService 监听
 *   4. 视图 / 前置机中间表        — IntermediatePollerService 定时拉取
 *
 * 共同入口：InboundEventService.ingest*() → 写 IntegrationSyncBatch / IntegrationSyncRecord
 *
 * gateway-promote-pipeline:
 *   审计写入后，根据 IntegrationSource.autoPromote 决定是否同步推进到主数据表
 *   （Patient / DiseaseProfile / VitalRecord / EncounterRecord / MedicalRecordSummary /
 *    HospitalMedicationOrder / ExamReportRecord）。OBSERVATION 通过 VitalRecordsService
 *   走规则引擎，命中阈值时自动生成 RiskAlert + Task。手动 promote 走 GatewayPromoteController。
 *
 * gateway-production-hardening (新增):
 *   - GatewayApiKeyService:           per-source api key + IP allowlist (替换全局 GATEWAY_API_KEY)
 *   - GatewayPromotionWorkerService:  失败 record 的指数退避重试 (GATEWAY_PROMOTION_WORKER_ENABLED)
 *   - GatewayAuditReportService:      审计报表 + CSV 导出
 *   - GatewayAlertService:            告警通道 (RETRY_EXHAUSTED 等触发 webhook)
 *   - FieldMappingResolverService:    IntegrationFieldMapping 在 promote 时动态生效
 *   - DischargeFollowupPlanGenerator: 出院 → D+2/D+7/D+14/D+30 随访任务 (从 FollowUpsModule)
 *   - Intermediate adapter factory:   GATEWAY_INTERMEDIATE_ADAPTER=mock|sqlserver|oracle
 *
 * 默认 Fail-closed:
 *   - REST 接口需要 GatewayApiKey 行或 (开发环境) GATEWAY_API_KEY 环境变量；不设就拒收所有请求
 *   - HL7 监听必须 GATEWAY_HL7_ENABLED=true 才会启动
 *   - 中间表轮询必须 GATEWAY_INTERMEDIATE_POLLER_ENABLED=true 才会启动
 *   - Retry worker 必须 GATEWAY_PROMOTION_WORKER_ENABLED=true 才会启动
 */

import { Module } from '@nestjs/common';
import { FollowUpsModule } from '../follow-ups/follow-ups.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { VitalRecordsModule } from '../vital-records/vital-records.module';

import { FhirController } from './controllers/fhir.controller';
import { HisEventsController } from './controllers/his-events.controller';
import { GatewayAdminController } from './controllers/gateway-admin.controller';
import { GatewayPromoteController } from './controllers/gateway-promote.controller';

import { GatewayApiKeyGuard } from './guards/gateway-api-key.guard';
import { INTERMEDIATE_DB_ADAPTER } from './interfaces/intermediate-db.adapter';

import { FieldMappingResolverService } from './services/field-mapping-resolver.service';
import { GatewayAlertService } from './services/gateway-alert.service';
import { GatewayApiKeyService } from './services/gateway-api-key.service';
import { GatewayAuditReportService } from './services/gateway-audit-report.service';
import { GatewayPromotionWorkerService } from './services/gateway-promotion-worker.service';
import { GatewaySourceRegistryService } from './services/gateway-source-registry.service';
import { Hl7ListenerService } from './services/hl7-listener.service';
import { InboundEventService } from './services/inbound-event.service';
import { IntegrationPromoteService } from './services/integration-promote.service';
import { IntermediatePollerService } from './services/intermediate-poller.service';
import { intermediateAdapterFactory } from './services/intermediate-adapter.factory';

@Module({
  imports: [PrismaModule, SecurityModule, VitalRecordsModule, FollowUpsModule],
  controllers: [
    FhirController,
    HisEventsController,
    GatewayAdminController,
    GatewayPromoteController,
  ],
  providers: [
    InboundEventService,
    IntegrationPromoteService,
    GatewaySourceRegistryService,
    Hl7ListenerService,
    IntermediatePollerService,
    GatewayApiKeyGuard,

    // gateway-production-hardening: 新服务
    GatewayApiKeyService,
    GatewayAuditReportService,
    GatewayAlertService,
    GatewayPromotionWorkerService,
    FieldMappingResolverService,

    /**
     * 中间表适配器 token —— 由 intermediateAdapterFactory 根据
     * GATEWAY_INTERMEDIATE_ADAPTER 环境变量决定:
     *   - mock      : MockIntermediateDbAdapter (默认, dev / demo)
     *   - sqlserver : SqlServerIntermediateDbAdapter (需要 npm install mssql)
     *   - oracle    : OracleIntermediateDbAdapter   (需要 npm install oracledb)
     */
    {
      provide: INTERMEDIATE_DB_ADAPTER,
      useFactory: intermediateAdapterFactory,
    },
  ],
  exports: [IntegrationPromoteService],
})
export class GatewayModule {}
