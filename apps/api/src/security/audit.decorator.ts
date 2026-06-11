import { SetMetadata } from '@nestjs/common';

export const AUDIT_METADATA_KEY = 'clinicalAuditPolicy';

export type AuditValueSource = string | string[];

export type AuditMode = 'BEST_EFFORT' | 'REQUIRED';

export type AuditPolicy = {
  action: string;
  target: string;
  /** REQUIRED performs a durable ATTEMPT write before invoking the handler. */
  mode?: AuditMode;
  targetIdFrom?: AuditValueSource;
  patientIdFrom?: AuditValueSource;
  detailsFrom?: Record<string, AuditValueSource>;
};

type AuditResolutionContext = {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  response?: unknown;
};

export const Audit = (policy: AuditPolicy) =>
  SetMetadata(AUDIT_METADATA_KEY, policy);

export function resolveAuditValue(
  context: AuditResolutionContext,
  source?: AuditValueSource,
): unknown {
  const candidates = Array.isArray(source) ? source : source ? [source] : [];

  for (const candidate of candidates) {
    const value = readPath(context, candidate);
    if (isUsefulAuditValue(value)) return value;
  }

  return undefined;
}

export function resolveAuditString(
  context: AuditResolutionContext,
  source?: AuditValueSource,
): string | undefined {
  const value = resolveAuditValue(context, source);
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

export function resolveAuditDetails(
  context: AuditResolutionContext,
  detailsFrom?: Record<string, AuditValueSource>,
): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  if (!detailsFrom) return details;

  for (const [key, source] of Object.entries(detailsFrom)) {
    if (looksSensitive(key)) continue;
    const value = resolveAuditValue(context, source);
    const sanitized = sanitizeAuditValue(value);
    if (sanitized !== undefined) details[key] = sanitized;
  }

  return details;
}

function readPath(context: AuditResolutionContext, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let current: unknown = context;

  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function isUsefulAuditValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function sanitizeAuditValue(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value.slice(0, 240);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => sanitizeAuditValue(item))
      .filter((item) => item !== undefined);
  }
  return undefined;
}

function looksSensitive(key: string): boolean {
  return /(secret|token|password|full.?key|key.?hash|content|description|note|reason|answer|payload)/i.test(
    key,
  );
}
