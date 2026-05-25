import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VitalRecordsService } from '../vital-records/vital-records.service';
import { MedicationsService } from '../medications/medications.service';
import { QuestionnairesService } from '../questionnaires/questionnaires.service';
import { VitalMonitoringPlansService } from '../vital-monitoring-plans/vital-monitoring-plans.service';
import {
  PatientAppController,
  PatientBindingReviewController,
} from './patient-app.controller';
import { PatientAppService } from './patient-app.service';
import { PatientSessionGuard } from './patient-session.guard';
import { ClinicalRulesService } from '../clinical-rules/clinical-rules.service';
import { PatientIdentityController } from './patient-identity.controller';
import { ChronicLeadsModule } from '../chronic-leads/chronic-leads.module';
import { HisIntegrationModule } from '../his-integration/his-integration.module';

@Module({
  imports: [PrismaModule, ChronicLeadsModule, HisIntegrationModule],
  controllers: [
    PatientAppController,
    PatientBindingReviewController,
    PatientIdentityController,
  ],
  providers: [
    PatientAppService,
    PatientSessionGuard,
    VitalRecordsService,
    MedicationsService,
    QuestionnairesService,
    VitalMonitoringPlansService,
    ClinicalRulesService,
  ],
})
export class PatientAppModule {}
