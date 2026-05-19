import { Module } from '@nestjs/common';
import { HisIntegrationController } from './his-integration.controller';
import { HisIntegrationService } from './his-integration.service';

@Module({
  controllers: [HisIntegrationController],
  providers: [HisIntegrationService],
})
export class HisIntegrationModule {}
