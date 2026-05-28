import { api as apiClient } from './client';

export type HospitalWechatAccountSummary = {
  hospitalTenantId: string;
  accountName: string | null;
  originalId: string | null;
  appIdMasked: string;
  hasAppSecret: boolean;
  appSecretMasked: string;
  qrCodeUrl: string | null;
  h5BaseUrl: string | null;
  oauthCallbackDomain: string | null;
  templateQuestionnaireId: string | null;
  templateVitalId: string | null;
  templateMedicationId: string | null;
  templateHospitalVisitId: string | null;
  isEnabled: boolean;
  isVerified: boolean;
  lastTokenRefreshAt: string | null;
  accessTokenExpiresAt: string | null;
  configured: boolean;
};

export type UpsertHospitalWechatAccountInput = {
  accountName?: string;
  originalId?: string;
  appId: string;
  /** Only sent when (re-)setting. Empty/undefined keeps existing one. */
  appSecret?: string;
  qrCodeUrl?: string;
  h5BaseUrl?: string;
  oauthCallbackDomain?: string;
  templateQuestionnaireId?: string;
  templateVitalId?: string;
  templateMedicationId?: string;
  templateHospitalVisitId?: string;
  isEnabled?: boolean;
  isVerified?: boolean;
  hospitalTenantId?: string; // ADMIN cross-tenant only
};

export async function fetchHospitalWechatAccount(
  hospitalTenantId?: string,
): Promise<HospitalWechatAccountSummary> {
  const params = hospitalTenantId ? `?hospitalTenantId=${encodeURIComponent(hospitalTenantId)}` : '';
  const { data } = await apiClient.get(`/hospital-wechat/account${params}`);
  return data;
}

export async function saveHospitalWechatAccount(
  input: UpsertHospitalWechatAccountInput,
): Promise<HospitalWechatAccountSummary> {
  const { data } = await apiClient.post(`/hospital-wechat/account`, input);
  return data;
}

export async function testHospitalWechatAccessToken(
  hospitalTenantId?: string,
): Promise<{ ok: boolean; mocked: boolean; message: string; expiresInSec?: number }> {
  const { data } = await apiClient.post(`/hospital-wechat/account/test-access-token`, {
    hospitalTenantId,
  });
  return data;
}

export async function testHospitalWechatSend(
  input: { hospitalTenantId?: string; patientId?: string; openId?: string },
): Promise<{ ok: boolean; mocked: boolean; errorMessage?: string }> {
  const { data } = await apiClient.post(`/hospital-wechat/account/test-send`, input);
  return data;
}
