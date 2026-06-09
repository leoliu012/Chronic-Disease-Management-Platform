import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { TaskStatus } from '@prisma/client';

export class CompleteTaskProcessingDto {
  @IsString()
  @MaxLength(2000)
  summary!: string;

  @IsString()
  @MaxLength(120)
  electronicSignature!: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

}
