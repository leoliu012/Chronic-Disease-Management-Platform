import { Module } from '@nestjs/common';
import { QuestionnairesController } from './questionnaires.controller';
import { ClinicalDispositionModule } from '../clinical-disposition/clinical-disposition.module';
import { QuestionnairesService } from './questionnaires.service';

@Module({
  imports: [ClinicalDispositionModule],
  controllers: [QuestionnairesController],
  providers: [QuestionnairesService],
})
export class QuestionnairesModule {}
