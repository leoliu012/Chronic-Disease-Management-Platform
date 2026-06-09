import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Audit } from '../security/audit.decorator';
import { ApplyVitalRecommendationsDto } from './dto/apply-vital-recommendations.dto';
import { CreateVitalMonitoringPlanDto } from './dto/create-vital-monitoring-plan.dto';
import { MarkVitalMonitoringMissedDto } from './dto/mark-vital-monitoring-missed.dto';
import { UpdateVitalMonitoringPlanDto } from './dto/update-vital-monitoring-plan.dto';
import { VitalMonitoringPlansService } from './vital-monitoring-plans.service';

@Controller()
export class VitalMonitoringPlansController {
  constructor(private readonly service: VitalMonitoringPlansService) {}

  @Get('patients/:patientId/vital-monitoring-recommendations')
  getRecommendations(@Param('patientId') patientId: string) {
    return this.service.getRecommendations(patientId);
  }

  @Audit({
    action: 'APPLY_VITAL_MONITORING_RECOMMENDATIONS',
    target: 'VitalMonitoringPlan',
    patientIdFrom: 'params.patientId',
  })
  @Post('patients/:patientId/vital-monitoring-plans/apply-recommendations')
  applyRecommendations(
    @Param('patientId') patientId: string,
    @Body() dto: ApplyVitalRecommendationsDto,
  ) {
    return this.service.applyRecommendations(patientId, dto);
  }

  @Audit({
    action: 'CREATE_VITAL_MONITORING_PLAN',
    target: 'VitalMonitoringPlan',
    targetIdFrom: 'response.id',
    patientIdFrom: 'params.patientId',
  })
  @Post('patients/:patientId/vital-monitoring-plans')
  createPlan(
    @Param('patientId') patientId: string,
    @Body() dto: CreateVitalMonitoringPlanDto,
  ) {
    return this.service.createPlan(patientId, dto);
  }

  @Audit({
    action: 'VIEW_VITAL_MONITORING_PLANS',
    target: 'VitalMonitoringPlan',
    patientIdFrom: 'params.patientId',
  })
  @Get('patients/:patientId/vital-monitoring-plans')
  findByPatient(@Param('patientId') patientId: string) {
    return this.service.findByPatient(patientId);
  }

  @Audit({
    action: 'VIEW_VITAL_MONITORING_PLAN',
    target: 'VitalMonitoringPlan',
    targetIdFrom: 'params.id',
    patientIdFrom: 'response.patientId',
  })
  @Get('vital-monitoring-plans/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Audit({
    action: 'UPDATE_VITAL_MONITORING_PLAN',
    target: 'VitalMonitoringPlan',
    targetIdFrom: 'params.id',
    patientIdFrom: 'response.patientId',
  })
  @Patch('vital-monitoring-plans/:id')
  updatePlan(@Param('id') id: string, @Body() dto: UpdateVitalMonitoringPlanDto) {
    return this.service.updatePlan(id, dto);
  }

  @Audit({
    action: 'DEACTIVATE_VITAL_MONITORING_PLAN',
    target: 'VitalMonitoringPlan',
    targetIdFrom: 'params.id',
    patientIdFrom: 'response.patientId',
  })
  @Delete('vital-monitoring-plans/:id')
  deactivatePlan(@Param('id') id: string) {
    return this.service.deactivatePlan(id);
  }

  @Audit({
    action: 'MARK_VITAL_MONITORING_MISSED',
    target: 'VitalMonitoringPlan',
    targetIdFrom: 'params.id',
    patientIdFrom: 'response.patientId',
  })
  @Post('vital-monitoring-plans/:id/miss')
  markMissed(@Param('id') id: string, @Body() dto: MarkVitalMonitoringMissedDto) {
    return this.service.markMissed(id, dto);
  }
}
