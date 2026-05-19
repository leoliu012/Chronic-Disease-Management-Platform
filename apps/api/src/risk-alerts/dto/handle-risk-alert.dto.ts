import { IsOptional, IsString } from 'class-validator';

export class HandleRiskAlertDto {
  @IsOptional()
  @IsString()
  handledBy?: string;

  @IsOptional()
  @IsString()
  handlingNote?: string;
}
