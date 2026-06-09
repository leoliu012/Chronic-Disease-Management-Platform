import { api } from './client';

export type DependencyProbe = {
  status: 'UP' | 'DOWN';
  latencyMs: number;
  error?: string;
};

export type AdminOpsSummary = {
  checkedAt: string;
  system: {
    status: 'UP' | 'DOWN';
    checkedAt: string;
    dependencies: {
      db: DependencyProbe;
      redis: DependencyProbe;
    };
  };
  reminderWorker: ReminderWorkerOps;
  gateway: GatewayOps;
  dataIntegrity: DataIntegrityOps;
  audit: {
    recentHighRiskActions: Array<{
      id: string;
      action: string;
      targetType: string;
      targetId?: string | null;
      operatorId?: string | null;
      createdAt: string;
    }>;
  };
};

export type ReminderWorkerOps = {
  latestSuccessfulRunAt?: string | null;
  latestRun?: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt?: string | null;
    error?: string | null;
  } | null;
  metrics24h: Record<string, number>;
  backlog: {
    byStatus: Record<string, number>;
    retryScheduled: number;
    stuckSending: number;
  };
  instances: Array<{
    instanceId: string;
    heartbeatAt: string;
    active: boolean;
    heartbeatInterrupted: boolean;
  }>;
};

export type GatewayOps = {
  enabledSources: number;
  conflictCount: number;
  retryExhaustedCount: number;
  retryScheduledCount: number;
  failedBatches24h: number;
  maxAttempts: number;
  latestBatch?: {
    id: string;
    status: string;
    startedAt: string;
    source?: { code: string; name: string } | null;
  } | null;
  recentConflicts: Array<{
    id: string;
    externalRecordType: string;
    externalRecordId: string;
    promotionMessage?: string | null;
    createdAt: string;
  }>;
};

export type DataIntegrityOps = {
  staleOpenTasks: number;
  orphanOpenAlerts: number;
  openEpisodesWithoutTask: number;
  patientsWithoutTenant: number;
  patientsWithoutResponsibleNurse: number;
  sourceLessBoundSchedules: number;
  duplicateScheduleGroups: number;
  duplicateExternalRecordGroups: number;
  activeLinksExpiringSoon: number;
  activeLinksAlreadyExpired: number;
};

export async function fetchAdminOpsSummary() {
  const response = await api.get<AdminOpsSummary>('/admin/ops/summary');
  return response.data;
}

export async function fetchReminderWorkerOps() {
  const response = await api.get<ReminderWorkerOps>('/admin/ops/reminder-worker');
  return response.data;
}

export async function fetchGatewayOps() {
  const response = await api.get<GatewayOps>('/admin/ops/gateway');
  return response.data;
}

export async function fetchDataIntegrityOps() {
  const response = await api.get<DataIntegrityOps>('/admin/ops/data-integrity');
  return response.data;
}
