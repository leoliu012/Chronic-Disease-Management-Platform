import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Audit } from '../security/audit.decorator';
import { CurrentUser } from '../security/current-user.decorator';
import { Roles } from '../security/roles.decorator';
import type { RequestUser } from '../security/request-user.type';
import { QueryWorkItemsDto } from './dto/query-work-items.dto';
import { ReviewPatientSubmissionDto } from './dto/review-patient-submission.dto';
import { WorkItemsService } from './work-items.service';

@Controller()
export class WorkItemsController {
  constructor(private readonly workItemsService: WorkItemsService) {}

  @Get('work-items')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
  findAll(@Query() query: QueryWorkItemsDto, @CurrentUser() user: RequestUser) {
    return this.workItemsService.findAll(query, user);
  }

  @Get('work-items/summary')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
  summary(@Query() query: QueryWorkItemsDto, @CurrentUser() user: RequestUser) {
    return this.workItemsService.summary(query, user);
  }

  @Audit({ mode: 'REQUIRED', action: 'REVIEW_PATIENT_SUBMISSION', target: 'PatientFormLink', targetIdFrom: 'params.formLinkId', patientIdFrom: 'response.patientId' })
  @Post('work-items/submissions/:formLinkId/review')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
  reviewSubmission(
    @Param('formLinkId') formLinkId: string,
    @Body() dto: ReviewPatientSubmissionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.workItemsService.reviewPatientSubmission(formLinkId, dto.note, user);
  }

  @Get('patients/:patientId/work-items')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
  findByPatient(
    @Param('patientId') patientId: string,
    @Query() query: QueryWorkItemsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.workItemsService.findAll({ ...query, patientId }, user);
  }
}
