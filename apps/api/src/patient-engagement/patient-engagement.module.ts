import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { ClinicalDispositionModule } from '../clinical-disposition/clinical-disposition.module';
import { ClinicalRulesModule } from '../clinical-rules/clinical-rules.module';
import { AdminPatientEngagementController } from './admin-patient-engagement.controller';
import { PublicFormController, WechatOAuthController } from './public-form.controller';
import { HospitalWechatAccountController } from './hospital-wechat-account.controller';
import { PatientEngagementService } from './patient-engagement.service';
import { FormLinkService } from './form-link.service';
import { OutboundMessageService } from './outbound-message.service';
import { SmsService } from './sms.service';
import { WechatOfficialAccountService } from './wechat-official-account.service';
import { HospitalWechatOfficialAccountService } from './hospital-wechat-account.service';
import { PatientEngagementTenantService } from './patient-engagement-tenant.service';

/**
 * PatientEngagementModule (v2.1 + v3 export widening)
 *
 * v3 (care-reminders) needs to inject several of these services from its own
 * module. Widening `exports` keeps them singleton-per-app instead of forcing
 * v3 to re-instantiate (which would split caches like
 * WechatOfficialAccountService.tokenRefreshInflight).
 */
@Module({
  imports: [PrismaModule, SecurityModule, ClinicalDispositionModule, ClinicalRulesModule],
  controllers: [
    AdminPatientEngagementController,
    PublicFormController,
    WechatOAuthController,
    HospitalWechatAccountController,
  ],
  providers: [
    HospitalWechatOfficialAccountService,
    PatientEngagementTenantService,
    WechatOfficialAccountService,
    SmsService,
    OutboundMessageService,
    FormLinkService,
    PatientEngagementService,
  ],
  exports: [
    PatientEngagementService,
    // v3 needs these:
    FormLinkService,
    OutboundMessageService,
    WechatOfficialAccountService,
    HospitalWechatOfficialAccountService,
    PatientEngagementTenantService,
    SmsService,
  ],
})
export class PatientEngagementModule {}
