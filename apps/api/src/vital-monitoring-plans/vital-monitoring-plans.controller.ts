import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
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

  @Post('patients/:patientId/vital-monitoring-plans/apply-recommendations')
  applyRecommendations(
    @Param('patientId') patientId: string,
    @Body() dto: ApplyVitalRecommendationsDto,
  ) {
    return this.service.applyRecommendations(patientId, dto);
  }

  @Post('patients/:patientId/vital-monitoring-plans')
  createPlan(
    @Param('patientId') patientId: string,
    @Body() dto: CreateVitalMonitoringPlanDto,
  ) {
    return this.service.createPlan(patientId, dto);
  }

  @Get('patients/:patientId/vital-monitoring-plans')
  findByPatient(@Param('patientId') patientId: string) {
    return this.service.findByPatient(patientId);
  }

  @Get('vital-monitoring-plans/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch('vital-monitoring-plans/:id')
  updatePlan(@Param('id') id: string, @Body() dto: UpdateVitalMonitoringPlanDto) {
    return this.service.updatePlan(id, dto);
  }

  @Delete('vital-monitoring-plans/:id')
  deactivatePlan(@Param('id') id: string) {
    return this.service.deactivatePlan(id);
  }

  @Post('vital-monitoring-plans/:id/miss')
  markMissed(@Param('id') id: string, @Body() dto: MarkVitalMonitoringMissedDto) {
    return this.service.markMissed(id, dto);
  }
}
