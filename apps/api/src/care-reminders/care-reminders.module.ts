import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { PatientEngagementModule } from '../patient-engagement/patient-engagement.module';
import { CareReminderScheduleService } from './care-reminder-schedule.service';
import { CareReminderOccurrenceService } from './care-reminder-occurrence.service';
import { CareReminderWorkerService } from './care-reminder-worker.service';
import { CareReminderResendService } from './care-reminder-resend.service';
import { PatientDirectMessageService } from './patient-direct-message.service';
import { CareRemindersController } from './care-reminders.controller';

/**
 * CareRemindersModule (v3)
 *
 * Sits on top of v2.1 PatientEngagementModule. v2.1 exports the
 * FormLinkService / OutboundMessageService / WechatOfficialAccountService /
 * HospitalWechatOfficialAccountService / PatientEngagementTenantService
 * singletons, which CareRemindersWorkerService / PatientDirectMessageService
 * inject directly. No re-providers — that would split caches.
 */
@Module({
  imports: [PrismaModule, SecurityModule, PatientEngagementModule],
  controllers: [CareRemindersController],
  providers: [
    CareReminderScheduleService,
    CareReminderOccurrenceService,
    CareReminderWorkerService,
    CareReminderResendService,
    PatientDirectMessageService,
  ],
  exports: [
    CareReminderOccurrenceService,
    CareReminderScheduleService,
    PatientDirectMessageService,
  ],
})
export class CareRemindersModule {}
