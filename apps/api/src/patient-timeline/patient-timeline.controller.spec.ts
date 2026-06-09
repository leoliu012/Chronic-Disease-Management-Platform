import { Test, TestingModule } from '@nestjs/testing';
import { PatientTimelineController } from './patient-timeline.controller';

describe('PatientTimelineController', () => {
  let controller: PatientTimelineController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PatientTimelineController],
    })
      .useMocker(() => ({}))
      .compile();

    controller = module.get<PatientTimelineController>(PatientTimelineController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
