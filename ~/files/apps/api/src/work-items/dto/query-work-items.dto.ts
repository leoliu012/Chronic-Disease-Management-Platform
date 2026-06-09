import { IsIn, IsOptional, IsString } from 'class-validator';

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
}
