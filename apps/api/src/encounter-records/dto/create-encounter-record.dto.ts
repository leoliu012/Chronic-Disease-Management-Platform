import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { EncounterType } from '@prisma/client';

export class CreateEncounterRecordDto {
  @IsString()
  patientId: string;

  @IsOptional()
  @IsString()
  hospitalPatientId?: string;

  @IsOptional()
  @IsString()
  externalVisitId?: string;

  @IsEnum(EncounterType)
  visitType: EncounterType;

  @IsOptional()
  @IsString()
  departmentName?: string;

  @IsOptional()
  @IsString()
  doctorName?: string;

  @IsDateString()
  visitTime: string;

  @IsOptional()
  @IsString()
  chiefComplaint?: string;

  @IsOptional()
  @IsString()
  diagnosisSummary?: string;

  @IsOptional()
  @IsString()
  treatmentSummary?: string;

  @IsOptional()
  @IsString()
  sourceSystem?: string;

  @IsOptional()
  rawData?: any;
}
