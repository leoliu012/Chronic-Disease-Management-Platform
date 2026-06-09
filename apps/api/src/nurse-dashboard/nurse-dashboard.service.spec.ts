import { Test, TestingModule } from '@nestjs/testing';
import { NurseDashboardService } from './nurse-dashboard.service';

describe('NurseDashboardService', () => {
  let service: NurseDashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NurseDashboardService],
    })
      .useMocker(() => ({}))
      .compile();

    service = module.get<NurseDashboardService>(NurseDashboardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
