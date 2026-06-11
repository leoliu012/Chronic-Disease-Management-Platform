import { IsOptional, IsString } from 'class-validator';

export class ReviewRuleVersionDto {
  @IsOptional()
  @IsString()
  note?: string;
}
