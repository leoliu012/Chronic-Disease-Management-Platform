import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Audit } from '../security/audit.decorator';
import { CurrentUser } from '../security/current-user.decorator';
import { Roles } from '../security/roles.decorator';
import type { RequestUser } from '../security/request-user.type';
import { CarePlanRefreshWorker } from './care-plan-refresh.worker';
import { CarePlansService } from './care-plans.service';
import { DismissNextBestActionDto } from './dto/dismiss-next-best-action.dto';
import { EnrollCarePlanDto } from './dto/enroll-care-plan.dto';
import { UpdateCarePlanStatusDto } from './dto/update-care-plan-status.dto';

@Controller('care-plans')
export class CarePlansController {
  constructor(
    private readonly carePlans: CarePlansService,
    private readonly worker: CarePlanRefreshWorker,
  ) {}

  @Get('patients/:patientId')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  byPatient(@Param('patientId') patientId: string, @CurrentUser() user: RequestUser) {
    return this.carePlans.listByPatient(patientId, user);
  }

  @Audit({ action: 'ENROLL_CARE_PLAN', target: 'CarePlan', targetIdFrom: 'response.id', patientIdFrom: 'params.patientId' })
  @Post('patients/:patientId/enroll')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  enroll(@Param('patientId') patientId: string, @Body() dto: EnrollCarePlanDto, @CurrentUser() user: RequestUser) {
    return this.carePlans.enrollPatient(patientId, dto, user);
  }

  @Audit({ action: 'UPDATE_CARE_PLAN_STATUS', target: 'CarePlan', targetIdFrom: 'params.id' })
  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateCarePlanStatusDto, @CurrentUser() user: RequestUser) {
    return this.carePlans.updateStatus(id, dto, user);
  }

  @Get('prioritized-patients')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  prioritized(@CurrentUser() user: RequestUser, @Query('limit') limit?: string, @Query('hospitalTenantId') hospitalTenantId?: string) {
    return this.carePlans.listPrioritized(user, limit ? Number(limit) : 20, hospitalTenantId);
  }

  @Get('patients/:patientId/next-best-actions')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  actions(@Param('patientId') patientId: string, @CurrentUser() user: RequestUser) {
    return this.carePlans.listActions(patientId, user);
  }

  @Audit({ action: 'RECALCULATE_PATIENT_CARE_PLAN', target: 'CarePlan', targetIdFrom: 'response.id', patientIdFrom: 'params.patientId' })
  @Post('patients/:patientId/recalculate')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  recalculate(@Param('patientId') patientId: string, @CurrentUser() user: RequestUser) {
    return this.carePlans.recalculateByPatient(patientId, user);
  }

  @Get('refresh-worker/status')
  @Roles(UserRole.ADMIN)
  refreshWorkerStatus() {
    return this.worker.getStatus();
  }

  @Audit({ action: 'REFRESH_ACTIVE_CARE_PLANS', target: 'CarePlan' })
  @Post('refresh-active')
  @Roles(UserRole.ADMIN)
  refreshActive() {
    return this.worker.runOnce();
  }

  @Audit({ action: 'CREATE_TASK_FROM_NEXT_BEST_ACTION', target: 'NextBestAction', targetIdFrom: 'params.id', patientIdFrom: 'response.patientId' })
  @Post('next-best-actions/:id/create-task')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  createTask(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.carePlans.createTaskFromAction(id, user);
  }

  @Audit({ action: 'DISMISS_NEXT_BEST_ACTION', target: 'NextBestAction', targetIdFrom: 'params.id' })
  @Post('next-best-actions/:id/dismiss')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  dismiss(@Param('id') id: string, @Body() dto: DismissNextBestActionDto, @CurrentUser() user: RequestUser) {
    return this.carePlans.dismissAction(id, dto.reason, user);
  }
}
