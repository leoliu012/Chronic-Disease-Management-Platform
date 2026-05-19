import { Controller, Get, Param, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../security/roles.decorator';
import { QueryWorkItemsDto } from './dto/query-work-items.dto';
import { WorkItemsService } from './work-items.service';

@Controller()
export class WorkItemsController {
  constructor(private readonly workItemsService: WorkItemsService) {}

  @Get('work-items')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
  findAll(@Query() query: QueryWorkItemsDto) {
    return this.workItemsService.findAll(query);
  }

  @Get('patients/:patientId/work-items')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
  findByPatient(
    @Param('patientId') patientId: string,
    @Query() query: QueryWorkItemsDto,
  ) {
    return this.workItemsService.findAll({ ...query, patientId });
  }
}

