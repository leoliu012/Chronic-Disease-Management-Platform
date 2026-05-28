import { apiFetch } from './client';

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export type CareReminderSchedule = {
  id: string;
  hospitalTenantId: string;
  patientId: string;
  sourceType: string;
  sourceId: string | null;
  title: string;
  description: string | null;
  reminderType: 'MEDICATION_CHECKIN' | 'VITAL_RECHECK' | 'QUESTIONNAIRE' | 'GENERAL_MESSAGE';
  frequencyUnit: 'DAY' | 'WEEK' | 'MONTH';
  timesPerUnit: number;
  scheduledTimes: string[] | null;
  scheduledDays: string[] | null;
  payload: Record<string, unknown> | null;
  reminderLeadMinutes: number;
  checkInWindowBeforeMinutes: number;
  checkInWindowAfterMinutes: number;
  escalationAfterMinutes: number | null;
  isActive: boolean;
  pausedAt: string | null;
  startDate: string | null;
  endDate: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { occurrences?: number };
};

export type CareReminderOccurrence = {
  id: string;
  hospitalTenantId: string;
  patientId: string;
  scheduleId: string;
  occurrenceType: string;
  title: string;
  dueAt: string;
  availableFrom: string;
  availableUntil: string;
  status:
    | 'PENDING'
    | 'SENDING'
    | 'SENT'
    | 'CLICKED'
    | 'COMPLETED'
    | 'MISSED'
    | 'ESCALATED'
    | 'CANCELED';
  formLinkId: string | null;
  outboundMessageId: string | null;
  sentAt: string | null;
  completedAt: string | null;
  missedAt: string | null;
  escalatedAt: string | null;
  escalatedTaskId: string | null;
  resultType: string | null;
  resultId: string | null;
  lastError: string | null;
  schedule?: CareReminderSchedule;
  patient?: { id: string; name: string; phone: string | null };
};

export type PatientDirectMessage = {
  id: string;
  hospitalTenantId: string;
  patientId: string;
  senderId: string;
  title: string;
  content: string;
  priority: 'NORMAL' | 'IMPORTANT' | 'URGENT';
  channel: 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS' | 'MANUAL_COPY';
  formLinkId: string | null;
  outboundMessageId: string | null;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'CLICKED' | 'ACKNOWLEDGED';
  requiresAck: boolean;
  acknowledgedAt: string | null;
  createdAt: string;
  sender?: { id: string; username: string; displayName: string; role: string };
};

// ---------------------------------------------------------------------------
// schedule endpoints
// ---------------------------------------------------------------------------

export function listSchedulesForPatient(patientId: string) {
  return apiFetch<CareReminderSchedule[]>(`/care-reminders/patients/${patientId}/schedules`);
}

export function createMedicationSchedule(
  patientId: string,
  body: {
    medicationId: string;
    title?: string;
    description?: string;
    scheduledTimes: string[];
    scheduledDays?: string[];
    escalationAfterMinutes?: number;
  },
) {
  return apiFetch<CareReminderSchedule>(
    `/care-reminders/patients/${patientId}/medication-schedules`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export function createVitalSchedule(
  patientId: string,
  body: {
    vitalType: string;
    title?: string;
    description?: string;
    scheduledTimes: string[];
    scheduledDays?: string[];
    escalationAfterMinutes?: number;
    vitalMonitoringPlanId?: string;
  },
) {
  return apiFetch<CareReminderSchedule>(
    `/care-reminders/patients/${patientId}/vital-schedules`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export function pauseSchedule(id: string) {
  return apiFetch<CareReminderSchedule>(`/care-reminders/schedules/${id}/pause`, { method: 'POST' });
}
export function resumeSchedule(id: string) {
  return apiFetch<CareReminderSchedule>(`/care-reminders/schedules/${id}/resume`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// occurrence endpoints
// ---------------------------------------------------------------------------

export function listOccurrencesForPatient(patientId: string, status?: string) {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiFetch<CareReminderOccurrence[]>(
    `/care-reminders/patients/${patientId}/occurrences${q}`,
  );
}

export function listTodayOccurrences() {
  return apiFetch<CareReminderOccurrence[]>(`/care-reminders/today`);
}
export function listMissedOccurrences() {
  return apiFetch<CareReminderOccurrence[]>(`/care-reminders/missed`);
}

export function sendOccurrenceNow(id: string) {
  return apiFetch<{ reused: boolean; occurrence: CareReminderOccurrence }>(
    `/care-reminders/occurrences/${id}/send-now`,
    { method: 'POST' },
  );
}
export function cancelOccurrence(id: string) {
  return apiFetch<CareReminderOccurrence>(`/care-reminders/occurrences/${id}/cancel`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// direct messages
// ---------------------------------------------------------------------------

export function listDirectMessages(patientId: string) {
  return apiFetch<PatientDirectMessage[]>(`/care-reminders/patients/${patientId}/messages`);
}

export function createDirectMessage(
  patientId: string,
  body: {
    title: string;
    content: string;
    priority?: 'NORMAL' | 'IMPORTANT' | 'URGENT';
    requiresAck?: boolean;
    preferredChannel?: 'AUTO' | 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS' | 'MANUAL_COPY';
  },
) {
  return apiFetch<{
    directMessage: PatientDirectMessage;
    formLink: { id: string };
    linkUrl: string;
  }>(`/care-reminders/patients/${patientId}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
