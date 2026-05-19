import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    PrismaModule,
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
    DevToolsModule,
    MedicationsModule,
    QuestionnairesModule,
    VitalMonitoringPlansModule,
  ],
})
export class AppModule {}

