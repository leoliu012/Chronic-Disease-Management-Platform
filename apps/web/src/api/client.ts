import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { buildAutoTaskProcessingEventPayload, rememberClinicalEntitySnapshotsFromResponse } from '../utils/taskProcessingContext';

export const AUTH_TOKEN_STORAGE_KEY = 'chronic_care_access_token';
export const AUTH_USER_STORAGE_KEY = 'chronic_care_current_user';

const DEFAULT_API_BASE_URL = '/api';
const OPERATION_NOTICE_EVENT = 'operation-notice';
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function normalizeBaseUrl(value?: string) {
  const raw = String(value || '').trim();
  return (raw || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
}

export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
export const API_ENV_SOURCE = import.meta.env.VITE_API_BASE_URL
  ? 'VITE_API_BASE_URL'
  : 'default-localhost';

export type ApiConnectionErrorDetail = {
  message: string;
  baseURL: string;
  status?: number;
  code?: string;
};

export type OperationNoticeDetail = {
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  operationKey?: string;
};

export function emitOperationNotice(detail: OperationNoticeDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<OperationNoticeDetail>(OPERATION_NOTICE_EVENT, { detail }));
}

export function getApiEnvironmentNotice() {
  if (import.meta.env.PROD && API_ENV_SOURCE === 'default-localhost') {
    return '生产构建未配置 VITE_API_BASE_URL，当前仍指向 http://localhost:3000。请检查部署环境变量。';
  }

  return '';
}

export function getApiErrorMessage(error: unknown, fallback = '请求失败，请稍后重试。') {
  const axiosError = error as AxiosError<{ message?: string | string[]; code?: string }>;

  if (axiosError.response?.data?.message) {
    if (Array.isArray(axiosError.response.data.message)) {
      return axiosError.response.data.message.join('；');
    }
    return String(axiosError.response.data.message);
  }

  if (axiosError.response?.status === 503) {
    return '后端服务暂不可用。请检查数据库迁移、Prisma Client 和 seed 数据是否已初始化。';
  }

  if (axiosError.code === 'ECONNABORTED') {
    return `请求超时。请确认后端 API 是否可访问：${API_BASE_URL}`;
  }

  if (axiosError.request && !axiosError.response) {
    return `无法连接后端 API：${API_BASE_URL}。请确认 apps/api 已启动，或检查 VITE_API_BASE_URL。`;
  }

  return fallback;
}

function emitApiConnectionError(error: unknown) {
  const axiosError = error as AxiosError<{ message?: string | string[]; code?: string }>;
  const shouldNotify =
    !axiosError.response ||
    axiosError.code === 'ECONNABORTED' ||
    Boolean(axiosError.response?.status && axiosError.response.status >= 500);

  if (!shouldNotify || typeof window === 'undefined') return;

  const detail: ApiConnectionErrorDetail = {
    message: getApiErrorMessage(error),
    baseURL: API_BASE_URL,
    status: axiosError.response?.status,
    code: axiosError.code,
  };

  window.dispatchEvent(new CustomEvent<ApiConnectionErrorDetail>('api-connection-error', { detail }));
}

function isMutation(config: InternalAxiosRequestConfig) {
  return MUTATION_METHODS.has(String(config.method || 'GET').toUpperCase());
}

function stableSerialize(value: unknown) {
  if (value === undefined || value === null || value === '') return '';

  try {
    return JSON.stringify(value, (_key, item) => {
      if (item instanceof Date) return item.toISOString();
      return item;
    });
  } catch {
    return String(value);
  }
}

function getMutationDedupeKey(config: InternalAxiosRequestConfig) {
  const method = String(config.method || 'GET').toUpperCase();
  const url = String(config.url || '');
  const params = stableSerialize(config.params);

  // Intentionally do not include request body. Many clinical actions include timestamps
  // generated at click time, which would make rapid duplicate submissions look unique.
  // The short in-flight window below prevents double-click accidents while still allowing
  // a new operation after the current request finishes.
  return `${method} ${url}?${params}`;
}

