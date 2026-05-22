import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StartTaskProcessingDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  electronicSignature?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  operatorId?: string;
}
