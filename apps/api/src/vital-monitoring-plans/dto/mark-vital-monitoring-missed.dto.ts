import { IsDateString, IsOptional, IsString } from 'class-validator';

export class MarkVitalMonitoringMissedDto {
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