function inferOperationSuccessMessage(config?: InternalAxiosRequestConfig) {
  const method = String(config?.method || '').toUpperCase();
  const url = String(config?.url || '');

  if (!MUTATION_METHODS.has(method)) return null;
  if (url.includes('/risk-alerts/') && url.includes('/resolve')) return '风险预警已标记为已处理。';
  if (url.includes('/risk-alerts/') && url.includes('/dismiss')) return '风险预警已忽略，并已记录操作。';
  if (url.includes('/risk-alerts/') && url.includes('/in-progress')) return '风险预警已进入处理中。';
  if (url.includes('/tasks/') && url.includes('/complete-processing')) return '任务处理完成已提交，处理流程已保存。';
  if (url.includes('/tasks/') && url.includes('/start-processing')) return '任务已进入处理中。';
  if (url.includes('/tasks/') && url.includes('/status')) return '待办任务状态已更新。';
  if (url.includes('/vital-records')) return '健康指标已保存，系统已完成异常规则检查。';
  if (url.includes('/disease-profiles')) return '慢病档案已保存。';
  if (url.includes('/vital-monitoring-plans')) return '指标监测计划已保存。';
  if (url.includes('/medications')) return '用药计划已保存。';
  if (url.includes('/follow-ups')) return '随访记录已保存。';
  if (url.includes('/questionnaire')) return '问卷记录已保存。';
  if (url.includes('/patient-app/bindings')) return '患者绑定申请已提交。';
  if (url.includes('/integrations/mock-sync')) return '接口模拟同步任务已完成。';
  if (url.includes('/clinical-rules')) return '规则配置已保存。';
  if (url.includes('/patients')) return '患者档案已保存。';
  if (method === 'DELETE') return '删除/停用操作已完成，并保留必要审计记录。';
  return '操作已成功提交。';
}

function normalizeRequestPath(url?: string) {
  return String(url || '').split('?')[0] || '';
}

function getSnapshotPrefetchUrl(config: InternalAxiosRequestConfig) {
  const method = String(config.method || 'GET').toUpperCase();
  if (!['PATCH', 'PUT', 'DELETE'].includes(method)) return null;
  if (config.headers?.['X-Suppress-Clinical-Snapshot-Prefetch']) return null;

  const path = normalizeRequestPath(String(config.url || ''));
  if (!path) return null;
  if (
    path.includes('/processing-events') ||
    path.includes('/start-processing') ||
    path.includes('/complete-processing') ||
    path.includes('/status') ||
    path.includes('/resolve') ||
    path.includes('/dismiss') ||
    path.includes('/in-progress') ||
    path.includes('/arrived') ||
    path.includes('/no-show') ||
    path.includes('/refused') ||
    path.includes('/remind-again')
  ) {
    return null;
  }

  const directResourcePattern = /(?:^|\/)(medications|vital-monitoring-plans|follow-ups|disease-profiles|questionnaire-results|vital-records)\/[^/]+$/;
  const patientPattern = /(?:^|\/)patients\/[^/]+$/;
  if (!directResourcePattern.test(path) && !patientPattern.test(path)) return null;

  return String(config.url || '');
}

