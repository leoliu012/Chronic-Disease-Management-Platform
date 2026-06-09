import { IsOptional, IsString } from 'class-validator';

export class HandleRiskAlertDto {
  @IsOptional()
  @IsString()
  handlingNote?: string;
}
