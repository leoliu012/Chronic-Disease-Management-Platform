import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class HandleRiskAlertDto {
  @IsOptional()
  @IsString()
  handledBy?: string;

  @IsOptional()
  @IsString()
  handlingNote?: string;

  @IsOptional()
  @IsBoolean()
  syncRelatedTasks?: boolean;
}


