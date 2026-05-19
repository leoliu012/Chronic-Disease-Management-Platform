import { IsOptional, IsString } from 'class-validator';

export class UpdateHospitalVisitReminderDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  electronicSignature?: string;
}
