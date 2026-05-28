import { IsOptional, IsString } from 'class-validator';

export class ResendEngagementMessageDto {
  @IsOptional()
  @IsString()
  preferredChannel?: string;
}

export class MarkManualSentDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class QueryMessagesDto {
  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  messageType?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
