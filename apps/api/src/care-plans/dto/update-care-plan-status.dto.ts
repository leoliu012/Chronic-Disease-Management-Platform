import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateCarePlanStatusDto {
  @IsIn(['ACTIVE', 'PAUSED', 'COMPLETED'])
  status!: 'ACTIVE' | 'PAUSED' | 'COMPLETED';

  @IsOptional()
  @IsString()
  reason?: string;
}
