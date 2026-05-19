import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PatientDemoLoginDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  demoOpenId?: string;
}
