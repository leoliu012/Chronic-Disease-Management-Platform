import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { PatientSessionRequestContext } from './patient-session.type';

export const CurrentPatientSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PatientSessionRequestContext => {
    const request = ctx.switchToHttp().getRequest<{ patientSession: PatientSessionRequestContext }>();
    return request.patientSession;
  },
);
