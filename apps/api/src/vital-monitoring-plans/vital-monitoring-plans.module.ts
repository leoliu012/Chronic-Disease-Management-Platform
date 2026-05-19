import { Module } from '@nestjs/common';
import { VitalMonitoringPlansController } from './vital-monitoring-plans.controller';
import { VitalMonitoringPlansService } from './vital-monitoring-plans.service';

@Module({
  controllers: [VitalMonitoringPlansController],
  providers: [VitalMonitoringPlansService],
})
export class VitalMonitoringPlansModule {}
