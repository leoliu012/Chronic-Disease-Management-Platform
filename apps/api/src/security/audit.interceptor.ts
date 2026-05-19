import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';
import type { RequestUser } from './request-user.type';

type AuditedRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string };
  user?: RequestUser;
};

type AuditRouteMatch = {
  action: string;
  targetType: string;
  targetId?: string | null;
};

function matchAuditRoute(method: string, path: string): AuditRouteMatch | null {
  if (method === 'GET' && /^\/patients\/[^/]+$/.test(path)) {
    return {
      action: 'VIEW_PATIENT',
      targetType: 'Patient',
      targetId: path.split('/')[2],
    };
  }

  if (method === 'POST' && path === '/patients') {
    return { action: 'CREATE_PATIENT', targetType: 'Patient' };
  }

  const followUpMatch = path.match(/^\/patients\/([^/]+)\/follow-ups$/);
  if (method === 'POST' && followUpMatch) {
    return {
      action: 'CREATE_FOLLOW_UP',
      targetType: 'FollowUpRecord',
      targetId: followUpMatch[1],
    };
  }

  const alertMatch = path.match(/^\/risk-alerts\/([^/]+)\/(in-progress|resolve|dismiss)$/);
  if (method === 'PATCH' && alertMatch) {
    return {
      action: 'HANDLE_ALERT',
      targetType: 'RiskAlert',
      targetId: alertMatch[1],
    };
  }

  if (method === 'GET' && path === '/his/patients/export') {
    return { action: 'EXPORT_DATA', targetType: 'Patient' };
  }

  if (method === 'DELETE' && path.startsWith('/dev-tools/test-data')) {
    return { action: 'CLEAN_TEST_DATA', targetType: 'DevelopmentTestData' };
  }

  return null;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditedRequest>();
    const match = matchAuditRoute(request.method, request.path);

    if (!match || !request.user) {
      return next.handle();
    }

    const forwardedFor = request.headers['x-forwarded-for'];
    const ipAddress = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor || request.socket.remoteAddress;

    return next.handle().pipe(
      tap(async (responseBody) => {
        const responseId =
          responseBody && typeof responseBody === 'object' && 'id' in responseBody
            ? (responseBody as { id?: string }).id
            : undefined;

        await this.auditService.record({
          user: request.user,
          action: match.action,
          targetType: match.targetType,
          targetId: match.targetId,
          ipAddress: ipAddress?.toString(),
          afterData: {
            method: request.method,
            path: request.path,
            status: 'SUCCESS',
            ...(responseId ? { responseId } : {}),
          },
        });
      }),
    );
  }
}
