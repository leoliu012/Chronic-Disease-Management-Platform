import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreatePatientBindingRequestDto {
  @IsString()
  @MaxLength(128)
  demoOpenId!: string;

  @IsString()
  @MaxLength(32)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  hospitalPatientId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/)
  idCardLast4?: string;
}
