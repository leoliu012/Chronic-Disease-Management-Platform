import { api as apiClient } from './client';

export type PreferredChannel = 'AUTO' | 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS' | 'MANUAL_COPY';

export type ContactSummary = {
  patientId: string;
  // patient_engagement_hospital_wechat_v2 — added
  hospitalTenantId: string | null;
  hospitalDisplayName: string | null;
  hospitalServiceAccountConfigured: boolean;
  hospitalServiceAccountReady: boolean;

  hasPhone: boolean;
  maskedPhone: string | null;
  hasOpenId: boolean;
  wechatIdentitySource: string | null;
  lastMessage: {
    id: string;
    channel: string;
    status: string;
    messageType: string;
    sentAt: string | null;
    clickedAt: string | null;
    submittedAt: string | null;
    createdAt: string;
  } | null;
  recommendedChannel: 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS' | 'MANUAL_COPY';
};

export type FormLinkType =
  | 'QUESTIONNAIRE'
  | 'VITAL_RECHECK'
  | 'MEDICATION_CHECKIN'
  | 'HOSPITAL_VISIT_CONFIRM';

export type CreateLinkResponse = {
  formLink: {
    id: string;
    type: string;
    title: string;
    description: string | null;
    status: string;
    expiresAt: string;
    requiresIdentityCheck: boolean;
    taskId: string | null;
    riskAlertId: string | null;
  };
  token: string;
  linkUrl: string;
  message: null | {
    id: string;
    channel: string;
    status: string;
    errorMessage: string | null;
    providerMessageId: string | null;
    sentAt: string | null;
  };
  sendResult: null | { channel: string; status: string; errorMessage: string | null };
};

export type OutboundMessage = {
  id: string;
  channel: string;
  messageType: string;
  status: string;
  title: string;
  content: string;
  linkUrl: string | null;
  recipientMasked: string | null;
  errorMessage: string | null;
  providerMessageId: string | null;
  sentAt: string | null;
  clickedAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  formLink: null | {
    id: string;
    type: string;
    status: string;
    expiresAt: string;
    usedAt: string | null;
    submitCount: number;
  };
};

export async function fetchContactSummary(patientId: string): Promise<ContactSummary> {
  const { data } = await apiClient.get(`/patient-engagement/patients/${patientId}/contact-summary`);
  return data;
}

export async function fetchPatientMessages(patientId: string): Promise<OutboundMessage[]> {
  const { data } = await apiClient.get(`/patient-engagement/patients/${patientId}/messages`);
  return data;
}

export type CreateLinkBaseInput = {
  title?: string;
  description?: string;
  expiresInHours?: number;
  send?: boolean;
  preferredChannel?: PreferredChannel;
  requiresIdentityCheck?: boolean;
  taskId?: string;
  riskAlertId?: string;
};

export async function createQuestionnaireLink(
  patientId: string,
  input: CreateLinkBaseInput & { questionnaireType: string },
): Promise<CreateLinkResponse> {
  const { data } = await apiClient.post(
    `/patient-engagement/patients/${patientId}/questionnaire-links`,
    input,
  );
  return data;
}

export async function createVitalRecheckLink(
  patientId: string,
  input: CreateLinkBaseInput & { vitalType: string },
): Promise<CreateLinkResponse> {
  const { data } = await apiClient.post(
    `/patient-engagement/patients/${patientId}/vital-recheck-links`,
    input,
  );
  return data;
}

export async function createMedicationCheckinLink(
  patientId: string,
  input: CreateLinkBaseInput & { medicationId: string; scheduledAt?: string },
): Promise<CreateLinkResponse> {
  const { data } = await apiClient.post(
    `/patient-engagement/patients/${patientId}/medication-checkin-links`,
    input,
  );
  return data;
}

export async function createHospitalVisitLink(
  patientId: string,
  input: CreateLinkBaseInput & { reason: string; hospitalVisitReminderId?: string },
): Promise<CreateLinkResponse> {
  const { data } = await apiClient.post(
    `/patient-engagement/patients/${patientId}/hospital-visit-links`,
    input,
  );
  return data;
}

export async function revokeFormLink(formLinkId: string, reason: string) {
  const { data } = await apiClient.post(`/patient-engagement/form-links/${formLinkId}/revoke`, {
    reason,
  });
  return data;
}

export async function resendMessage(messageId: string, preferredChannel?: PreferredChannel) {
  const { data } = await apiClient.post(`/patient-engagement/messages/${messageId}/resend`, {
    preferredChannel,
  });
  return data;
}

export async function markMessageManualSent(messageId: string, note?: string) {
  const { data } = await apiClient.post(`/patient-engagement/messages/${messageId}/mark-manual-sent`, {
    note,
  });
  return data;
}
