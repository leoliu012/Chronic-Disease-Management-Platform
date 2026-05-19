import { Controller, Get, Param } from '@nestjs/common';
import { PatientTimelineService } from './patient-timeline.service';

@Controller()
export class PatientTimelineController {
  constructor(
    private readonly patientTimelineService: PatientTimelineService,
  ) {}

  @Get('patients/:patientId/timeline')
  getTimeline(@Param('patientId') patientId: string) {
    return this.patientTimelineService.getTimeline(patientId);
  }
}
