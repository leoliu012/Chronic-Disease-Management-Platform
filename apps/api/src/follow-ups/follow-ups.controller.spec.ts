import { Test, TestingModule } from '@nestjs/testing';
import { FollowUpsController } from './follow-ups.controller';

describe('FollowUpsController', () => {
  let controller: FollowUpsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FollowUpsController],
    }).compile();

    controller = module.get<FollowUpsController>(FollowUpsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
