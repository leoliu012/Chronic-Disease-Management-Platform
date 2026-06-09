import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { Gender } from '@prisma/client';

export class CreatePatientDto {
  @IsOptional()
  @IsString()
  hospitalTenantId?: string;

  @IsOptional()
  @IsString()
  hospitalPatientId?: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  idCardNo?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  responsibleDoctorId?: string;

  @IsOptional()
  @IsString()
  responsibleNurseId?: string;
}


