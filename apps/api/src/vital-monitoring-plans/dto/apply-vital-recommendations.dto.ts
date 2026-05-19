import { IsBoolean, IsOptional } from 'class-validator';

export class ApplyVitalRecommendationsDto {
  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;
}
