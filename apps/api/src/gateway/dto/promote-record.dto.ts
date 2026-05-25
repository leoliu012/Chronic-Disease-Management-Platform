/**
 * promote-record.dto.ts — gateway-promote-pipeline / conflict-resolution-ux-v1
 */

import { IsArray, IsBoolean, IsOptional, IsString, MaxLength, ArrayMaxSize } from 'class-validator';

export class PromoteRecordDto {
  /** 强制覆盖冲突 — 由 UI「强制采纳上游」按钮触发 */
  @IsOptional()
  @IsBoolean()
  forceOverwrite?: boolean;
}

export class PromoteBatchDto {
  /**
   * 显式给出要 promote 的 record id 列表（最多 200 条）；
   * 留空时会按 createdAt asc 自动取所有 PENDING 状态的记录（限 200 条）。
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  recordIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceId?: string;

  @IsOptional()
  @IsBoolean()
  forceOverwrite?: boolean;
}

export class ToggleAutoPromoteDto {
  @IsBoolean()
  autoPromote!: boolean;
}

/**
 * 「保留本地、驳回上游变更」携带的可选备注（写入 promotionMessage 供审计追踪）。
 * 例如：「上游 LIS 是错绑的另一个张三，已电话核实」。
 */
export class RejectConflictDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
