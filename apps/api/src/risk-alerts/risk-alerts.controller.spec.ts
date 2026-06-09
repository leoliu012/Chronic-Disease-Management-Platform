import { Test, TestingModule } from '@nestjs/testing';
import { RiskAlertsController } from './risk-alerts.controller';

describe('RiskAlertsController', () => {
  let controller: RiskAlertsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RiskAlertsController],
    })
      .useMocker(() => ({}))
      .compile();

    controller = module.get<RiskAlertsController>(RiskAlertsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
