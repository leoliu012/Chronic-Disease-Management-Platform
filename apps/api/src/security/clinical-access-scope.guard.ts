import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AUDIT_METADATA_KEY,
  type AuditPolicy,
  resolveAuditString,
} from './audit.decorator';
import { AuditService } from './audit.service';
import type { RequestUser } from './request-user.type';
import { ClinicalAccessScopeService } from './clinical-access-scope.service';

type ScopedRequest = {
  method: string;
  path?: string;
  url?: string;
  params?: Record<string, string | undefined>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  user?: RequestUser;
};

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ACTOR_FIELDS = [
  'operatorId',
  'handledBy',
  'remindedBy',
  'revokedBy',
  'arrivalConfirmedBy',
  'noShowConfirmedBy',
  'refusalConfirmedBy',
  'senderId',
  'createdBy',
  'reviewedBy',
  'reviewedById',
];

@Injectable()
export class ClinicalAccessScopeGuard implements CanActivate {
  private readonly logger = new Logger(ClinicalAccessScopeGuard.name);

  constructor(
    private readonly access: ClinicalAccessScopeService,
    private readonly audit: AuditService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ScopedRequest>();
    const user = req.user;
    if (!user) return true; // Public H5 endpoints do not carry staff JWTs.

    const path = String(req.path || req.url || '').split('?')[0];
    const writable = WRITE_METHODS.has(String(req.method || 'GET').toUpperCase());

    try {
      await this.authorize(req, user, path, writable);
      return true;
    } catch (error) {
      await this.recordDeniedAccess(context, req, user, path, error);
      throw error;
    }
  }

  private async authorize(
    req: ScopedRequest,
    user: RequestUser,
    path: string,
    writable: boolean,
  ) {
    this.sanitizeClientControlledIdentity(req, user, path);

    const patientId = req.params?.patientId || this.match(path, /^\/patients\/([^/]+)/);
    if (patientId) {
      await (writable
        ? this.access.assertPatientWritable(user, patientId)
        : this.access.assertPatientVisible(user, patientId));
    }

    // Standalone clinical-record create endpoints carry patientId in body.
    // Treat it exactly like a URL object ID; never trust it merely because DTO validation passed.
    const bodyPatientId = typeof req.body?.patientId === 'string' ? req.body.patientId : undefined;
    if (bodyPatientId && bodyPatientId !== patientId) {
      await this.access.assertPatientWritable(user, bodyPatientId);
    }

    const directChecks: Array<[RegExp, () => Promise<unknown>, () => Promise<unknown>]> = [
      [/^\/tasks\/([^/]+)/, () => this.access.assertTaskVisible(user, this.match(path, /^\/tasks\/([^/]+)/)!), () => this.access.assertTaskWritable(user, this.match(path, /^\/tasks\/([^/]+)/)!)],
      [/^\/risk-alerts\/([^/]+)/, () => this.access.assertAlertVisible(user, this.match(path, /^\/risk-alerts\/([^/]+)/)!), () => this.access.assertAlertWritable(user, this.match(path, /^\/risk-alerts\/([^/]+)/)!)],
      [/^\/vital-records\/([^/]+)/, () => this.access.assertVitalRecordVisible(user, this.match(path, /^\/vital-records\/([^/]+)/)!), () => this.access.assertVitalRecordWritable(user, this.match(path, /^\/vital-records\/([^/]+)/)!)],
      [/^\/medications\/([^/]+)/, () => this.access.assertMedicationVisible(user, this.match(path, /^\/medications\/([^/]+)/)!), () => this.access.assertMedicationWritable(user, this.match(path, /^\/medications\/([^/]+)/)!)],
      [/^\/vital-monitoring-plans\/([^/]+)/, () => this.access.assertVitalPlanVisible(user, this.match(path, /^\/vital-monitoring-plans\/([^/]+)/)!), () => this.access.assertVitalPlanWritable(user, this.match(path, /^\/vital-monitoring-plans\/([^/]+)/)!)],
      [/^\/questionnaire-results\/([^/]+)/, () => this.access.assertQuestionnaireVisible(user, this.match(path, /^\/questionnaire-results\/([^/]+)/)!), () => this.access.assertQuestionnaireWritable(user, this.match(path, /^\/questionnaire-results\/([^/]+)/)!)],
      [/^\/follow-ups\/([^/]+)/, () => this.access.assertFollowUpVisible(user, this.match(path, /^\/follow-ups\/([^/]+)/)!), () => this.access.assertFollowUpWritable(user, this.match(path, /^\/follow-ups\/([^/]+)/)!)],
      [/^\/hospital-visit-reminders\/([^/]+)/, () => this.access.assertVisitReminderVisible(user, this.match(path, /^\/hospital-visit-reminders\/([^/]+)/)!), () => this.access.assertVisitReminderWritable(user, this.match(path, /^\/hospital-visit-reminders\/([^/]+)/)!)],
      [/^\/care-reminders\/schedules\/([^/]+)/, () => this.access.assertCareScheduleVisible(user, this.match(path, /^\/care-reminders\/schedules\/([^/]+)/)!), () => this.access.assertCareScheduleWritable(user, this.match(path, /^\/care-reminders\/schedules\/([^/]+)/)!)],
      [/^\/care-reminders\/occurrences\/([^/]+)/, () => this.access.assertCareOccurrenceVisible(user, this.match(path, /^\/care-reminders\/occurrences\/([^/]+)/)!), () => this.access.assertCareOccurrenceWritable(user, this.match(path, /^\/care-reminders\/occurrences\/([^/]+)/)!)],
      [/^\/encounter-records\/([^/]+)/, () => this.access.assertEncounterVisible(user, this.match(path, /^\/encounter-records\/([^/]+)/)!), () => this.access.assertEncounterWritable(user, this.match(path, /^\/encounter-records\/([^/]+)/)!)],
      [/^\/medical-record-summaries\/([^/]+)/, () => this.access.assertMedicalRecordVisible(user, this.match(path, /^\/medical-record-summaries\/([^/]+)/)!), () => this.access.assertMedicalRecordWritable(user, this.match(path, /^\/medical-record-summaries\/([^/]+)/)!)],
      [/^\/exam-reports\/([^/]+)/, () => this.access.assertExamReportVisible(user, this.match(path, /^\/exam-reports\/([^/]+)/)!), () => this.access.assertExamReportWritable(user, this.match(path, /^\/exam-reports\/([^/]+)/)!)],
      [/^\/hospital-medications\/([^/]+)/, () => this.access.assertHospitalMedicationVisible(user, this.match(path, /^\/hospital-medications\/([^/]+)/)!), () => this.access.assertHospitalMedicationWritable(user, this.match(path, /^\/hospital-medications\/([^/]+)/)!)],
    ];

    for (const [pattern, read, write] of directChecks) {
      if (!pattern.test(path)) continue;
      await (writable ? write() : read());
      break;
    }
  }

