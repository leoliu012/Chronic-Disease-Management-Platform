/**
 * audit-report-query.dto.ts — gateway-production-hardening
 *
 * 查询审计报表的过滤参数. 三个字段都可选:
 *   - from / to: ISO 时间窗 (默认最近 7 天)
 *   - sourceId : 单一来源
 */

import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class AuditReportQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceId?: string;
}
