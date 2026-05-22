import { IsDateString, IsOptional, IsString } from 'class-validator';

export class UpdateFollowUpDto {
  @IsOptional()
  @IsString()
  followUpType?: string;

  @IsOptional()
  @IsDateString()
  followUpTime?: string;

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

  @IsOptional()
  @IsString()
  editReason?: string;

  @IsOptional()
  @IsString()
  electronicSignature?: string;
}
