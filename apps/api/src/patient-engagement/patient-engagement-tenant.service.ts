import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../security/request-user.type';

/**
 * PatientEngagementTenantService
 * -------------------------------
 * 集中放 multi-tenant 的权限校验逻辑.
 *
 * 为什么不放在 JWT / RequestUser 里:
 *   - 不想 invalidate 已发的 token
 *   - 不想动 shared auth 路径
 * 所以每次接口校验都从 DB 反查一次 user.hospitalTenantId.
 * 单次 select 很快, 远比错放患者数据安全得多.
 */
@Injectable()
export class PatientEngagementTenantService {
  constructor(private readonly prisma: PrismaService) {}

  /** ADMIN 跨租户; 其它角色严格限制到自己医院. MANAGER 仍受限. */
  async assertPatientVisibleToUser(patientId: string, user: RequestUser): Promise<{
    hospitalTenantId: string;
  }> {
    if (user.role === UserRole.ADMIN) {
      const patient = await this.prisma.patient.findUnique({
        where: { id: patientId },
        select: { hospitalTenantId: true },
      });
      if (!patient) throw new NotFoundException('Patient not found');
      if (!patient.hospitalTenantId) {
        throw new ForbiddenException('该患者尚未归属任何医院, 请先在医院档案中分配 tenant.');
      }
      return { hospitalTenantId: patient.hospitalTenantId };
    }

    const [patient, dbUser] = await Promise.all([
      this.prisma.patient.findUnique({
        where: { id: patientId },
        select: { hospitalTenantId: true },
      }),
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: { hospitalTenantId: true },
      }),
    ]);
    if (!patient) throw new NotFoundException('Patient not found');
    if (!patient.hospitalTenantId || !dbUser?.hospitalTenantId) {
      throw new ForbiddenException('当前用户或患者缺少 hospitalTenantId, 无法操作.');
    }
    if (patient.hospitalTenantId !== dbUser.hospitalTenantId) {
      throw new ForbiddenException('无权访问该患者');
    }
    return { hospitalTenantId: patient.hospitalTenantId };
  }

  /**
   * Resolve current user's tenant. ADMIN may legitimately return null if their
   * account isn't tied to any one hospital — callers must handle that case
   * (most of them require a tenant from the patient instead).
   */
  async resolveUserHospitalTenantId(user: RequestUser): Promise<string | null> {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { hospitalTenantId: true },
    });
    return dbUser?.hospitalTenantId ?? null;
  }

  /**
   * Resolve a patient by formLinkId or messageId, then check tenant.
   * Used by /messages/:id/resend, /form-links/:id/revoke, etc.
   */
  async assertFormLinkVisibleToUser(formLinkId: string, user: RequestUser): Promise<{
    hospitalTenantId: string;
    patientId: string;
  }> {
    const link = await this.prisma.patientFormLink.findUnique({
      where: { id: formLinkId },
      select: { patientId: true, hospitalTenantId: true },
    });
    if (!link) throw new NotFoundException('Form link not found');
    await this.assertPatientVisibleToUser(link.patientId, user);
    return {
      hospitalTenantId: link.hospitalTenantId ?? '',
      patientId: link.patientId,
    };
  }

  async assertMessageVisibleToUser(messageId: string, user: RequestUser): Promise<{
    hospitalTenantId: string;
    patientId: string;
  }> {
    const msg = await this.prisma.patientOutboundMessage.findUnique({
      where: { id: messageId },
      select: { patientId: true, hospitalTenantId: true },
    });
    if (!msg) throw new NotFoundException('Message not found');
    await this.assertPatientVisibleToUser(msg.patientId, user);
    return {
      hospitalTenantId: msg.hospitalTenantId ?? '',
      patientId: msg.patientId,
    };
  }

  /**
   * Defensive helper: MANAGER role must be blocked from any write operation
   * even if a controller forgets to list roles correctly.
   */
  assertWriteAllowed(user: RequestUser): void {
    if (user.role === UserRole.MANAGER) {
      throw new ForbiddenException('MANAGER 角色仅有只读权限, 不能创建或发送随访链接.');
    }
  }
}
