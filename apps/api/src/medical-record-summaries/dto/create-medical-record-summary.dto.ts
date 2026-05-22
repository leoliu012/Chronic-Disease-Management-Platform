import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { MedicalRecordType } from '@prisma/client';

export class CreateMedicalRecordSummaryDto {
  @IsString()
  patientId: string;

  @IsOptional()
  @IsString()
  externalRecordId?: string;

  @IsEnum(MedicalRecordType)
  recordType: MedicalRecordType;

  @IsDateString()
  recordTime: string;

  @IsOptional()
  @IsString()
  departmentName?: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  diagnosisText?: string;

  @IsOptional()
  @IsString()
  treatmentPlan?: string;

  @IsOptional()
  @IsString()
  doctorAdvice?: string;

  @IsOptional()
  @IsString()
  sourceSystem?: string;

  @IsOptional()
  rawData?: any;
}
