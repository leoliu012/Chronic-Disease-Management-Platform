import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateHospitalMedicationDto {
  @IsString()
  patientId: string;

  @IsOptional()
  @IsString()
  externalOrderId?: string;

  @IsOptional()
  @IsString()
  encounterRecordId?: string;

  @IsString()
  medicationName: string;

  @IsString()
  dosage: string;

  @IsString()
  frequency: string;

  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @IsString()
  duration?: string;

  @IsOptional()
  @IsString()
  prescribedBy?: string;

  @IsDateString()
  prescribedAt: string;

  @IsOptional()
  @IsString()
  sourceSystem?: string;

  @IsOptional()
  rawData?: any;
}