async function prefetchClinicalSnapshotForMutation(config: InternalAxiosRequestConfig, token?: string | null) {
  const url = getSnapshotPrefetchUrl(config);
  if (!url) return;

  try {
    const response = await axios.request({
      baseURL: API_BASE_URL,
      url,
      method: 'GET',
      timeout: 5000,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    rememberClinicalEntitySnapshotsFromResponse(url, response.data);
  } catch (error) {
    // Snapshot prefetch is a best-effort UX enhancement. The actual mutation should still proceed.
    console.warn('Clinical snapshot prefetch failed', error);
  }
}

function enqueueAutoTaskProcessingEvent(config?: InternalAxiosRequestConfig, responseData?: unknown) {
  if (typeof window === 'undefined' || !config || !isMutation(config)) return;
  if (config.headers?.['X-Suppress-Task-Processing-Event']) return;

  const payload = buildAutoTaskProcessingEventPayload(
    String(config.method || 'GET').toUpperCase(),
    String(config.url || ''),
    config.data,
    responseData,
  );

  if (!payload) return;

  window.setTimeout(() => {
    api.post(
      `/tasks/${payload.taskId}/processing-events`,
      {
        eventType: payload.eventType,
        title: payload.title,
        description: payload.description,
        sourceType: payload.sourceType,
        sourceId: payload.sourceId,
      },
      {
        headers: {
          'X-Suppress-Operation-Notice': '1',
          'X-Suppress-Task-Processing-Event': '1',
        },
      },
    )
      .then(() => {
        window.dispatchEvent(new CustomEvent('task-processing-events-updated', {
          detail: { taskId: payload.taskId, patientId: payload.patientId },
        }));
      })
      .catch((error) => {
        console.warn('Auto task processing event association failed', error);
      });
  }, 0);
}

const inFlightMutations = new Map<string, Promise<unknown>>();

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

const defaultAdapter = (axios as any).getAdapter(api.defaults.adapter);

api.defaults.adapter = async (config) => {
  if (!isMutation(config)) {
    return defaultAdapter(config);
  }

  const dedupeKey = getMutationDedupeKey(config);
  const existingRequest = inFlightMutations.get(dedupeKey);

  if (existingRequest) {
    emitOperationNotice({
      type: 'warning',
      title: '正在处理中，请勿重复提交',
      message: '检测到相同操作仍在提交中，系统已拦截重复请求，避免重复建档、重复生成任务或重复处理预警。',
      operationKey: dedupeKey,
    });
    return existingRequest as Promise<any>;
  }

  const requestPromise = Promise.resolve(defaultAdapter(config)).finally(() => {
    window.setTimeout(() => {
      inFlightMutations.delete(dedupeKey);
    }, 350);
  });

  inFlightMutations.set(dedupeKey, requestPromise);
  return requestPromise as Promise<any>;
};

api.interceptors.request.use(async (config) => {
  const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  await prefetchClinicalSnapshotForMutation(config, token);
  return config;
});

api.interceptors.response.use(
  (response) => {
    const successMessage = inferOperationSuccessMessage(response.config);
    const suppressNotice = response.config.headers?.['X-Suppress-Operation-Notice'];

    if (successMessage && !suppressNotice) {
      emitOperationNotice({
        type: 'success',
        title: '操作成功',
        message: successMessage,
        operationKey: getMutationDedupeKey(response.config),
      });
    }

    enqueueAutoTaskProcessingEvent(response.config, response.data);
    rememberClinicalEntitySnapshotsFromResponse(String(response.config?.url || ''), response.data);

    return response;
  },
  (error) => {
    emitApiConnectionError(error);

    const axiosError = error as AxiosError;
    const suppressNotice = axiosError.config?.headers?.['X-Suppress-Operation-Notice'];
    if (!suppressNotice && axiosError.response?.status && axiosError.response.status !== 401) {
      emitOperationNotice({
        type: 'error',
        title: '操作失败',
        message: getApiErrorMessage(error),
      });
    }

    if (error.response?.status === 401) {
      localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      localStorage.removeItem(AUTH_USER_STORAGE_KEY);
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

/**
 * Compatibility wrapper for v3 API modules that use a fetch-like helper.
 * It delegates to the existing axios instance `api`, so auth headers,
 * session-expiry handling, operation notices, and base URL behavior stay
 * consistent with the rest of the app.
 */
export async function apiFetch<T>(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<T> {
  const method = init.method || 'GET';

  let data = init.body;
  const headers: Record<string, string> = {
    ...(init.headers || {}),
  };

  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (trimmed) {
      try {
        data = JSON.parse(trimmed);
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      } catch {
        // Keep non-JSON strings as-is.
      }
    }
  }

  const response = await api.request<T>({
    url,
    method,
    data,
    headers,
  });

  return response.data;
}

