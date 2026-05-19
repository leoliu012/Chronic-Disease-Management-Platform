import { IsIn, IsOptional, IsString } from 'class-validator';

export class QueryWorkItemsDto {
  @IsOptional()
  @IsString()
  nurseId?: string;

  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsIn(['OPEN', 'ALL'])
  status?: 'OPEN' | 'ALL';
}

