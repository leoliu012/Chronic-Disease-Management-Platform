import { Module } from '@nestjs/common';
import { FollowUpsController } from './follow-ups.controller';
import { FollowUpsService } from './follow-ups.service';
import { FollowupPlanGeneratorService } from './followup-plan-generator.service';
import { DischargeFollowupPlanGeneratorService } from './discharge-followup-plan-generator.service';

@Module({
  controllers: [FollowUpsController],
  providers: [
    FollowUpsService,
    FollowupPlanGeneratorService,
    DischargeFollowupPlanGeneratorService,
  ],
  exports: [
    FollowupPlanGeneratorService,
    DischargeFollowupPlanGeneratorService,
  ],
})
export class FollowUpsModule {}
