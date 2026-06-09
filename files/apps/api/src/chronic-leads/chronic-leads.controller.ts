/**
 * chronic-leads.controller.ts —— 高危慢病线索池 HTTP 端口
 *
 * 接口契约严格对齐前端 ChronicLeadInvitationPage.tsx。
 *
 *   GET    /chronic-leads                       —— 护士工作台拉取待邀约列表
 *   POST   /chronic-leads/:id/contact           —— 「已联系」
 *   POST   /chronic-leads/:id/defer             —— 「暂缓」
 *   POST   /chronic-leads/:id/reject            —— 「拒绝」
 *   POST   /chronic-leads/:id/sign              —— **唯一升档为 Patient 的入口**
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

  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.MANAGER)
  @Get()
  findAll(
    @Query() query: QueryChronicLeadsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.chronicLeadsService.findAll(query, user);
  }

  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.MANAGER)
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.chronicLeadsService.findOne(id, user);
  }

  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
  @Post(':id/contact')
  contact(
    @Param('id') id: string,
    @Body() dto: NoteChronicLeadDto,
    @CurrentUser() user: RequestUser,
    @Req() req: IpRequest,
  ) {
    return this.chronicLeadsService.contact(id, dto, user, getIpAddress(req));
  }

  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
  @Post(':id/defer')
  defer(
    @Param('id') id: string,
    @Body() dto: NoteChronicLeadDto,
    @CurrentUser() user: RequestUser,
    @Req() req: IpRequest,
  ) {
    return this.chronicLeadsService.defer(id, dto, user, getIpAddress(req));
  }

  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectChronicLeadDto,
    @CurrentUser() user: RequestUser,
    @Req() req: IpRequest,
  ) {
    return this.chronicLeadsService.reject(id, dto, user, getIpAddress(req));
  }

  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
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


