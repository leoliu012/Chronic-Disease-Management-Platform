import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateMedicationCheckInDto {
  @IsBoolean()
  taken!: boolean;

  @IsOptional()
  @IsDateString()
  checkedAt?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
