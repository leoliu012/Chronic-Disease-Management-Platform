import { Module } from '@nestjs/common';
import { HisIntegrationController } from './his-integration.controller';
import { HisIntegrationService } from './his-integration.service';

@Module({
  controllers: [HisIntegrationController],
  providers: [HisIntegrationService],
  // patient-self-consent-bind: PatientAppModule 的 identity/lookup 需要查 HIS 暂存患者信息。
  exports: [HisIntegrationService],
})
export class HisIntegrationModule {}
