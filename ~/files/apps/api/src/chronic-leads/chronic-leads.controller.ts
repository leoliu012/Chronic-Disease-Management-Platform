/**
 * chronic-leads.controller.ts —— 高危慢病线索池 HTTP 端口
 *
 * 接口契约严格对齐前端 ChronicLeadInvitationPage.tsx。
 *
 *   GET    /chronic-leads                       —— 管理员审计/待迁移线索列表
 *   POST   /chronic-leads/:id/contact           —— 「已联系」
 *   POST   /chronic-leads/:id/defer             —— 「暂缓」
 *   POST   /chronic-leads/:id/reject            —— 「拒绝」
 *   POST   /chronic-leads/:id/sign              —— **唯一升档为 Patient 的入口**
 *
 * Clinical access v4: ChronicLead 尚未具备 hospitalTenantId/source-tenant 映射。
 * 在迁移完成前，员工端接口 fail closed 为 ADMIN-only，避免多医院线索池串院。
 */

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ChronicLeadsService } from './chronic-leads.service';
import { QueryChronicLeadsDto } from './dto/query-chronic-leads.dto';
import { SignChronicLeadDto } from './dto/sign-chronic-lead.dto';
import { NoteChronicLeadDto } from './dto/note-chronic-lead.dto';
import { RejectChronicLeadDto } from './dto/reject-chronic-lead.dto';
import { CurrentUser } from '../security/current-user.decorator';
import { Roles } from '../security/roles.decorator';
import type { RequestUser } from '../security/request-user.type';

type IpRequest = {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
};

function getIpAddress(req: IpRequest) {
  const forwardedFor = req.headers['x-forwarded-for'];
  return (
    Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || req.socket?.remoteAddress
  )?.toString();
}

@Controller('chronic-leads')
export class ChronicLeadsController {
  constructor(private readonly chronicLeadsService: ChronicLeadsService) {}

  @Roles(UserRole.ADMIN)
  @Get()
  findAll(@Query() query: QueryChronicLeadsDto) {
    return this.chronicLeadsService.findAll(query);
  }

  @Roles(UserRole.ADMIN)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.chronicLeadsService.findOne(id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/contact')
  contact(
    @Param('id') id: string,
    @Body() dto: NoteChronicLeadDto,
    @CurrentUser() user: RequestUser,
    @Req() req: IpRequest,
  ) {
    return this.chronicLeadsService.contact(id, dto, user, getIpAddress(req));
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/defer')
  defer(
    @Param('id') id: string,
    @Body() dto: NoteChronicLeadDto,
    @CurrentUser() user: RequestUser,
    @Req() req: IpRequest,
  ) {
    return this.chronicLeadsService.defer(id, dto, user, getIpAddress(req));
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectChronicLeadDto,
    @CurrentUser() user: RequestUser,
    @Req() req: IpRequest,
  ) {
    return this.chronicLeadsService.reject(id, dto, user, getIpAddress(req));
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/sign')
  sign(
    @Param('id') id: string,
    @Body() dto: SignChronicLeadDto,
    @CurrentUser() user: RequestUser,
    @Req() req: IpRequest,
  ) {
    return this.chronicLeadsService.sign(id, dto, user, getIpAddress(req));
  }
}


