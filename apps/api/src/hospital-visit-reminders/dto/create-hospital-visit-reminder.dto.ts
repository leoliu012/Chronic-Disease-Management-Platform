import { IsOptional, IsString } from 'class-validator';

export class CreateHospitalVisitReminderDto {
  @IsOptional()
  @IsString()
  sourceRiskAlertId?: string;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  electronicSignature?: string;
}
