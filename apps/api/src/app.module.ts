import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { PatientsModule } from './patients/patients.module';
import { DiseaseProfilesModule } from './disease-profiles/disease-profiles.module';
import { VitalRecordsModule } from './vital-records/vital-records.module';
import { RiskAlertsModule } from './risk-alerts/risk-alerts.module';
import { TasksModule } from './tasks/tasks.module';
import { NurseDashboardModule } from './nurse-dashboard/nurse-dashboard.module';
import { FollowUpsModule } from './follow-ups/follow-ups.module';
import { PatientTimelineModule } from './patient-timeline/patient-timeline.module';
import { ReportsModule } from './reports/reports.module';
import { HisIntegrationModule } from './his-integration/his-integration.module';
import { DevToolsModule } from './dev-tools/dev-tools.module';
import { MedicationsModule } from './medications/medications.module';
import { QuestionnairesModule } from './questionnaires/questionnaires.module';
import { VitalMonitoringPlansModule } from './vital-monitoring-plans/vital-monitoring-plans.module';
import { AuthModule } from './auth/auth.module';
import { SecurityModule } from './security/security.module';
import { JwtAuthGuard } from './security/jwt-auth.guard';
import { RolesGuard } from './security/roles.guard';
import { AuditInterceptor } from './security/audit.interceptor';
import { PatientAppModule } from './patient-app/patient-app.module';
import { ClinicalRulesModule } from './clinical-rules/clinical-rules.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { WorkItemsModule } from './work-items/work-items.module';
import { HospitalVisitRemindersModule } from './hospital-visit-reminders/hospital-visit-reminders.module';
import { EncounterRecordsModule } from './encounter-records/encounter-records.module';
import { MedicalRecordSummariesModule } from './medical-record-summaries/medical-record-summaries.module';
import { ExamReportsModule } from './exam-reports/exam-reports.module';
import { HospitalMedicationsModule } from './hospital-medications/hospital-medications.module';
import { GatewayModule } from './gateway/gateway.module';
import { ChronicLeadsModule } from './chronic-leads/chronic-leads.module';
import { PatientEngagementModule } from './patient-engagement/patient-engagement.module';
import { CareRemindersModule } from './care-reminders/care-reminders.module';

const developmentOnlyModules = process.env.NODE_ENV === 'production' ? [] : [DevToolsModule];

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    SecurityModule,
    PatientAppModule,
    ClinicalRulesModule,
    IntegrationsModule,
    WorkItemsModule,
    HospitalVisitRemindersModule,
    EncounterRecordsModule,
    MedicalRecordSummariesModule,
    ExamReportsModule,
    HospitalMedicationsModule,
    PatientsModule,
    DiseaseProfilesModule,
    VitalRecordsModule,
    RiskAlertsModule,
    TasksModule,
    NurseDashboardModule,
    FollowUpsModule,
    PatientTimelineModule,
    ReportsModule,
    HisIntegrationModule,
    GatewayModule,
    ChronicLeadsModule,
    PatientEngagementModule,
    CareRemindersModule,
    ...developmentOnlyModules,
    MedicationsModule,
    QuestionnairesModule,
    VitalMonitoringPlansModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
