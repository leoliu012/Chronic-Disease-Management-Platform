import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { TaskStatus } from '@prisma/client';

export class UpdateTaskStatusDto {
  @IsEnum(TaskStatus)
  status!: TaskStatus;

  @IsOptional()
  @IsBoolean()
  syncRelatedAlert?: boolean;

  @IsOptional()
  @IsString()
  relatedAlertHandlingNote?: string;
}


