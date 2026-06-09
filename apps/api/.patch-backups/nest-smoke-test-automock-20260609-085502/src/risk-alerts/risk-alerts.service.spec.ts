import { Test, TestingModule } from '@nestjs/testing';
import { RiskAlertsService } from './risk-alerts.service';

describe('RiskAlertsService', () => {
  let service: RiskAlertsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RiskAlertsService],
    }).compile();

    service = module.get<RiskAlertsService>(RiskAlertsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
