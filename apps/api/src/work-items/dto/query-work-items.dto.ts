import { IsIn, IsOptional, IsString } from 'class-validator';

export const WORK_ITEM_BUCKETS = [
  'ALL',
  'CRITICAL_RISK',
  'OVERDUE',
  'PHONE_DUE_TODAY',
  'FAILED_CONTACT_RETRY',
  'REFERRAL_CONFIRMATION',
  'SUBMISSION_REVIEW',
  'GATEWAY_CONFLICT',
] as const;

export type WorkItemBucket = (typeof WORK_ITEM_BUCKETS)[number];

export class QueryWorkItemsDto {
  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
  hospitalTenantId?: string;

  @IsOptional()
  @IsIn(['OPEN', 'ALL'])
  status?: 'OPEN' | 'ALL';

  @IsOptional()
  @IsIn(WORK_ITEM_BUCKETS)
  bucket?: WorkItemBucket;
}
