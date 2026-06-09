import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
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
import type { RequestUser } from './request-user.type';

type AuditedRequest = {
  method: string;
  path?: string;
  originalUrl?: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string };
  user?: RequestUser;
};

type AuditedResponse = {
  statusCode?: number;
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const policy = this.reflector.getAllAndOverride<AuditPolicy>(
      AUDIT_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    const request = context.switchToHttp().getRequest<AuditedRequest>();
    const response = context.switchToHttp().getResponse<AuditedResponse>();

    if (!policy || !request.user) return next.handle();

    return next.handle().pipe(
      mergeMap((responseBody) =>
        from(
          this.record(policy, request, responseBody, {
            outcome: 'SUCCESS',
            statusCode: response.statusCode ?? 200,
          }),
        ).pipe(
          map(() => responseBody),
          catchError((auditError: unknown) => {
            this.logAuditFailure(policy, auditError);
            return of(responseBody);
          }),
        ),
      ),
      catchError((error: unknown) =>
        from(
          this.record(policy, request, undefined, {
            outcome: 'FAILURE',
            statusCode: this.errorStatus(error) ?? response.statusCode ?? 500,
            errorName: this.errorName(error),
          }),
        ).pipe(
          catchError((auditError: unknown) => {
            this.logAuditFailure(policy, auditError);
            return of(undefined);
          }),
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );
  }

  private async record(
    policy: AuditPolicy,
    request: AuditedRequest,
    responseBody: unknown,
    result: {
      outcome: 'SUCCESS' | 'FAILURE';
      statusCode: number;
      errorName?: string;
    },
  ) {
    const resolutionContext = {
      params: request.params,
      query: request.query,
      body: request.body,
      response: responseBody,
    };
    const targetId =
      resolveAuditString(resolutionContext, policy.targetIdFrom) ??
      resolveAuditString(resolutionContext, 'response.id');
    const patientId = resolveAuditString(
      resolutionContext,
      policy.patientIdFrom,
    );

    await this.auditService.record({
      user: request.user,
      action: policy.action,
      targetType: policy.target,
      targetId,
      ipAddress: this.ipAddress(request),
      afterData: {
        outcome: result.outcome,
        method: request.method,
        path: request.path ?? request.originalUrl ?? '',
        statusCode: result.statusCode,
        ...(patientId ? { patientId } : {}),
        ...resolveAuditDetails(resolutionContext, policy.detailsFrom),
        ...(result.errorName ? { errorName: result.errorName } : {}),
      },
    });
  }

  private ipAddress(request: AuditedRequest) {
    const forwardedFor = request.headers['x-forwarded-for'];
    return (
      Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor || request.socket.remoteAddress
    )?.toString();
  }

  private errorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const status = (error as { status?: unknown; statusCode?: unknown }).status ??
      (error as { statusCode?: unknown }).statusCode;
    return typeof status === 'number' ? status : undefined;
  }

  private errorName(error: unknown): string {
    if (error instanceof Error) return error.name.slice(0, 120);
    return 'UnknownError';
  }

  private logAuditFailure(policy: AuditPolicy, error: unknown) {
    this.logger.error(
      `failed to persist audit event ${policy.action}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
