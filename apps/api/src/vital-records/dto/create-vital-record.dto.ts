import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  ValidateIf,
  IsString,
} from 'class-validator';
import { DataSource } from '@prisma/client';

export class CreateVitalRecordDto {
  @IsString()
  type!: string;

  @ValidateIf((dto) => dto.type !== 'BLOOD_PRESSURE')
  @IsNumber()
  value?: number;

  @ValidateIf((dto) => dto.type === 'BLOOD_PRESSURE')
  @IsNumber()
  systolicValue?: number;

  @ValidateIf((dto) => dto.type === 'BLOOD_PRESSURE')
  @IsNumber()
  diastolicValue?: number;

  @IsString()
  unit!: string;

  @IsDateString()
  measuredAt!: string;

  @IsOptional()
  @IsEnum(DataSource)
  dataSource?: DataSource;

  @IsOptional()
  @IsBoolean()
  isAbnormal?: boolean;

  @IsOptional()
  @IsString()
  monitoringPlanId?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}


