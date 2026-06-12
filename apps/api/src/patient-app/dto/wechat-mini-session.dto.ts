import { IsString, MaxLength } from 'class-validator';

export class WechatMiniSessionDto {
  @IsString()
  @MaxLength(256)
  code!: string;
}
