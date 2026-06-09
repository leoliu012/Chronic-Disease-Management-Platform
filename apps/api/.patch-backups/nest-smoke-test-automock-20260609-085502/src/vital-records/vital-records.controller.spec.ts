import { Test, TestingModule } from '@nestjs/testing';
import { VitalRecordsController } from './vital-records.controller';

describe('VitalRecordsController', () => {
  let controller: VitalRecordsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VitalRecordsController],
    }).compile();

    controller = module.get<VitalRecordsController>(VitalRecordsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
