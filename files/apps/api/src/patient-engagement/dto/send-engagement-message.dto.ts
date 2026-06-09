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
  hospitalTenantId?: string;

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

  // patient_engagement_v3_2 — pagination
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}


