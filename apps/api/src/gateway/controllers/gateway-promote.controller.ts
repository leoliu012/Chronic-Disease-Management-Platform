/**
 * gateway-promote.controller.ts
 *
 * 给管理员看的「网关 → 主数据 入库 (promote)」工作台。
 *
 *   GET  /gateway/promote/queue                    — 列出 PENDING / CONFLICT / FAILED / PROMOTED 队列
 *   GET  /gateway/promote/queue/summary            — 各 promote 状态的计数（首页 KPI）
 *   POST /gateway/promote/:recordId                — 单条 promote（可带 forceOverwrite）
 *   POST /gateway/promote/batch                    — 批量 promote
 *   POST /gateway/promote/sources/:id/auto-promote — 切换某个 IntegrationSource 的 autoPromote 开关
 *
 * 全部走 JwtAuthGuard + RolesGuard，仅 ADMIN / MANAGER。
 * 故意 不 @Public() —— 不允许外部系统直接触发入库。
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  IntegrationPromotionStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../security/audit.service';
import type { RequestUser } from '../../security/request-user.type';
import { Roles } from '../../security/roles.decorator';
import {
  PromoteBatchDto,
  PromoteRecordDto,
  RejectConflictDto,
  ToggleAutoPromoteDto,
} from '../dto/promote-record.dto';
import { GATEWAY_SOURCE_CODE } from '../gateway.constants';
import { IntegrationPromoteService } from '../services/integration-promote.service';

type RequestWithUser = {
  user?: RequestUser;
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string };
};

function getIp(r: RequestWithUser) {
  const fwd = r.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : fwd || r.socket.remoteAddress)?.toString();
}

const PROMOTION_STATUS_VALUES = Object.values(IntegrationPromotionStatus) as string[];
const GATEWAY_SOURCE_CODES = Object.values(GATEWAY_SOURCE_CODE) as string[];

function parseLimit(value: string | undefined, fallback: number, max: number) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

/**
 * conflict-resolution-ux-v1 — 谁能干什么：
 *
 *   Read（看队列、看冲突详情）
 *     → ADMIN / MANAGER / DOCTOR / NURSE
 *     护士最了解患者，看到冲突队列才有判断依据；之前限定 ADMIN/MANAGER
 *     等于把冲突藏起来。
 *
 *   单条 promote（包括「强制覆盖 (forceOverwrite)」和「驳回上游」）
 *     → ADMIN / MANAGER / DOCTOR / NURSE
 *     每次操作都会落 AuditLog，operatorId 可追溯。
 *
 *   批量 promote、autoPromote 开关
 *     → ADMIN / MANAGER
 *     这两个是配置类、影响面大的操作，临床角色暂不开放。
 */
