import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PatientAppService } from './patient-app.service';
import type { PatientSessionRequest } from './patient-session.type';

@Injectable()
export class PatientSessionGuard implements CanActivate {
  constructor(private readonly patientAppService: PatientAppService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PatientSessionRequest>();
    const rawHeader = request.headers['x-patient-token'];
    const token = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!token) {
      throw new UnauthorizedException('Missing patient session token');
    }

    request.patientSession = await this.patientAppService.verifyPatientToken(String(token));
    return true;
  }
}
