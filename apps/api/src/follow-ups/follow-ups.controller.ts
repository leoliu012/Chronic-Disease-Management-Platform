import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { FollowUpsService, type FollowUpListQuery } from './follow-ups.service';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';
import { UpdateFollowUpDto } from './dto/update-follow-up.dto';
import { UpdateNextFollowUpDto } from './dto/update-next-follow-up.dto';
import { CurrentUser } from '../security/current-user.decorator';
import type { RequestUser } from '../security/request-user.type';
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
  findByPatient(
    @Param('patientId') patientId: string,
    @Query() query: FollowUpListQuery,
  ) {
    return this.followUpsService.findByPatient(patientId, query);
  }

  /**
   * Return the patient's active scheduled "下次随访时间" along with the
   * reminder task (if any) generated for it. The active record is defined
   * as the most-recent FollowUpRecord with a non-null nextFollowUpTime.
   */
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('patients/:patientId/follow-ups/active-next-follow-up')
  getActiveNextFollowUp(@Param('patientId') patientId: string) {
    return this.followUpsService.getActiveScheduledNextFollowUp(patientId);
  }

  /**
   * Edit or cancel the active scheduled "下次随访时间" without creating a
   * new FollowUpRecord. The cancel path is `nextFollowUpTime: null`.
   */
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Patch('patients/:patientId/follow-ups/active-next-follow-up')
  updateActiveNextFollowUp(
    @Param('patientId') patientId: string,
    @Body() dto: UpdateNextFollowUpDto,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.followUpsService.updateActiveScheduledNextFollowUp(patientId, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('follow-ups/:id')
  findOne(@Param('id') id: string) {
    return this.followUpsService.findOne(id);
  }


  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Patch('follow-ups/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFollowUpDto,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.followUpsService.update(id, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @Delete('follow-ups/:id')
  remove(@Param('id') id: string) {
    return this.followUpsService.remove(id);
  }
}
