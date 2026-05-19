import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { FollowUpsService } from './follow-ups.service';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';
import { Roles } from '../security/roles.decorator';

@Controller()
export class FollowUpsController {
  constructor(private readonly followUpsService: FollowUpsService) {}

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Post('patients/:patientId/follow-ups')
  create(
    @Param('patientId') patientId: string,
    @Body() dto: CreateFollowUpDto,
  ) {
    return this.followUpsService.create(patientId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('patients/:patientId/follow-ups')
  findByPatient(@Param('patientId') patientId: string) {
    return this.followUpsService.findByPatient(patientId);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('follow-ups/:id')
  findOne(@Param('id') id: string) {
    return this.followUpsService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Delete('follow-ups/:id')
  remove(@Param('id') id: string) {
    return this.followUpsService.remove(id);
  }
}
