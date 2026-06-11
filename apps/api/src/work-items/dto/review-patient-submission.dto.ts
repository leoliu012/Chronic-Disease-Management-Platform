import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewPatientSubmissionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
