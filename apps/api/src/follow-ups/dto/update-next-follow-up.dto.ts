import { IsISO8601, IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * DTO for editing / canceling the currently active scheduled "下次随访时间".
 *
 * Pass `nextFollowUpTime` as an ISO-8601 string to set/move the schedule.
 * Pass `nextFollowUpTime: null` to cancel the schedule.
 */
export class UpdateNextFollowUpDto {
  // Allow either an ISO-8601 string OR null. ValidateIf skips validation when the
  // value is null so the cancel path works through `whitelist: true, transform: true`
  // global ValidationPipe.
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsISO8601()
  nextFollowUpTime!: string | null;

  @IsOptional()
  @IsString()
  editReason?: string;

  @IsOptional()
  @IsString()
  electronicSignature?: string;
}
