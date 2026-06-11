import { Module } from '@nestjs/common';
import { QuestionnairesController } from './questionnaires.controller';
import { ClinicalDispositionModule } from '../clinical-disposition/clinical-disposition.module';
import { ClinicalRulesModule } from '../clinical-rules/clinical-rules.module';
import { QuestionnairesService } from './questionnaires.service';

@Module({
  imports: [ClinicalDispositionModule, ClinicalRulesModule],
  controllers: [QuestionnairesController],
  providers: [QuestionnairesService],
})
export class QuestionnairesModule {}
