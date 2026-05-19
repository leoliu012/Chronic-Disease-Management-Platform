import { IsEnum, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { DataSource, Prisma } from '@prisma/client';

export class CreateQuestionnaireResultDto {
  @IsString()
  questionnaireType!: string;

  @IsInt()
  @Min(0)
  @Max(10)
  score!: number;

  @IsOptional()
  @IsObject()
  answers?: Prisma.InputJsonObject;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsEnum(DataSource)
  dataSource?: DataSource;
}
