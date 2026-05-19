import { Test, TestingModule } from '@nestjs/testing';
import { PatientTimelineService } from './patient-timeline.service';

describe('PatientTimelineService', () => {
  let service: PatientTimelineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PatientTimelineService],
    }).compile();

    service = module.get<PatientTimelineService>(PatientTimelineService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
