import { Module } from '@nestjs/common';
import { PatientTimelineController } from './patient-timeline.controller';
import { PatientTimelineService } from './patient-timeline.service';

@Module({
  controllers: [PatientTimelineController],
  providers: [PatientTimelineService],
})
export class PatientTimelineModule {}
