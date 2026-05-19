import { Module } from '@nestjs/common';
import { RiskAlertsController } from './risk-alerts.controller';
import { RiskAlertsService } from './risk-alerts.service';

@Module({
  controllers: [RiskAlertsController],
  providers: [RiskAlertsService],
})
export class RiskAlertsModule {}