@Controller('gateway/promote')
export class GatewayPromoteController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promoter: IntegrationPromoteService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * 队列总览：四种 promote 状态各有多少条；按通道也再拆一份。
   */
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.DOCTOR, UserRole.NURSE)
  @Get('queue/summary')
  async summary() {
    const grouped = await this.prisma.integrationSyncRecord.groupBy({
      by: ['promotionStatus'],
      _count: { _all: true },
      where: { source: { code: { in: GATEWAY_SOURCE_CODES } } },
    });
    const counts: Record<string, number> = {};
    for (const s of PROMOTION_STATUS_VALUES) counts[s as string] = 0;
    for (const row of grouped) counts[row.promotionStatus] = row._count._all;

    const bySource = await this.prisma.integrationSyncRecord.groupBy({
      by: ['sourceId', 'promotionStatus'],
      _count: { _all: true },
      where: { source: { code: { in: GATEWAY_SOURCE_CODES } } },
    });
    const sources = await this.prisma.integrationSource.findMany({
      where: { code: { in: GATEWAY_SOURCE_CODES } },
      orderBy: { code: 'asc' },
    });

    return {
      counts,
      sources: sources.map((s) => {
        const sourceCounts: Record<string, number> = {};
        for (const status of PROMOTION_STATUS_VALUES) sourceCounts[status as string] = 0;
        for (const row of bySource.filter((r) => r.sourceId === s.id)) {
          sourceCounts[row.promotionStatus] = row._count._all;
        }
        return {
          id: s.id,
          code: s.code,
          name: s.name,
          autoPromote: s.autoPromote,
          counts: sourceCounts,
        };
      }),
    };
  }

  /**
   * 队列详情：
   *   GET /gateway/promote/queue?status=PENDING&limit=50&sourceId=...
   *
   * 默认列出 PENDING 队列，按时间正序（先到先入库）。
   * CONFLICT / FAILED 队列按 createdAt desc，先看最近出问题的。
   */
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.DOCTOR, UserRole.NURSE)
  @Get('queue')
  async queue(
    @Query('status') statusRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('sourceId') sourceId?: string,
  ) {
    const status =
      statusRaw && PROMOTION_STATUS_VALUES.includes(statusRaw)
        ? (statusRaw as IntegrationPromotionStatus)
        : IntegrationPromotionStatus.PENDING;
    const limit = parseLimit(limitRaw, 50, 500);
    const where: Prisma.IntegrationSyncRecordWhereInput = {
      promotionStatus: status,
      source: { code: { in: GATEWAY_SOURCE_CODES } },
      ...(sourceId ? { sourceId } : {}),
    };
    const items = await this.prisma.integrationSyncRecord.findMany({
      where,
      orderBy: { createdAt: status === IntegrationPromotionStatus.PENDING ? 'asc' : 'desc' },
      take: limit,
      include: { source: true, batch: true },
    });
    return { status, total: items.length, items };
  }

  /**
   * 结构化冲突详情（conflict-resolution-ux-v1）。
   *
   * 前端在用户点击「查看详情」时调用，返回逐字段对比，
   * 不必再让人去解析 promotionMessage 的字符串。
   */
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.DOCTOR, UserRole.NURSE)
  @Get(':recordId/conflict')
  async getConflict(@Param('recordId') recordId: string) {
    return this.promoter.describeConflict(recordId);
  }

  /**
   * 单条 promote — 包括「强制覆盖」分支。
   * 临床角色可以执行，操作人写入 AuditLog。
   */
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.DOCTOR, UserRole.NURSE)
  @Post(':recordId')
  @HttpCode(HttpStatus.OK)
  async promoteOne(
    @Param('recordId') recordId: string,
    @Body() dto: PromoteRecordDto,
    @Req() req: RequestWithUser,
  ) {
    const result = await this.promoter.promoteRecord(recordId, {
      forceOverwrite: dto?.forceOverwrite === true,
      operatorId: req.user?.id,
    });

    if (req.user) {
      await this.auditService.record({
        user: req.user,
        action: dto?.forceOverwrite ? 'GATEWAY_PROMOTE_RECORD_FORCE' : 'GATEWAY_PROMOTE_RECORD',
        targetType: 'IntegrationSyncRecord',
        targetId: recordId,
        ipAddress: getIp(req),
        afterData: result,
      });
    }
    return result;
  }

  /**
   * 保留本地、驳回上游变更。
   * 临床角色可以执行，操作人写入 AuditLog。
   */
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.DOCTOR, UserRole.NURSE)
  @Post(':recordId/reject')
  @HttpCode(HttpStatus.OK)
  async rejectConflict(
    @Param('recordId') recordId: string,
    @Body() dto: RejectConflictDto,
    @Req() req: RequestWithUser,
  ) {
    const result = await this.promoter.rejectConflict(recordId, {
      operatorId: req.user?.id,
      operatorName: req.user?.displayName ?? req.user?.username,
      note: dto?.note,
    });

    if (req.user) {
      await this.auditService.record({
        user: req.user,
        action: 'GATEWAY_PROMOTE_REJECT_CONFLICT',
        targetType: 'IntegrationSyncRecord',
        targetId: recordId,
        ipAddress: getIp(req),
        afterData: { ...result, note: dto?.note ?? null },
      });
    }
    return result;
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('batch')
  @HttpCode(HttpStatus.OK)
  async promoteBatch(@Body() dto: PromoteBatchDto, @Req() req: RequestWithUser) {
    let ids = dto?.recordIds ?? [];
    if (ids.length === 0) {
      ids = await this.promoter.listPendingRecordIds(200, dto?.sourceId);
    }
    const result = await this.promoter.promoteBatch(ids, {
      forceOverwrite: dto?.forceOverwrite === true,
      operatorId: req.user?.id,
    });

    if (req.user) {
      await this.auditService.record({
        user: req.user,
        action: 'GATEWAY_PROMOTE_BATCH',
        targetType: 'IntegrationSyncBatch',
        ipAddress: getIp(req),
        afterData: {
          total: result.total,
          promoted: result.promoted,
          conflicts: result.conflicts,
          failed: result.failed,
        },
      });
    }
    return result;
  }

  /**
   * 切换某个 IntegrationSource 的 autoPromote 开关。
   * 之后该来源新到事件会在审计写入后立刻 promote。
   * 仅 ADMIN/MANAGER —— 这是配置操作，影响后续所有新事件。
   */
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('sources/:id/auto-promote')
  @HttpCode(HttpStatus.OK)
  async toggleAutoPromote(
    @Param('id') id: string,
    @Body() dto: ToggleAutoPromoteDto,
    @Req() req: RequestWithUser,
  ) {
    const existing = await this.prisma.integrationSource.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Integration source not found');
    const updated = await this.prisma.integrationSource.update({
      where: { id },
      data: { autoPromote: dto.autoPromote === true },
    });
    if (req.user) {
      await this.auditService.record({
        user: req.user,
        action: 'GATEWAY_TOGGLE_AUTO_PROMOTE',
        targetType: 'IntegrationSource',
        targetId: id,
        ipAddress: getIp(req),
        beforeData: { autoPromote: existing.autoPromote },
        afterData: { autoPromote: updated.autoPromote },
      });
    }
    return { id: updated.id, code: updated.code, autoPromote: updated.autoPromote };
  }
}
