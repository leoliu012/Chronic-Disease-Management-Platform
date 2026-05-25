import { Module } from '@nestjs/common';
import { FollowUpsController } from './follow-ups.controller';
import { FollowUpsService } from './follow-ups.service';
import { FollowupPlanGeneratorService } from './followup-plan-generator.service';

@Module({
  controllers: [FollowUpsController],
  providers: [FollowUpsService, FollowupPlanGeneratorService],
  exports: [FollowupPlanGeneratorService],
})
export class FollowUpsModule {}
