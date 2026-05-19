import { IsOptional, IsString } from 'class-validator';

export class QueryVitalRecordsDto {
  @IsOptional()
  @IsString()
  type?: string;
}
