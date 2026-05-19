import { IsString } from 'class-validator';

export class QueryNurseDashboardDto {
  @IsString()
  nurseId!: string;
}
