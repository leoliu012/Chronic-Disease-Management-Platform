import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TaskStatus } from '@prisma/client';

export class QueryTasksDto {
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsString()
  type?: string;


  @IsOptional()
  @IsString()
  hospitalTenantId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;
}


