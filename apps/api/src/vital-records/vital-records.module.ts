import { Module } from '@nestjs/common';
import { ClinicalRulesModule } from '../clinical-rules/clinical-rules.module';
import { VitalRecordsController } from './vital-records.controller';
import { VitalRecordsService } from './vital-records.service';

@Module({
  imports: [ClinicalRulesModule],
  controllers: [VitalRecordsController],
  providers: [VitalRecordsService],
  exports: [VitalRecordsService],
})
export class VitalRecordsModule {}
