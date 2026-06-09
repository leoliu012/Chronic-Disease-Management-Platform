import { Module } from '@nestjs/common';
import { RiskAlertsController } from './risk-alerts.controller';
import { ClinicalDispositionModule } from '../clinical-disposition/clinical-disposition.module';
import { RiskAlertsService } from './risk-alerts.service';

@Module({
  imports: [ClinicalDispositionModule],
  controllers: [RiskAlertsController],
  providers: [RiskAlertsService],
})
export class RiskAlertsModule {}
