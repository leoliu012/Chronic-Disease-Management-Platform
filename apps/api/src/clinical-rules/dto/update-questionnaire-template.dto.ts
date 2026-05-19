import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateQuestionnaireTemplateDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  scoringRule?: unknown;

  @IsOptional()
  riskBands?: unknown;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
