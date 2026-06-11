import { IsArray, IsOptional, IsString } from 'class-validator';

export class EnrollCarePlanDto {
  @IsOptional()
  @IsString()
  cohort?: string;

  @IsOptional()
  @IsArray()
  goals?: unknown[];

  @IsOptional()
  @IsArray()
  activeInterventions?: unknown[];

  @IsOptional()
  @IsString()
  owningTeamId?: string;
}
