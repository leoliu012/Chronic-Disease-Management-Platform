import { IsNumber, IsOptional, IsString } from 'class-validator';

export class SimulateRuleDto {
  @IsString()
  vitalType!: string;

  @IsNumber()
  value!: number;

  @IsOptional()
  @IsString()
  unit?: string;
}
