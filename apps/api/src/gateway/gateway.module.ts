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
 *    HospitalMedicationOrder）。OBSERVATION 通过 VitalRecordsService 走规则引擎，
 *   命中阈值时自动生成 RiskAlert + Task。手动 promote 走 GatewayPromoteController。
 *
 * 默认 Fail-closed:
 *   - REST 接口需要 GATEWAY_API_KEY 环境变量；不设就拒收所有请求
 *   - HL7 监听必须 GATEWAY_HL7_ENABLED=true 才会启动
 *   - 中间表轮询必须 GATEWAY_INTERMEDIATE_POLLER_ENABLED=true 才会启动
 *
 * 中间表数据源：
 *   - 通过 INTERMEDIATE_DB_ADAPTER token 注入
 *   - 默认使用 MockIntermediateDbAdapter（内存假数据），生产环境请替换为
 *     实际的 SQL Server / Oracle 实现（参考 docs/gateway/README.md）
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { VitalRecordsModule } from '../vital-records/vital-records.module';

import { FhirController } from './controllers/fhir.controller';
import { HisEventsController } from './controllers/his-events.controller';
import { GatewayAdminController } from './controllers/gateway-admin.controller';
import { GatewayPromoteController } from './controllers/gateway-promote.controller';

import { GatewayApiKeyGuard } from './guards/gateway-api-key.guard';
import { InboundEventService } from './services/inbound-event.service';
import { IntegrationPromoteService } from './services/integration-promote.service';
import { GatewaySourceRegistryService } from './services/gateway-source-registry.service';
import { Hl7ListenerService } from './services/hl7-listener.service';
import { IntermediatePollerService } from './services/intermediate-poller.service';
import { MockIntermediateDbAdapter } from './services/mock-intermediate-db.adapter';
import { INTERMEDIATE_DB_ADAPTER } from './interfaces/intermediate-db.adapter';

@Module({
  imports: [PrismaModule, SecurityModule, VitalRecordsModule],
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
    /**
     * 中间表适配器 token —— 生产环境时把 useClass 换成真正的
     * SqlServerIntermediateDbAdapter / OracleIntermediateDbAdapter
     * (实现 IntermediateDbAdapter 接口即可，不需要改 Poller / Controller / 任何上层代码)。
     */
    {
      provide: INTERMEDIATE_DB_ADAPTER,
      useClass: MockIntermediateDbAdapter,
    },
  ],
  exports: [IntegrationPromoteService],
})
export class GatewayModule {}
