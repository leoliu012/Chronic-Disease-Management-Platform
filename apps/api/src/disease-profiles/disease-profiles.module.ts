import { Module } from '@nestjs/common';
import { DiseaseProfilesController } from './disease-profiles.controller';
import { DiseaseProfilesService } from './disease-profiles.service';

@Module({
  controllers: [DiseaseProfilesController],
  providers: [DiseaseProfilesService],
})
export class DiseaseProfilesModule {}
