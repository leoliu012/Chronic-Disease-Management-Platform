import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, catchError, from, map, mergeMap, of, throwError } from 'rxjs';
import {
  AUDIT_METADATA_KEY,
  type AuditPolicy,
  resolveAuditDetails,
  resolveAuditString,
} from './audit.decorator';
import { AuditService } from './audit.service';
import { resolveClientIp, type ClientIpRequest } from './client-ip.util';
import type { RequestUser } from './request-user.type';

type AuditedRequest = ClientIpRequest & {
  method: string;
  path?: string;
  originalUrl?: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  user?: RequestUser;
};

type AuditedResponse = { statusCode?: number };

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const policy = this.reflector.getAllAndOverride<AuditPolicy>(AUDIT_METADATA_KEY, [context.getHandler(), context.getClass()]);
    const request = context.switchToHttp().getRequest<AuditedRequest>();
    const response = context.switchToHttp().getResponse<AuditedResponse>();
    if (!policy || !request.user) return next.handle();

    const execute = () => next.handle().pipe(
      mergeMap((responseBody) =>
        from(this.record(policy, request, responseBody, { outcome: 'SUCCESS', statusCode: response.statusCode ?? 200 })).pipe(
          map(() => responseBody),
          catchError((auditError: unknown) => {
            this.logAuditFailure(policy, auditError);
            if (policy.mode === 'REQUIRED') {
              return throwError(() => this.requiredAuditUnavailable());
            }
            return of(responseBody);
          }),
        ),
      ),
      catchError((error: unknown) =>
        from(this.record(policy, request, undefined, {
          outcome: 'FAILURE',
          statusCode: this.errorStatus(error) ?? response.statusCode ?? 500,
          errorName: this.errorName(error),
        })).pipe(
          catchError((auditError: unknown) => {
            this.logAuditFailure(policy, auditError);
            return of(undefined);
          }),
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );

    if (policy.mode !== 'REQUIRED') return execute();
    // REQUIRED operations write a durable ATTEMPT event before handler code runs.
    // This prevents sensitive handlers from executing while the audit store is
    // unavailable. The final SUCCESS/FAILURE row remains a separate completion
    // event; service-level transactions can tighten atomicity further as needed.
    return from(this.record(policy, request, undefined, { outcome: 'ATTEMPT', statusCode: 0 })).pipe(
      catchError((auditError: unknown) => {
        this.logAuditFailure(policy, auditError);
        return throwError(() => this.requiredAuditUnavailable());
      }),
      mergeMap(() => execute()),
    );
  }

  private requiredAuditUnavailable() {
    return new ServiceUnavailableException({
      code: 'AUDIT_REQUIRED_UNAVAILABLE',
      message: '审计写入不可用，敏感操作已拒绝执行，请联系管理员核验数据库状态。',
    });
  }

  private async record(
    policy: AuditPolicy,
    request: AuditedRequest,
    responseBody: unknown,
    result: { outcome: 'ATTEMPT' | 'SUCCESS' | 'FAILURE'; statusCode: number; errorName?: string },
  ) {
    const resolutionContext = { params: request.params, query: request.query, body: request.body, response: responseBody };
    const targetId = resolveAuditString(resolutionContext, policy.targetIdFrom) ?? resolveAuditString(resolutionContext, 'response.id');
    const patientId = resolveAuditString(resolutionContext, policy.patientIdFrom);
    const ip = resolveClientIp(request);
    await this.auditService.record({
      user: request.user,
      action: policy.action,
      targetType: policy.target,
      targetId,
      ipAddress: ip.clientIp ?? undefined,
      afterData: {
        outcome: result.outcome,
        auditMode: policy.mode ?? 'BEST_EFFORT',
        method: request.method,
        path: request.path ?? request.originalUrl ?? '',
        statusCode: result.statusCode,
        remoteAddress: ip.remoteAddress,
        trustedProxy: ip.trustedProxy,
        ...(ip.forwardedFor ? { forwardedFor: ip.forwardedFor } : {}),
        ...(patientId ? { patientId } : {}),
        ...resolveAuditDetails(resolutionContext, policy.detailsFrom),
        ...(result.errorName ? { errorName: result.errorName } : {}),
      },
    });
  }

  private errorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const status = (error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
    return typeof status === 'number' ? status : undefined;
  }
  private errorName(error: unknown): string { return error instanceof Error ? error.name.slice(0, 120) : 'UnknownError'; }
  private logAuditFailure(policy: AuditPolicy, error: unknown) {
    this.logger.error(`failed to persist audit event ${policy.action}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
