/**
 * fhir.controller.ts
 *
 * FHIR R4 入站接口（最现代的对接方式）：
 *
 *   POST /gateway/fhir/:resourceType   — 单一资源 (Patient / Observation / Condition ...)
 *   POST /gateway/fhir/Bundle          — 事务/批量 Bundle
 *
 * 注意：
 *   - 用 @Body() raw: Record<string, unknown> 直接吃原始 JSON，
 *     绕开 ValidationPipe(whitelist:true) 把 FHIR 字段全部剥光的问题。
 *   - 真正的字段校验交给 fhir-to-normalized.mapper.ts 自己负责，
 *     这样可以宽松接收任何符合 R4 形状的资源，不强制每个 field 都登记 DTO。
 *   - @Public() 跳过 JwtAuthGuard，再用 GatewayApiKeyGuard 做 X-Gateway-Api-Key 校验。
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../security/public.decorator';
import { GatewayApiKeyGuard } from '../guards/gateway-api-key.guard';
import { GATEWAY_CHANNEL } from '../gateway.constants';
import { fhirToNormalizedEvents } from '../parsers/fhir-to-normalized.mapper';
import { InboundEventService } from '../services/inbound-event.service';

@Controller('gateway/fhir')
@Public()
@UseGuards(GatewayApiKeyGuard)
export class FhirController {
  private readonly logger = new Logger('GatewayFhirController');

  constructor(private readonly inbound: InboundEventService) {}

  /**
   * 事务 Bundle 优先于通配 :resourceType 路由匹配
   */
  @Post('Bundle')
  @HttpCode(HttpStatus.OK)
  async ingestBundle(@Body() body: Record<string, unknown>) {
    const resourceType =
      typeof body?.['resourceType'] === 'string'
        ? (body['resourceType'] as string)
        : null;
    if (resourceType !== 'Bundle') {
      return {
        status: 'REJECTED',
        message: `POST /gateway/fhir/Bundle requires resourceType="Bundle", got ${resourceType ?? 'null'}`,
      };
    }

    const { ok, events, errors } = fhirToNormalizedEvents(body);
    if (!ok && events.length === 0) {
      return {
        status: 'REJECTED',
        message: 'FHIR Bundle could not be parsed',
        errors,
      };
    }

    const batchResult = await this.inbound.ingestBatch(
      GATEWAY_CHANNEL.FHIR_REST,
      events,
      { batchType: 'GATEWAY_FHIR_BUNDLE' },
    );

    return {
      status: 'ACCEPTED',
      batchId: batchResult.batchId,
      total: batchResult.total,
      accepted: batchResult.accepted,
      duplicated: batchResult.duplicated,
      failed: batchResult.failed,
      parseWarnings: errors,
    };
  }

  /**
   * 单一资源接收
   *   eg. POST /gateway/fhir/Patient
   *       POST /gateway/fhir/Observation
   *       POST /gateway/fhir/Condition
   */
  @Post(':resourceType')
  @HttpCode(HttpStatus.OK)
  async ingestResource(
    @Param('resourceType') pathResourceType: string,
    @Body() body: Record<string, unknown>,
  ) {
    const bodyResourceType =
      typeof body?.['resourceType'] === 'string'
        ? (body['resourceType'] as string)
        : null;

    if (bodyResourceType && bodyResourceType !== pathResourceType) {
      return {
        status: 'REJECTED',
        message: `Path resourceType=${pathResourceType} but body resourceType=${bodyResourceType}`,
      };
    }

    // 如果对端只给 path 没写 body.resourceType，补一下，方便 mapper 处理
    if (!bodyResourceType) {
      body = { ...body, resourceType: pathResourceType };
    }

    const { ok, events, errors } = fhirToNormalizedEvents(body);
    if (!ok || events.length === 0) {
      return {
        status: 'REJECTED',
        message: 'FHIR resource could not be mapped to any normalized event',
        errors,
      };
    }

    if (events.length === 1) {
      const result = await this.inbound.ingestSingle(events[0]);
      return {
        status: result.status,
        batchId: result.batchId,
        recordId: result.recordId,
        message: result.message,
        parseWarnings: errors,
      };
    }

    const batchResult = await this.inbound.ingestBatch(
      GATEWAY_CHANNEL.FHIR_REST,
      events,
      { batchType: 'GATEWAY_FHIR_RESOURCE' },
    );
    return {
      status: 'ACCEPTED',
      batchId: batchResult.batchId,
      total: batchResult.total,
      accepted: batchResult.accepted,
      duplicated: batchResult.duplicated,
      failed: batchResult.failed,
      parseWarnings: errors,
    };
  }
}
