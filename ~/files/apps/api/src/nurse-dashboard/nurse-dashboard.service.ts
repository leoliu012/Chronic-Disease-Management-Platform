import { Injectable } from '@nestjs/common';
import { AlertStatus, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicalAccessScopeService } from '../security/clinical-access-scope.service';
import type { RequestUser } from '../security/request-user.type';

@Injectable()
export class NurseDashboardService {
  constructor(private readonly prisma: PrismaService, private readonly access: ClinicalAccessScopeService) {}

  async getDashboard(user: RequestUser) {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const patientScope = await this.access.buildPatientScope(user);
    const taskScope = await this.access.buildTaskScope(user);
    const myAssignedScope = user.role === 'ADMIN' ? patientScope : { AND: [patientScope, { responsibleNurseId: user.id }] };
    const pendingAllocationScope = user.role === 'ADMIN' ? { responsibleNurseId: null } : { AND: [patientScope, { responsibleNurseId: null }] };
    const [myPatients, pendingAllocationPatients, pendingTasks, todayTasks, overdueTasks, openRiskAlerts, recentAbnormalVitals, completedTasks, completedTasksCount] = await Promise.all([
      this.prisma.patient.findMany({ where: myAssignedScope, include: { diseaseProfiles: true, vitalRecords: { orderBy: { measuredAt: 'desc' }, take: 3 }, riskAlerts: { where: { status: AlertStatus.OPEN }, orderBy: { createdAt: 'desc' }, take: 3 }, tasks: { where: { status: TaskStatus.PENDING }, orderBy: { dueAt: 'asc' }, take: 3 } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.patient.findMany({ where: pendingAllocationScope, include: { diseaseProfiles: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.task.findMany({ where: { AND: [taskScope, { status: TaskStatus.PENDING }] }, include: { patient: true }, orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }] }),
      this.prisma.task.findMany({ where: { AND: [taskScope, { status: TaskStatus.PENDING, dueAt: { gte: todayStart, lte: todayEnd } }] }, include: { patient: true }, orderBy: { dueAt: 'asc' } }),
      this.prisma.task.findMany({ where: { AND: [taskScope, { status: TaskStatus.PENDING, dueAt: { lt: todayStart } }] }, include: { patient: true }, orderBy: { dueAt: 'asc' } }),
      this.prisma.riskAlert.findMany({ where: { status: AlertStatus.OPEN, patient: patientScope }, include: { patient: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.vitalRecord.findMany({ where: { isAbnormal: true, patient: patientScope }, include: { patient: true }, orderBy: { measuredAt: 'desc' }, take: 10 }),
      this.prisma.task.findMany({ where: { AND: [taskScope, { status: TaskStatus.DONE }] }, include: { patient: true }, orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }], take: 10 }),
      this.prisma.task.count({ where: { AND: [taskScope, { status: TaskStatus.DONE }] } }),
    ]);
    return { nurseId: user.id, summary: { patientCount: myPatients.length, pendingAllocationPatientCount: pendingAllocationPatients.length, pendingTaskCount: pendingTasks.length, todayTaskCount: todayTasks.length, overdueTaskCount: overdueTasks.length, openRiskAlertCount: openRiskAlerts.length, recentAbnormalVitalCount: recentAbnormalVitals.length, completedTaskCount: completedTasksCount }, myPatients, pendingAllocationPatients, pendingTasks, todayTasks, overdueTasks, openRiskAlerts, recentAbnormalVitals, completedTasks };
  }
}
