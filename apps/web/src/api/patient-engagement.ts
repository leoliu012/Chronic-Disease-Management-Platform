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

// patient_engagement_v3_2 — delivery summary rolled up from attempts
export type DeliverySummary = {
  channels?: string[];
  wechat?: string | null;
  sms?: string | null;
  attemptCount?: number;
} | null;

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
  // patient_engagement_v3_2
  lastAttemptAt?: string | null;
  deliverySummary?: DeliverySummary;
  patient?: { id: string; name: string; hospitalPatientId: string | null } | null;
  formLink: null | {
    id: string;
    type: string;
    status: string;
    expiresAt: string;
    usedAt: string | null;
    revokedAt?: string | null;
    revokeReason?: string | null;
    submitCount: number;
    submittedAt?: string | null;
  };
};

// patient_engagement_v3_2 — one delivery attempt under a message
export type OutboundAttempt = {
  id: string;
  messageId: string;
  channel: 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS' | string;
  status: 'SENT' | 'FAILED' | string;
  recipientMasked: string | null;
  providerMessageId: string | null;
  errorMessage: string | null;
  attemptNo: number;
  triggerReason: 'INITIAL' | 'AUTO_FALLBACK' | 'NURSE_RESEND' | string | null;
  triggeredBy: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type MessageSubmission = {
  type: string;
  inferred?: boolean;
  submittedAt: string | null;
  data: Record<string, any>;
} | null;

export type MessageDetail = {
  message: OutboundMessage;
  formLink:
    | null
    | (OutboundMessage['formLink'] & {
        title?: string;
        description?: string | null;
        revokeReason?: string | null;
        submissionType?: string | null;
        submissionId?: string | null;
      });
  attempts: OutboundAttempt[];
  submission: MessageSubmission;
};

export type MessageListFilters = {
  patientId?: string;
  status?: string;
  messageType?: string;
  channel?: string;
  from?: string; // ISO date or yyyy-mm-dd
  to?: string;
  page?: number;
  pageSize?: number;
};

export type PaginatedMessages = {
  items: OutboundMessage[];
  total: number;
  page: number;
  pageSize: number;
};

export async function fetchContactSummary(patientId: string): Promise<ContactSummary> {
  const { data } = await apiClient.get(`/patient-engagement/patients/${patientId}/contact-summary`);
  return data;
}

export async function fetchPatientMessages(patientId: string): Promise<OutboundMessage[]> {
  const { data } = await apiClient.get(`/patient-engagement/patients/${patientId}/messages`);
  return data;
}

// patient_engagement_v3_2 — filtered + paginated message list
export async function fetchMessages(filters: MessageListFilters): Promise<PaginatedMessages> {
  const params: Record<string, string> = {};
  if (filters.patientId) params.patientId = filters.patientId;
  if (filters.status) params.status = filters.status;
  if (filters.messageType) params.messageType = filters.messageType;
  if (filters.channel) params.channel = filters.channel;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.page) params.page = String(filters.page);
  if (filters.pageSize) params.pageSize = String(filters.pageSize);
  const { data } = await apiClient.get(`/patient-engagement/messages`, { params });
  // backward-compat: if an older API returns a bare array, wrap it.
  if (Array.isArray(data)) {
    return { items: data, total: data.length, page: 1, pageSize: data.length };
  }
  return data;
}

// patient_engagement_v3_2 — full case detail (message + attempts + submission)
export async function fetchMessageDetail(messageId: string): Promise<MessageDetail> {
  const { data } = await apiClient.get(`/patient-engagement/messages/${messageId}/detail`);
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

// patient_engagement_v3_2 — \"使链接失效\" (revoke). Patient sees a friendly reason.
export async function invalidateFormLink(formLinkId: string, reason: string) {
  const { data } = await apiClient.post(`/patient-engagement/form-links/${formLinkId}/revoke`, {
    reason,
  });
  return data;
}

// patient_engagement_v3_2 — resend reuses the same case (no new message row).
export async function resendMessage(messageId: string, preferredChannel?: PreferredChannel) {
  const { data } = await apiClient.post(`/patient-engagement/messages/${messageId}/resend`, {
    preferredChannel,
  });
  return data;
}
