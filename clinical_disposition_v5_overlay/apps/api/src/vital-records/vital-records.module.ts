import { Module } from '@nestjs/common';
import { ClinicalRulesModule } from '../clinical-rules/clinical-rules.module';
import { ClinicalDispositionModule } from '../clinical-disposition/clinical-disposition.module';
import { VitalRecordsController } from './vital-records.controller';
import { VitalRecordsService } from './vital-records.service';

@Module({
  imports: [ClinicalRulesModule, ClinicalDispositionModule],
  controllers: [VitalRecordsController],
  providers: [VitalRecordsService],
  exports: [VitalRecordsService],
})
export class VitalRecordsModule {}
