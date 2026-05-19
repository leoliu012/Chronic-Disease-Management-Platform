import { Module } from '@nestjs/common';
import { SecurityModule } from '../security/security.module';
import { VitalRecordsModule } from '../vital-records/vital-records.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  imports: [SecurityModule, VitalRecordsModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
