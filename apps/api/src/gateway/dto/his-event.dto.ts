/**
 * his-event.dto.ts
 *
 * 简化的"医院业务事件"DTO（POST /gateway/his/events/*）。
 *
 * 这套接口主要是给"暂时玩不转 FHIR、但又想用 REST 推数据"的医院 IT 准备的。
 * 字段命名贴近国内卫生信息交换规范 (WS/T 500 系列) 的常见叫法，
 * 由网关在 InboundEventService 里翻译成 NormalizedEvent。
 *
 * 所有 DTO 都带 eventId，用于幂等。重复同一个 eventId 推第二次时，
 * 网关会返回 200 OK 并标注 "duplicated"，不会重复写库。
 */

import {
  IsDateString,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/* -------------------------------------------------------------------------- */
/*  共用片段                                                                   */
/* -------------------------------------------------------------------------- */

export class HisPatientIdentifierDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  hospitalPatientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  idCardNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  /** 上游系统的患者主键 */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalPatientId?: string;
}

/* -------------------------------------------------------------------------- */
/*  1. 患者出院 (HIS → 网关)                                                   */
/* -------------------------------------------------------------------------- */

export class HisDischargeEventDto {
  @IsString()
  @MaxLength(128)
  eventId!: string;

  @ValidateNested()
  @Type(() => HisPatientIdentifierDto)
  patient!: HisPatientIdentifierDto;

  @IsDateString()
  dischargeTime!: string;

  @IsOptional()
  @IsDateString()
  admissionTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  diagnosisIcd?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  diagnosisText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  summary?: string;
}

/* -------------------------------------------------------------------------- */
/*  2. 处方下达 (HIS → 网关)                                                   */
/* -------------------------------------------------------------------------- */

export class HisPrescriptionEventDto {
  @IsString()
  @MaxLength(128)
  eventId!: string;

  @ValidateNested()
  @Type(() => HisPatientIdentifierDto)
  patient!: HisPatientIdentifierDto;

  @IsString()
  @MaxLength(128)
  drugName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  drugCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  dosage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  frequency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  instructions?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

/* -------------------------------------------------------------------------- */
/*  3. 检验结果 (LIS → 网关)                                                   */
/* -------------------------------------------------------------------------- */

export class HisLabResultEventDto {
  @IsString()
  @MaxLength(128)
  eventId!: string;

  @ValidateNested()
  @Type(() => HisPatientIdentifierDto)
  patient!: HisPatientIdentifierDto;

  @IsString()
  @MaxLength(64)
  itemCode!: string;

  @IsString()
  @MaxLength(128)
  itemName!: string;

  @IsNumber()
  value!: number;

  @IsString()
  @MaxLength(16)
  unit!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  referenceRange?: string;

  @IsOptional()
  @IsIn(['H', 'L', 'N', 'HH', 'LL', 'A'])
  abnormalFlag?: 'H' | 'L' | 'N' | 'HH' | 'LL' | 'A';

  @IsDateString()
  reportedAt!: string;
}

/* -------------------------------------------------------------------------- */
/*  4. 体征记录 (病房 / 自测设备 → 网关)                                       */
/* -------------------------------------------------------------------------- */

export class HisVitalEventDto {
  @IsString()
  @MaxLength(128)
  eventId!: string;

  @ValidateNested()
  @Type(() => HisPatientIdentifierDto)
  patient!: HisPatientIdentifierDto;

  /** 体征类型代码，例如 "BP_SYSTOLIC" / "BP_DIASTOLIC" / "BLOOD_GLUCOSE" / "SPO2" / "HEART_RATE" / "BODY_TEMP" */
  @IsString()
  @MaxLength(32)
  vitalType!: string;

  @IsNumber()
  value!: number;

  @IsString()
  @MaxLength(16)
  unit!: string;

  @IsDateString()
  measuredAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceId?: string;
}

/* -------------------------------------------------------------------------- */
/*  5. 患者基本信息变更 (HIS → 网关)                                           */
/* -------------------------------------------------------------------------- */

export class HisPatientUpdatedEventDto {
  @IsString()
  @MaxLength(128)
  eventId!: string;

  @ValidateNested()
  @Type(() => HisPatientIdentifierDto)
  patient!: HisPatientIdentifierDto;

  @IsString()
  @MaxLength(64)
  name!: string;

  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'UNKNOWN', 'M', 'F', '1', '2', '0'])
  gender?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  address?: string;
}

/* -------------------------------------------------------------------------- */
/*  6. 就诊事件 (门诊 / 急诊 / 住院 → 网关)                                    */
/* -------------------------------------------------------------------------- */

export class HisEncounterEventDto {
  @IsString()
  @MaxLength(128)
  eventId!: string;

  @ValidateNested()
  @Type(() => HisPatientIdentifierDto)
  patient!: HisPatientIdentifierDto;

  @IsIn(['OUTPATIENT', 'INPATIENT', 'EMERGENCY', 'CHECKUP'])
  encounterType!: 'OUTPATIENT' | 'INPATIENT' | 'EMERGENCY' | 'CHECKUP';

  @IsDateString()
  startedAt!: string;

  @IsOptional()
  @IsDateString()
  endedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  doctor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  chiefComplaint?: string;

  @IsOptional()
  @IsObject()
  extra?: Record<string, unknown>;
}
