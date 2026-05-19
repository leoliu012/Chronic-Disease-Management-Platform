import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { HospitalVisitReminderStatus, UserRole } from '@prisma/client';
import { CurrentUser } from '../security/current-user.decorator';
import { Roles } from '../security/roles.decorator';
import type { RequestUser } from '../security/request-user.type';
import { CreateHospitalVisitReminderDto } from './dto/create-hospital-visit-reminder.dto';
import { UpdateHospitalVisitReminderDto } from './dto/update-hospital-visit-reminder.dto';
import { HospitalVisitRemindersService } from './hospital-visit-reminders.service';

type IpRequest = {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
};

function getIpAddress(req: IpRequest) {
  const forwardedFor = req.headers['x-forwarded-for'];
  return (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || req.socket?.remoteAddress)?.toString();
}

@Controller()
export class HospitalVisitRemindersController {
  constructor(private readonly remindersService: HospitalVisitRemindersService) {}

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('hospital-visit-reminders')
  findAll(@Query('status') status?: HospitalVisitReminderStatus) {
    return this.remindersService.findAll(status);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('patients/:patientId/hospital-visit-reminders/active')
  findActiveByPatient(@Param('patientId') patientId: string) {
    return this.remindersService.findActiveByPatient(patientId);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('patients/:patientId/hospital-visit-reminders')
  create(
    @Param('patientId') patientId: string,
    @Body() dto: CreateHospitalVisitReminderDto,
    @CurrentUser() user: RequestUser,
    @Req() req: IpRequest,
  ) {
    return this.remindersService.create(patientId, dto, user, getIpAddress(req));
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Patch('hospital-visit-reminders/:id/arrived')
  markArrived(
    @Param('id') id: string,
    @Body() dto: UpdateHospitalVisitReminderDto,
    @CurrentUser() user: RequestUser,
    @Req() req: IpRequest,
  ) {
    return this.remindersService.markArrived(id, dto, user, getIpAddress(req));
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Patch('hospital-visit-reminders/:id/no-show')
  markNoShow(
    @Param('id') id: string,
    @Body() dto: UpdateHospitalVisitReminderDto,
    @CurrentUser() user: RequestUser,
    @Req() req: IpRequest,
  ) {
    return this.remindersService.markNoShow(id, dto, user, getIpAddress(req));
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Patch('hospital-visit-reminders/:id/refused')
  markRefused(
    @Param('id') id: string,
    @Body() dto: UpdateHospitalVisitReminderDto,
    @CurrentUser() user: RequestUser,
    @Req() req: IpRequest,
  ) {
    return this.remindersService.markRefused(id, dto, user, getIpAddress(req));
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Patch('hospital-visit-reminders/:id/revoke')
  revoke(
    @Param('id') id: string,
    @Body() dto: UpdateHospitalVisitReminderDto,
    @CurrentUser() user: RequestUser,
    @Req() req: IpRequest,
  ) {
    return this.remindersService.revoke(id, dto, user, getIpAddress(req));
  }
}
