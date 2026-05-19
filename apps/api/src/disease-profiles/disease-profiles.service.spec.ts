import { Test, TestingModule } from '@nestjs/testing';
import { DiseaseProfilesService } from './disease-profiles.service';

describe('DiseaseProfilesService', () => {
  let service: DiseaseProfilesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DiseaseProfilesService],
    }).compile();

    service = module.get<DiseaseProfilesService>(DiseaseProfilesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
