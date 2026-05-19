import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectPatientBindingDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  rejectReason?: string;
}
