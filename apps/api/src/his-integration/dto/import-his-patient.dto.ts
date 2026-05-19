import { IsOptional, IsString } from 'class-validator';

export class ImportHisPatientDto {
  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  hospitalPatientId?: string;
}
