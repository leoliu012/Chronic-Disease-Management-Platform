import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateHospitalVisitReminderDto {
  @IsOptional()
  @IsString()
  sourceRiskAlertId?: string;

  @IsOptional()
  @IsString()
  sourceTaskId?: string;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  electronicSignature?: string;

  /** Persisted operational SLA for the follow-up task. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  followUpDueWithinHours?: number;

  /** Persisted SLA after a patient reports cannot-visit / refusal. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  retryDueWithinHours?: number;
}
