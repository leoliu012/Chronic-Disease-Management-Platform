/**
 * gateway-source-registry.service.ts
 *
 * 模块启动时把 4 个网关通道对应的 IntegrationSource 行写进 DB（upsert）。
 * 这样 IntegrationCenter 页面立刻能看到「数据接入网关 - FHIR REST」
 * 等四条来源，不需要管理员先手动 seedDefaults。
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IntegrationSource, IntegrationSystemType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GATEWAY_CHANNEL,
  GATEWAY_SOURCE_CODE,
  GatewayChannel,
} from '../gateway.constants';

interface SourceDefinition {
  code: string;
  name: string;
  systemType: IntegrationSystemType;
  description: string;
}

const SOURCE_DEFINITIONS: SourceDefinition[] = [
  {
    code: GATEWAY_SOURCE_CODE.FHIR_REST,
    name: '数据接入网关 - FHIR R4 REST',
    systemType: IntegrationSystemType.OTHER,
    description: '医院 HIS / EMR / LIS 通过 HTTPS POST /gateway/fhir/* 推送的 FHIR R4 资源。',
  },
  {
    code: GATEWAY_SOURCE_CODE.HIS_EVENT_REST,
    name: '数据接入网关 - 简化 HIS 事件 REST',
    systemType: IntegrationSystemType.HIS,
    description: '医院端在患者出院 / 开具处方等事件触发时通过 HTTPS JSON 调用 /gateway/his/events/*。',
  },
  {
    code: GATEWAY_SOURCE_CODE.HL7_MLLP,
    name: '数据接入网关 - HL7 v2 over MLLP TCP',
    systemType: IntegrationSystemType.MESSAGE,
    description: '医院集成平台（如 Ensemble/Iris）通过 TCP MLLP 推送的 HL7 v2 报文（ADT/ORM/ORU/MDM）。',
  },
  {
    code: GATEWAY_SOURCE_CODE.INTERMEDIATE_DB,
    name: '数据接入网关 - 中间表 / 前置机',
    systemType: IntegrationSystemType.HIS,
    description: '定时从医院前置机中间库（SQL Server / Oracle）读取增量数据。',
  },
];

@Injectable()
export class GatewaySourceRegistryService implements OnModuleInit {
  private readonly logger = new Logger('GatewaySourceRegistry');
  private readonly cache = new Map<string, IntegrationSource>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedAll();
  }

  async seedAll(): Promise<void> {
    const hospitalTenantId = await this.resolveLocalHospitalTenantId();
    for (const def of SOURCE_DEFINITIONS) {
      const source = await this.prisma.integrationSource.upsert({
        where: {
          hospitalTenantId_code: {
            hospitalTenantId,
            code: def.code,
          },
        },
        update: {
          hospitalTenantId,
          name: def.name,
          systemType: def.systemType,
          description: def.description,
        },
        create: {
          hospitalTenantId,
          code: def.code,
          name: def.name,
          systemType: def.systemType,
          description: def.description,
          isEnabled: true,
        },
      });
      this.cache.set(def.code, source);
    }
    this.logger.log(`Seeded ${SOURCE_DEFINITIONS.length} gateway IntegrationSource rows.`);
  }

  /**
   * 取出某个通道对应的 IntegrationSource。如果缓存里没有就回 DB 查。
   */
  async getSourceForChannel(channel: GatewayChannel): Promise<IntegrationSource> {
    const code = this.channelToCode(channel);
    const cached = this.cache.get(code);
    if (cached) return cached;

    const hospitalTenantId = await this.resolveLocalHospitalTenantId();
    const fromDb = await this.prisma.integrationSource.findUnique({
      where: {
        hospitalTenantId_code: {
          hospitalTenantId,
          code,
        },
      },
    });
    if (fromDb) {
      this.cache.set(code, fromDb);
      return fromDb;
    }
    // 启动时漏 seed 了？补一发
    await this.seedAll();
    const refreshed = this.cache.get(code);
    if (!refreshed) {
      throw new Error(`Gateway source not found for channel ${channel}`);
    }
    return refreshed;
  }


  private async resolveLocalHospitalTenantId(): Promise<string> {
    const configured = (process.env.LOCAL_HOSPITAL_TENANT_ID ?? '').trim();
    if (configured) {
      const tenant = await this.prisma.hospitalTenant.findUnique({
        where: { id: configured },
        select: { id: true, isActive: true },
      });
      if (!tenant?.isActive) {
        throw new Error(
          `LOCAL_HOSPITAL_TENANT_ID=${configured} does not reference an active HospitalTenant`,
        );
      }
      return tenant.id;
    }

    const tenants = await this.prisma.hospitalTenant.findMany({
      where: { isActive: true },
      select: { id: true },
      take: 2,
    });
    if (tenants.length !== 1) {
      throw new Error(
        'Gateway source registry requires LOCAL_HOSPITAL_TENANT_ID when active tenant count is not exactly one',
      );
    }
    return tenants[0].id;
  }

  private channelToCode(channel: GatewayChannel): string {
    switch (channel) {
      case GATEWAY_CHANNEL.FHIR_REST:
        return GATEWAY_SOURCE_CODE.FHIR_REST;
      case GATEWAY_CHANNEL.HIS_EVENT_REST:
        return GATEWAY_SOURCE_CODE.HIS_EVENT_REST;
      case GATEWAY_CHANNEL.HL7_MLLP:
        return GATEWAY_SOURCE_CODE.HL7_MLLP;
      case GATEWAY_CHANNEL.INTERMEDIATE_DB:
        return GATEWAY_SOURCE_CODE.INTERMEDIATE_DB;
      default:
        throw new Error(`Unknown channel: ${channel as string}`);
    }
  }
}
