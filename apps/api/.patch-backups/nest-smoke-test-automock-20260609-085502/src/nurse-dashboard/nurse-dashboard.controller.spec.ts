import { Test, TestingModule } from '@nestjs/testing';
import { NurseDashboardController } from './nurse-dashboard.controller';

describe('NurseDashboardController', () => {
  let controller: NurseDashboardController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NurseDashboardController],
    }).compile();

    controller = module.get<NurseDashboardController>(NurseDashboardController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
