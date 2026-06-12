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
import { ClinicalDispositionModule } from '../clinical-disposition/clinical-disposition.module';
import { PatientEngagementModule } from '../patient-engagement/patient-engagement.module';
import { WechatMiniProgramService } from './wechat-mini-program.service';

@Module({
  imports: [
    PrismaModule,
    ChronicLeadsModule,
    HisIntegrationModule,
    ClinicalDispositionModule,
    PatientEngagementModule,
  ],
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
    WechatMiniProgramService,
  ],
})
export class PatientAppModule {}
