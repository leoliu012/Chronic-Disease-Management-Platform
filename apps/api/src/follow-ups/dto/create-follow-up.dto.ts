import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateFollowUpDto {
  @IsString()
  followUpType!: string;

  @IsDateString()
  followUpTime!: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  result?: string;

  @IsOptional()
  @IsString()
  suggestion?: string;

  @IsOptional()
  @IsDateString()
  nextFollowUpTime?: string;

  @IsOptional()
  @IsString()
  operatorId?: string;
}
