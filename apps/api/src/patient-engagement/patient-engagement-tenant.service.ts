import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicalAccessScopeService } from '../security/clinical-access-scope.service';
import type { RequestUser } from '../security/request-user.type';

@Injectable()
export class PatientEngagementTenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClinicalAccessScopeService,
  ) {}

  async assertPatientVisibleToUser(
    patientId: string,
    user: RequestUser,
  ): Promise<{ hospitalTenantId: string }> {
    const patient = await this.access.assertPatientVisible(user, patientId);
    if (!patient.hospitalTenantId) {
      throw new ForbiddenException('该患者尚未归属任何医院');
    }
    return { hospitalTenantId: patient.hospitalTenantId };
  }

  async assertPatientWritableToUser(
    patientId: string,
    user: RequestUser,
  ): Promise<{ hospitalTenantId: string }> {
    const patient = await this.access.assertPatientWritable(user, patientId);
    if (!patient.hospitalTenantId) {
      throw new ForbiddenException('该患者尚未归属任何医院');
    }
    return { hospitalTenantId: patient.hospitalTenantId };
  }

  resolveUserHospitalTenantId(user: RequestUser) {
    return this.access.resolveUserHospitalTenantId(user);
  }

  async assertFormLinkVisibleToUser(id: string, user: RequestUser) {
    const row = await this.prisma.patientFormLink.findUnique({
      where: { id },
      select: { patientId: true, hospitalTenantId: true },
    });
    if (!row) throw new NotFoundException('Form link not found');
    const patient = await this.assertPatientVisibleToUser(row.patientId, user);
    this.assertSameTenant(row.hospitalTenantId, patient.hospitalTenantId);
    return row;
  }

  async assertMessageVisibleToUser(id: string, user: RequestUser) {
    const row = await this.prisma.patientOutboundMessage.findUnique({
      where: { id },
      select: { patientId: true, hospitalTenantId: true },
    });
    if (!row) throw new NotFoundException('Message not found');
    const patient = await this.assertPatientVisibleToUser(row.patientId, user);
    this.assertSameTenant(row.hospitalTenantId, patient.hospitalTenantId);
    return row;
  }

  async assertFormLinkWritableToUser(id: string, user: RequestUser) {
    const row = await this.prisma.patientFormLink.findUnique({
      where: { id },
      select: { patientId: true, hospitalTenantId: true },
    });
    if (!row) throw new NotFoundException('Form link not found');
    const patient = await this.assertPatientWritableToUser(row.patientId, user);
    this.assertSameTenant(row.hospitalTenantId, patient.hospitalTenantId);
    return row;
  }

  async assertMessageWritableToUser(id: string, user: RequestUser) {
    const row = await this.prisma.patientOutboundMessage.findUnique({
      where: { id },
      select: { patientId: true, hospitalTenantId: true },
    });
    if (!row) throw new NotFoundException('Message not found');
    const patient = await this.assertPatientWritableToUser(row.patientId, user);
    this.assertSameTenant(row.hospitalTenantId, patient.hospitalTenantId);
    return row;
  }

  assertWriteAllowed(user: RequestUser) {
    if (user.role === UserRole.MANAGER) {
      throw new ForbiddenException('MANAGER 角色仅有只读权限');
    }
  }

  private assertSameTenant(actual: string, expected: string) {
    if (actual !== expected) {
      throw new ForbiddenException('患者触达记录与患者医院归属不一致');
    }
  }
}