  private async recordDeniedAccess(
    context: ExecutionContext,
    req: ScopedRequest,
    user: RequestUser,
    path: string,
    error: unknown,
  ) {
    try {
      const policy = this.reflector.getAllAndOverride<AuditPolicy>(
        AUDIT_METADATA_KEY,
        [context.getHandler(), context.getClass()],
      );
      const resolutionContext = {
        params: req.params,
        query: req.query,
        body: req.body,
      };
      const targetId = policy
        ? resolveAuditString(resolutionContext, policy.targetIdFrom)
        : undefined;
      const patientId =
        resolveAuditString(resolutionContext, policy?.patientIdFrom) ??
        req.params?.patientId ??
        (typeof req.body?.patientId === 'string' ? req.body.patientId : undefined);

      await this.audit.record({
        user,
        action: policy ? `${policy.action}_DENIED` : 'CLINICAL_ACCESS_DENIED',
        targetType: policy?.target ?? 'ClinicalRoute',
        targetId: targetId ?? path,
        ipAddress: this.ipAddress(req),
        afterData: {
          outcome: 'DENIED',
          method: req.method,
          path,
          ...(patientId ? { patientId } : {}),
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
      });
    } catch (auditError) {
      this.logger.error(
        `failed to persist denied-access audit: ${
          auditError instanceof Error ? auditError.message : String(auditError)
        }`,
      );
    }
  }

  private ipAddress(req: ScopedRequest) {
    const forwardedFor = req.headers?.['x-forwarded-for'];
    return (
      Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor || req.socket?.remoteAddress
    )?.toString();
  }

  private match(path: string, pattern: RegExp): string | undefined {
    const value = path.match(pattern)?.[1];
    return value ? decodeURIComponent(value) : undefined;
  }

  private sanitizeClientControlledIdentity(req: ScopedRequest, user: RequestUser, path: string) {
    if (req.query) {
      // These filters are never a source of authorization. For the staff workbench,
      // ignore them entirely so URL tampering cannot impersonate another nurse.
      if (path === '/nurse-dashboard' || path === '/work-items') delete req.query.nurseId;
      if (user.role !== 'ADMIN') {
        delete req.query.nurseId;
        delete req.query.tenantId;
        delete req.query.hospitalTenantId;
      }
    }

    if (!req.body || Array.isArray(req.body)) return;
    for (const field of ACTOR_FIELDS) {
      if (field in req.body) req.body[field] = user.id;
    }
    if (user.role !== 'ADMIN') {
      delete req.body.nurseId;
      delete req.body.tenantId;
      delete req.body.hospitalTenantId;
      delete req.body.assigneeId;
      delete req.body.responsibleNurseId;
      delete req.body.responsibleDoctorId;
    }
  }
}
