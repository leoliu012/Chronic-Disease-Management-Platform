import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import type { RequestUser } from './request-user.type';

type FreshUser = RequestUser & { hospitalTenantId: string | null };
type PatientAccessRow = {
  id: string;
  hospitalTenantId: string | null;
  responsibleDoctorId: string | null;
  responsibleNurseId: string | null;
};

/**
 * Central object-level authorization for clinical data.
 *
 * Rules in this first care-team version:
 * - ADMIN: cross-tenant read/write is allowed and audited.
 * - MANAGER: read-only within the user's hospital.
 * - DOCTOR: read/write within the user's hospital.
 * - NURSE: read assigned patients plus the hospital's unassigned queue;
 *          write only patients assigned to the current nurse.
 *
 * The schema does not yet contain a nursing-group table. When that is added,
 * extend the NURSE predicates here only; callers should not implement their own
 * object authorization rules.
 */
@Injectable()
export class ClinicalAccessScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async freshUser(user: RequestUser): Promise<FreshUser> {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        hospitalTenantId: true,
        isActive: true,
      },
    });
    if (!row || !row.isActive) throw new ForbiddenException('当前登录用户不存在或已停用');
    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      role: row.role,
      hospitalTenantId: row.hospitalTenantId,
    };
  }

  private requireTenant(user: FreshUser): string {
    if (!user.hospitalTenantId) {
      throw new ForbiddenException('当前用户尚未归属任何医院，无法访问临床数据');
    }
    return user.hospitalTenantId;
  }

  private patientReadScopeFor(user: FreshUser): Prisma.PatientWhereInput {
    if (user.role === UserRole.ADMIN) return {};
    const hospitalTenantId = this.requireTenant(user);
    if (user.role === UserRole.NURSE) {
      return {
        hospitalTenantId,
        OR: [{ responsibleNurseId: user.id }, { responsibleNurseId: null }],
      };
    }
    return { hospitalTenantId };
  }

  private patientWriteScopeFor(user: FreshUser): Prisma.PatientWhereInput {
    if (user.role === UserRole.ADMIN) return {};
    if (user.role === UserRole.MANAGER) {
      throw new ForbiddenException('MANAGER 角色仅有只读权限');
    }
    const hospitalTenantId = this.requireTenant(user);
    if (user.role === UserRole.NURSE) {
      return { hospitalTenantId, responsibleNurseId: user.id };
    }
    return { hospitalTenantId };
  }

  private async patientListScopeFor(
    fresh: FreshUser,
    requestedAdminHospitalTenantId?: string | null,
  ): Promise<Prisma.PatientWhereInput> {
    if (fresh.role !== UserRole.ADMIN) return this.patientReadScopeFor(fresh);

    const hospitalTenantId = requestedAdminHospitalTenantId || fresh.hospitalTenantId;
    if (!hospitalTenantId) {
      throw new ForbiddenException('管理员列表查询必须显式选择医院');
    }
    const tenant = await this.prisma.hospitalTenant.findUnique({
      where: { id: hospitalTenantId },
      select: { id: true, isActive: true },
    });
    if (!tenant || !tenant.isActive) throw new NotFoundException('Hospital tenant not found');

    if (fresh.hospitalTenantId !== hospitalTenantId) {
      await this.audit.record({
        user: fresh,
        action: 'ADMIN_TENANT_SCOPE_SELECTED',
        targetType: 'HospitalTenant',
        targetId: hospitalTenantId,
        afterData: {
          adminHospitalTenantId: fresh.hospitalTenantId,
          selectedHospitalTenantId: hospitalTenantId,
        },
      });
    }
    return { hospitalTenantId };
  }

  async buildPatientScope(
    user: RequestUser,
    requestedAdminHospitalTenantId?: string | null,
  ): Promise<Prisma.PatientWhereInput> {
    return this.patientListScopeFor(await this.freshUser(user), requestedAdminHospitalTenantId);
  }

  async buildTaskScope(
    user: RequestUser,
    requestedAdminHospitalTenantId?: string | null,
  ): Promise<Prisma.TaskWhereInput> {
    const fresh = await this.freshUser(user);
    const patient = await this.patientListScopeFor(fresh, requestedAdminHospitalTenantId);
    if (fresh.role === UserRole.NURSE) {
      return {
        patient,
        OR: [{ assigneeId: fresh.id }, { assigneeId: null }],
      };
    }
    return { patient };
  }

  async buildAlertScope(
    user: RequestUser,
    requestedAdminHospitalTenantId?: string | null,
  ): Promise<Prisma.RiskAlertWhereInput> {
    return { patient: await this.buildPatientScope(user, requestedAdminHospitalTenantId) };
  }

  async resolveUserHospitalTenantId(user: RequestUser): Promise<string | null> {
    return (await this.freshUser(user)).hospitalTenantId;
  }

  async resolveCreatePatientTenant(user: RequestUser, requested?: string | null): Promise<string> {
    const fresh = await this.freshUser(user);
    if (fresh.role === UserRole.ADMIN) {
      const tenantId = requested || fresh.hospitalTenantId;
      if (!tenantId) throw new ForbiddenException('管理员建档时必须显式选择医院');
      const tenant = await this.prisma.hospitalTenant.findUnique({ where: { id: tenantId } });
      if (!tenant || !tenant.isActive) throw new NotFoundException('Hospital tenant not found');
      return tenantId;
    }
    return this.requireTenant(fresh);
  }

  async validatePatientAssignment(
    user: RequestUser,
    tenantId: string,
    responsibleDoctorId?: string | null,
    responsibleNurseId?: string | null,
  ): Promise<void> {
    const fresh = await this.freshUser(user);
    if (fresh.role !== UserRole.ADMIN && (responsibleDoctorId || responsibleNurseId)) {
      throw new ForbiddenException('普通医护不能通过患者建档接口指定责任医护，请使用带审计的分配流程');
    }
    const ids = [responsibleDoctorId, responsibleNurseId].filter(Boolean) as string[];
    if (!ids.length) return;
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, hospitalTenantId: tenantId, isActive: true },
      select: { id: true, role: true },
    });
    if (users.length !== ids.length) throw new ForbiddenException('责任医护必须属于患者所在医院且处于启用状态');
    if (responsibleDoctorId && !users.some((item) => item.id === responsibleDoctorId && item.role === UserRole.DOCTOR)) {
      throw new ForbiddenException('responsibleDoctorId 必须指向本院医生');
    }
    if (responsibleNurseId && !users.some((item) => item.id === responsibleNurseId && item.role === UserRole.NURSE)) {
      throw new ForbiddenException('responsibleNurseId 必须指向本院护士');
    }
  }

  async resolveTaskAssignee(
    user: RequestUser,
    patientId: string,
    requestedAssigneeId?: string | null,
  ): Promise<string | undefined> {
    const fresh = await this.freshUser(user);
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { hospitalTenantId: true, responsibleNurseId: true },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    if (fresh.role === UserRole.ADMIN && requestedAssigneeId) {
      const assignee = await this.prisma.user.findUnique({
        where: { id: requestedAssigneeId },
        select: { hospitalTenantId: true, isActive: true },
      });
      if (!assignee || !assignee.isActive || assignee.hospitalTenantId !== patient.hospitalTenantId) {
        throw new ForbiddenException('任务责任人必须是患者所在医院的启用用户');
      }
      return requestedAssigneeId;
    }

    if (fresh.role === UserRole.NURSE) return fresh.id;
    return patient.responsibleNurseId ?? undefined;
  }

  private async auditAdminCrossTenant(user: FreshUser, patient: PatientAccessRow, targetType: string, targetId: string, writable: boolean) {
    if (user.role !== UserRole.ADMIN) return;
    if (user.hospitalTenantId && user.hospitalTenantId === patient.hospitalTenantId) return;
    await this.audit.record({
      user,
      action: writable ? 'ADMIN_CROSS_TENANT_WRITE' : 'ADMIN_CROSS_TENANT_READ',
      targetType,
      targetId,
      afterData: {
        patientId: patient.id,
        patientHospitalTenantId: patient.hospitalTenantId,
        adminHospitalTenantId: user.hospitalTenantId,
      },
    });
  }

  private async assertPatient(user: RequestUser, patientId: string, writable: boolean): Promise<PatientAccessRow> {
    const fresh = await this.freshUser(user);
    const scope = writable ? this.patientWriteScopeFor(fresh) : this.patientReadScopeFor(fresh);
    const patient = await this.prisma.patient.findFirst({
      where: { AND: [{ id: patientId }, scope] },
      select: {
        id: true,
        hospitalTenantId: true,
        responsibleDoctorId: true,
        responsibleNurseId: true,
      },
    });
    if (!patient) throw new NotFoundException('Patient not found');
    await this.auditAdminCrossTenant(fresh, patient, 'Patient', patientId, writable);
    return patient;
  }

  assertPatientVisible(user: RequestUser, patientId: string) {
    return this.assertPatient(user, patientId, false);
  }

  assertPatientWritable(user: RequestUser, patientId: string) {
    return this.assertPatient(user, patientId, true);
  }

  private async assertTask(user: RequestUser, id: string, writable: boolean) {
    const fresh = await this.freshUser(user);
    if (writable && fresh.role === UserRole.MANAGER) throw new ForbiddenException('MANAGER 角色仅有只读权限');
    const patientScope = writable ? this.patientWriteScopeFor(fresh) : this.patientReadScopeFor(fresh);
    const taskScope: Prisma.TaskWhereInput = fresh.role === UserRole.NURSE
      ? { patient: patientScope, ...(writable ? { assigneeId: fresh.id } : { OR: [{ assigneeId: fresh.id }, { assigneeId: null }] }) }
      : { patient: patientScope };
    const task = await this.prisma.task.findFirst({ where: { AND: [{ id }, taskScope] }, select: { id: true, patientId: true } });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  assertTaskVisible(user: RequestUser, id: string) { return this.assertTask(user, id, false); }
  assertTaskWritable(user: RequestUser, id: string) { return this.assertTask(user, id, true); }

  private async assertAlert(user: RequestUser, id: string, writable: boolean) {
    const alert = await this.prisma.riskAlert.findUnique({ where: { id }, select: { id: true, patientId: true } });
    if (!alert) throw new NotFoundException('Risk alert not found');
    await (writable ? this.assertPatientWritable(user, alert.patientId) : this.assertPatientVisible(user, alert.patientId));
    return alert;
  }

  assertAlertVisible(user: RequestUser, id: string) { return this.assertAlert(user, id, false); }
  assertAlertWritable(user: RequestUser, id: string) { return this.assertAlert(user, id, true); }

  private async assertPatientResource(
    user: RequestUser,
    model: 'vitalRecord' | 'medicationRecord' | 'vitalMonitoringPlan' | 'questionnaireResult' | 'followUpRecord' | 'hospitalVisitReminder' | 'careReminderSchedule' | 'careReminderOccurrence' | 'encounterRecord' | 'medicalRecordSummary' | 'examReportRecord' | 'hospitalMedicationOrder',
    id: string,
    writable: boolean,
  ) {
    const row = await (this.prisma[model] as any).findUnique({ where: { id }, select: { id: true, patientId: true } });
    if (!row) throw new NotFoundException('Clinical object not found');
    await (writable ? this.assertPatientWritable(user, row.patientId) : this.assertPatientVisible(user, row.patientId));
    return row;
  }

  assertVitalRecordVisible(user: RequestUser, id: string) { return this.assertPatientResource(user, 'vitalRecord', id, false); }
  assertVitalRecordWritable(user: RequestUser, id: string) { return this.assertPatientResource(user, 'vitalRecord', id, true); }
  assertMedicationVisible(user: RequestUser, id: string) { return this.assertPatientResource(user, 'medicationRecord', id, false); }
  assertMedicationWritable(user: RequestUser, id: string) { return this.assertPatientResource(user, 'medicationRecord', id, true); }
  assertVitalPlanVisible(user: RequestUser, id: string) { return this.assertPatientResource(user, 'vitalMonitoringPlan', id, false); }
  assertVitalPlanWritable(user: RequestUser, id: string) { return this.assertPatientResource(user, 'vitalMonitoringPlan', id, true); }
  assertQuestionnaireVisible(user: RequestUser, id: string) { return this.assertPatientResource(user, 'questionnaireResult', id, false); }
  assertQuestionnaireWritable(user: RequestUser, id: string) { return this.assertPatientResource(user, 'questionnaireResult', id, true); }
  assertFollowUpVisible(user: RequestUser, id: string) { return this.assertPatientResource(user, 'followUpRecord', id, false); }
  assertFollowUpWritable(user: RequestUser, id: string) { return this.assertPatientResource(user, 'followUpRecord', id, true); }
  assertVisitReminderVisible(user: RequestUser, id: string) { return this.assertPatientResource(user, 'hospitalVisitReminder', id, false); }
  assertVisitReminderWritable(user: RequestUser, id: string) { return this.assertPatientResource(user, 'hospitalVisitReminder', id, true); }
  assertCareScheduleVisible(user: RequestUser, id: string) { return this.assertPatientResource(user, 'careReminderSchedule', id, false); }
  assertCareScheduleWritable(user: RequestUser, id: string) { return this.assertPatientResource(user, 'careReminderSchedule', id, true); }
  assertCareOccurrenceVisible(user: RequestUser, id: string) { return this.assertPatientResource(user, 'careReminderOccurrence', id, false); }
  assertCareOccurrenceWritable(user: RequestUser, id: string) { return this.assertPatientResource(user, 'careReminderOccurrence', id, true); }
  assertEncounterVisible(user: RequestUser, id: string) { return this.assertPatientResource(user, 'encounterRecord', id, false); }
  assertEncounterWritable(user: RequestUser, id: string) { return this.assertPatientResource(user, 'encounterRecord', id, true); }
  assertMedicalRecordVisible(user: RequestUser, id: string) { return this.assertPatientResource(user, 'medicalRecordSummary', id, false); }
  assertMedicalRecordWritable(user: RequestUser, id: string) { return this.assertPatientResource(user, 'medicalRecordSummary', id, true); }
  assertExamReportVisible(user: RequestUser, id: string) { return this.assertPatientResource(user, 'examReportRecord', id, false); }
  assertExamReportWritable(user: RequestUser, id: string) { return this.assertPatientResource(user, 'examReportRecord', id, true); }
  assertHospitalMedicationVisible(user: RequestUser, id: string) { return this.assertPatientResource(user, 'hospitalMedicationOrder', id, false); }
  assertHospitalMedicationWritable(user: RequestUser, id: string) { return this.assertPatientResource(user, 'hospitalMedicationOrder', id, true); }
}
