import { IsOptional, IsString } from 'class-validator';

export class CreateRuleVersionDto {
  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
