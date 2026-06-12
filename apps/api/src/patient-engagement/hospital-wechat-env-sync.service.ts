import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HospitalWechatOfficialAccountService } from './hospital-wechat-account.service';

function envValue(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function trimTrailingSlash(value?: string): string | undefined {
  return value?.replace(/\/+$/, '');
}

function domainOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

@Injectable()
export class HospitalWechatEnvSyncService implements OnModuleInit {
  private readonly logger = new Logger(HospitalWechatEnvSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: HospitalWechatOfficialAccountService,
  ) {}

  async onModuleInit() {
    if (String(process.env.WECHAT_OFFICIAL_ACCOUNT_ENV_SYNC ?? 'true').toLowerCase() === 'false') {
      this.logger.log('Skipped env sync: WECHAT_OFFICIAL_ACCOUNT_ENV_SYNC=false');
      return;
    }

    const appId = envValue('WECHAT_OFFICIAL_ACCOUNT_APP_ID');
    if (!appId) {
      this.logger.log('Skipped env sync: WECHAT_OFFICIAL_ACCOUNT_APP_ID is empty');
      return;
    }

    const hospitalTenantId = await this.resolveTenantId();
    if (!hospitalTenantId) {
      this.logger.warn('Skipped env sync: set LOCAL_HOSPITAL_TENANT_ID when multiple active tenants exist');
      return;
    }

    const existing = await this.accounts.getAccountForTenant(hospitalTenantId);
    const appSecret = envValue('WECHAT_OFFICIAL_ACCOUNT_APP_SECRET');
    if (!existing && !appSecret) {
      this.logger.warn('Skipped env sync: appSecret is required when creating a new service account row');
      return;
    }

    const apiBaseUrl = trimTrailingSlash(
      envValue('PATIENT_ENGAGEMENT_API_BASE_URL') || envValue('API_PUBLIC_BASE_URL'),
    );
    const h5BaseUrl = trimTrailingSlash(envValue('PATIENT_ENGAGEMENT_BASE_URL'));

    const updated = await this.accounts.upsert({
      hospitalTenantId,
      accountName: existing?.accountName || 'Env configured service account',
      originalId: existing?.originalId || undefined,
      appId,
      appSecret,
      h5BaseUrl: h5BaseUrl || existing?.h5BaseUrl || undefined,
      oauthCallbackDomain: domainOf(apiBaseUrl) || existing?.oauthCallbackDomain || undefined,
      templateQuestionnaireId:
        envValue('WECHAT_OFFICIAL_ACCOUNT_TEMPLATE_QUESTIONNAIRE') ||
        existing?.templateQuestionnaireId ||
        undefined,
      templateVitalId:
        envValue('WECHAT_OFFICIAL_ACCOUNT_TEMPLATE_VITAL') ||
        existing?.templateVitalId ||
        undefined,
      templateMedicationId:
        envValue('WECHAT_OFFICIAL_ACCOUNT_TEMPLATE_MEDICATION') ||
        existing?.templateMedicationId ||
        undefined,
      templateHospitalVisitId:
        envValue('WECHAT_OFFICIAL_ACCOUNT_TEMPLATE_HOSPITAL_VISIT') ||
        existing?.templateHospitalVisitId ||
        undefined,
      isEnabled: process.env.WECHAT_OFFICIAL_ACCOUNT_ENABLED
        ? String(process.env.WECHAT_OFFICIAL_ACCOUNT_ENABLED).toLowerCase() !== 'false'
        : existing?.isEnabled ?? true,
      isVerified: existing?.isVerified ?? true,
    });

    this.logger.log(
      `Synced WeChat service account from env: tenant=${updated.hospitalTenantId} appId=${updated.appId} templates=` +
        [
          updated.templateQuestionnaireId ? 'questionnaire' : null,
          updated.templateVitalId ? 'vital' : null,
          updated.templateMedicationId ? 'medication' : null,
          updated.templateHospitalVisitId ? 'hospitalVisit' : null,
        ]
          .filter(Boolean)
          .join(','),
    );
  }

  private async resolveTenantId(): Promise<string | null> {
    const configured = envValue('LOCAL_HOSPITAL_TENANT_ID');
    if (configured) {
      const tenant = await this.prisma.hospitalTenant.findUnique({
        where: { id: configured },
        select: { id: true, isActive: true },
      });
      return tenant?.isActive ? tenant.id : null;
    }

    const tenants = await this.prisma.hospitalTenant.findMany({
      where: { isActive: true },
      select: { id: true },
      take: 2,
    });
    return tenants.length === 1 ? tenants[0].id : null;
  }
}
