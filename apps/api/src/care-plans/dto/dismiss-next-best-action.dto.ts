import { IsString, MinLength } from 'class-validator';

export class DismissNextBestActionDto {
  @IsString()
  @MinLength(2)
  reason!: string;
}
