import { Module } from '@nestjs/common';
import { NurseDashboardController } from './nurse-dashboard.controller';
import { NurseDashboardService } from './nurse-dashboard.service';

@Module({
  controllers: [NurseDashboardController],
  providers: [NurseDashboardService]
})
export class NurseDashboardModule {}
