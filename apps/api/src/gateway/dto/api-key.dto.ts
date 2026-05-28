/**
 * api-key.dto.ts — gateway-production-hardening
 */

import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class IssueApiKeyDto {
  @IsString()
  @MaxLength(64)
  sourceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  /**
   * CIDR 字符串数组. 留空 = 不限制 IP (仍需正确 key);
   * 强烈建议在生产环境为每个医院 / 系统填上对应的内网网段.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  ipAllowlist?: string[];
}

export class RevokeApiKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListApiKeysQueryDto {
  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsBoolean()
  includeRevoked?: boolean;
}
