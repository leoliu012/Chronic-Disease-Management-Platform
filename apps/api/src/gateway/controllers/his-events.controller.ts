/**
 * his-events.controller.ts
 *
 * 简化的 HIS 业务事件 REST 接口（POST /gateway/his/events/*）。
 *
 * 设计立场：
 *   - 这套接口给"想用 REST 但还接不上 FHIR"的医院 IT 用，
 *     字段更扁平、更贴近国内卫生信息交换习惯。
 *   - DTO 已经在 his-event.dto.ts 严格校验；
 *     这里只把校验完的 DTO 翻译成 NormalizedEvent，丢给 InboundEventService。
 *   - 全部 @Public()，鉴权交给 GatewayApiKeyGuard。
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../security/public.decorator';
import { GatewayApiKeyGuard } from '../guards/gateway-api-key.guard';
import {
  GATEWAY_CHANNEL,
  GATEWAY_RESOURCE,
  GatewayResourceType,
} from '../gateway.constants';
import {
  HisDischargeEventDto,
  HisEncounterEventDto,
  HisLabResultEventDto,
  HisPatientIdentifierDto,
  HisPatientUpdatedEventDto,
  HisPrescriptionEventDto,
  HisVitalEventDto,
} from '../dto/his-event.dto';
import { NormalizedEvent, PatientIdentifier } from '../interfaces/normalized-event.interface';
import { InboundEventService } from '../services/inbound-event.service';

function mapPatient(p: HisPatientIdentifierDto): PatientIdentifier {
  return {
    hospitalPatientId: p.hospitalPatientId,
    idCardNo: p.idCardNo,
    phone: p.phone,
    externalPatientId: p.externalPatientId,
  };
}

function makeEvent(
  dto: { eventId: string },
  resourceType: GatewayResourceType,
  patient: PatientIdentifier,
  payload: Record<string, unknown>,
  triggerEvent: string,
): NormalizedEvent {
  return {
    eventId: dto.eventId,
    channel: GATEWAY_CHANNEL.HIS_EVENT_REST,
    resourceType,
    receivedAt: new Date(),
    patient,
    normalizedPayload: payload,
    rawPayload: dto,
    triggerEvent,
  };
}

@Controller('gateway/his/events')
@Public()
@UseGuards(GatewayApiKeyGuard)
export class HisEventsController {
  constructor(private readonly inbound: InboundEventService) {}

  @Post('discharge')
  @HttpCode(HttpStatus.OK)
  async discharge(@Body() dto: HisDischargeEventDto) {
    const event = makeEvent(
      dto,
      GATEWAY_RESOURCE.DISCHARGE,
      mapPatient(dto.patient),
      {
        dischargeTime: dto.dischargeTime,
        admissionTime: dto.admissionTime,
        department: dto.department,
        diagnosisIcd: dto.diagnosisIcd,
        diagnosisText: dto.diagnosisText,
        summary: dto.summary,
      },
      'HIS_EVENT.DISCHARGE',
    );
    return this.inbound.ingestSingle(event);
  }

  @Post('prescription')
  @HttpCode(HttpStatus.OK)
  async prescription(@Body() dto: HisPrescriptionEventDto) {
    const event = makeEvent(
      dto,
      GATEWAY_RESOURCE.MEDICATION,
      mapPatient(dto.patient),
      {
        drugName: dto.drugName,
        drugCode: dto.drugCode,
        dosage: dto.dosage,
        frequency: dto.frequency,
        instructions: dto.instructions,
        startDate: dto.startDate,
        endDate: dto.endDate,
      },
      'HIS_EVENT.PRESCRIPTION',
    );
    return this.inbound.ingestSingle(event);
  }

  @Post('lab-result')
  @HttpCode(HttpStatus.OK)
  async labResult(@Body() dto: HisLabResultEventDto) {
    const event = makeEvent(
      dto,
      GATEWAY_RESOURCE.OBSERVATION,
      mapPatient(dto.patient),
      {
        observationKind: 'LAB',
        itemCode: dto.itemCode,
        itemName: dto.itemName,
        value: dto.value,
        unit: dto.unit,
        referenceRange: dto.referenceRange,
        abnormalFlag: dto.abnormalFlag,
        reportedAt: dto.reportedAt,
      },
      'HIS_EVENT.LAB_RESULT',
    );
    return this.inbound.ingestSingle(event);
  }

  @Post('vital')
  @HttpCode(HttpStatus.OK)
  async vital(@Body() dto: HisVitalEventDto) {
    const event = makeEvent(
      dto,
      GATEWAY_RESOURCE.OBSERVATION,
      mapPatient(dto.patient),
      {
        observationKind: 'VITAL',
        vitalType: dto.vitalType,
        value: dto.value,
        unit: dto.unit,
        measuredAt: dto.measuredAt,
        deviceId: dto.deviceId,
      },
      'HIS_EVENT.VITAL',
    );
    return this.inbound.ingestSingle(event);
  }

  @Post('patient-updated')
  @HttpCode(HttpStatus.OK)
  async patientUpdated(@Body() dto: HisPatientUpdatedEventDto) {
    const event = makeEvent(
      dto,
      GATEWAY_RESOURCE.PATIENT,
      mapPatient(dto.patient),
      {
        name: dto.name,
        gender: dto.gender,
        birthDate: dto.birthDate,
        address: dto.address,
      },
      'HIS_EVENT.PATIENT_UPDATED',
    );
    return this.inbound.ingestSingle(event);
  }

  @Post('encounter')
  @HttpCode(HttpStatus.OK)
  async encounter(@Body() dto: HisEncounterEventDto) {
    const event = makeEvent(
      dto,
      GATEWAY_RESOURCE.ENCOUNTER,
      mapPatient(dto.patient),
      {
        encounterType: dto.encounterType,
        startedAt: dto.startedAt,
        endedAt: dto.endedAt,
        department: dto.department,
        doctor: dto.doctor,
        chiefComplaint: dto.chiefComplaint,
        extra: dto.extra,
      },
      'HIS_EVENT.ENCOUNTER',
    );
    return this.inbound.ingestSingle(event);
  }
}
