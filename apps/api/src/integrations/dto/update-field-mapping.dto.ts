import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateFieldMappingDto {
  @IsOptional()
  @IsString()
  localField?: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  transformRule?: string;

  @IsOptional()
  @IsString()
  defaultValue?: string;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
