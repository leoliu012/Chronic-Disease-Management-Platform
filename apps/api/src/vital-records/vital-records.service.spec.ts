import { Test, TestingModule } from '@nestjs/testing';
import { VitalRecordsService } from './vital-records.service';

describe('VitalRecordsService', () => {
  let service: VitalRecordsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VitalRecordsService],
    }).compile();

    service = module.get<VitalRecordsService>(VitalRecordsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
