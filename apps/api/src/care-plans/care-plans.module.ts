import { Module } from '@nestjs/common';
import { SecurityModule } from '../security/security.module';
import { CarePlanRefreshWorker } from './care-plan-refresh.worker';
import { CarePlansController } from './care-plans.controller';
import { CarePlansService } from './care-plans.service';

@Module({
  imports: [SecurityModule],
  controllers: [CarePlansController],
  providers: [CarePlansService, CarePlanRefreshWorker],
  exports: [CarePlansService],
})
export class CarePlansModule {}
