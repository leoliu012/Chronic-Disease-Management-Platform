import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTaskProcessingEventDto {
  @IsString()
  @MaxLength(80)
  eventType!: string;

  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sourceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  operatorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  electronicSignature?: string;
}
