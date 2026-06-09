import { Test, TestingModule } from '@nestjs/testing';
import { DiseaseProfilesController } from './disease-profiles.controller';

describe('DiseaseProfilesController', () => {
  let controller: DiseaseProfilesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DiseaseProfilesController],
    })
      .useMocker(() => ({}))
      .compile();

    controller = module.get<DiseaseProfilesController>(DiseaseProfilesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
