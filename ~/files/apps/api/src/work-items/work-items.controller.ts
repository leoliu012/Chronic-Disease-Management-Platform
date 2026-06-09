import { Controller, Get, Param, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../security/current-user.decorator';
import { Roles } from '../security/roles.decorator';
import type { RequestUser } from '../security/request-user.type';
import { QueryWorkItemsDto } from './dto/query-work-items.dto';
import { WorkItemsService } from './work-items.service';

@Controller()
export class WorkItemsController {
  constructor(private readonly workItemsService: WorkItemsService) {}
  @Get('work-items') @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
  findAll(@Query() query: QueryWorkItemsDto, @CurrentUser() user: RequestUser) { return this.workItemsService.findAll(query, user); }
  @Get('patients/:patientId/work-items') @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
  findByPatient(@Param('patientId') patientId: string, @Query() query: QueryWorkItemsDto, @CurrentUser() user: RequestUser) { return this.workItemsService.findAll({ ...query, patientId }, user); }
}
