import { Module } from '@nestjs/common';
import { VitalRecordsController } from './vital-records.controller';
import { VitalRecordsService } from './vital-records.service';

@Module({
  controllers: [VitalRecordsController],
  providers: [VitalRecordsService],
})
export class VitalRecordsModule {}
