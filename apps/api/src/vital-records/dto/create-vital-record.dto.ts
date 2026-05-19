import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { DataSource } from '@prisma/client';

export class CreateVitalRecordDto {
  @IsString()
  type!: string;

  @IsNumber()
  value!: number;

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
