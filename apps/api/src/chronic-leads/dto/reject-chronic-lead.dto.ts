import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectChronicLeadDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectReason?: string;
}
