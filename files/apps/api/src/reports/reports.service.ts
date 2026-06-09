import { Injectable } from '@nestjs/common';
import { AlertStatus, Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicalAccessScopeService } from '../security/clinical-access-scope.service';
import type { RequestUser } from '../security/request-user.type';
import { QueryReportDto } from './dto/query-report.dto';
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService, private readonly access: ClinicalAccessScopeService) {}
  private buildDateFilter(from?: string, to?: string) { return !from && !to ? undefined : { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) }; }
  async getOverview(query: QueryReportDto, user: RequestUser) {
    const createdAt = this.buildDateFilter(query.from, query.to);
    const patientScope = await this.access.buildPatientScope(user, query.hospitalTenantId);
    const taskScope = await this.access.buildTaskScope(user, query.hospitalTenantId);
    const patientWhere: Prisma.PatientWhereInput = { AND: [patientScope, ...(createdAt ? [{ createdAt }] : [])] };
    const diseaseWhere: Prisma.DiseaseProfileWhereInput = { patient: patientScope, ...(createdAt ? { createdAt } : {}) };
    const vitalWhere: Prisma.VitalRecordWhereInput = { patient: patientScope, ...(createdAt ? { measuredAt: createdAt } : {}) };
    const riskAlertWhere: Prisma.RiskAlertWhereInput = { patient: patientScope, ...(createdAt ? { createdAt } : {}) };
    const scopedTaskWhere: Prisma.TaskWhereInput = { AND: [taskScope, ...(createdAt ? [{ createdAt }] : [])] };
    const followUpWhere: Prisma.FollowUpRecordWhereInput = { patient: patientScope, ...(createdAt ? { createdAt } : {}) };
    const [patientCount,diseaseProfileCount,diseaseDistribution,riskLevelDistribution,vitalRecordCount,abnormalVitalRecordCount,openRiskAlertCount,resolvedRiskAlertCount,pendingTaskCount,completedTaskCount,followUpCount,recentAbnormalVitals,recentOpenRiskAlerts] = await Promise.all([
      this.prisma.patient.count({ where: patientWhere }), this.prisma.diseaseProfile.count({ where: diseaseWhere }), this.prisma.diseaseProfile.groupBy({ by:['diseaseType'], where:diseaseWhere, _count:{_all:true} }), this.prisma.diseaseProfile.groupBy({ by:['riskLevel'], where:diseaseWhere, _count:{_all:true} }), this.prisma.vitalRecord.count({where:vitalWhere}), this.prisma.vitalRecord.count({where:{...vitalWhere,isAbnormal:true}}), this.prisma.riskAlert.count({where:{...riskAlertWhere,status:AlertStatus.OPEN}}), this.prisma.riskAlert.count({where:{...riskAlertWhere,status:AlertStatus.RESOLVED}}), this.prisma.task.count({where:{AND:[scopedTaskWhere,{status:TaskStatus.PENDING}]}}), this.prisma.task.count({where:{AND:[scopedTaskWhere,{status:TaskStatus.DONE}]}}), this.prisma.followUpRecord.count({where:followUpWhere}), this.prisma.vitalRecord.findMany({where:{...vitalWhere,isAbnormal:true},include:{patient:true},orderBy:{measuredAt:'desc'},take:10}), this.prisma.riskAlert.findMany({where:{...riskAlertWhere,status:AlertStatus.OPEN},include:{patient:true},orderBy:{createdAt:'desc'},take:10}),
    ]);
    return { filters:{ from:query.from??null,to:query.to??null }, summary:{patientCount,diseaseProfileCount,vitalRecordCount,abnormalVitalRecordCount,openRiskAlertCount,resolvedRiskAlertCount,pendingTaskCount,completedTaskCount,followUpCount}, diseaseDistribution:diseaseDistribution.map(item=>({diseaseType:item.diseaseType,count:item._count._all})), riskLevelDistribution:riskLevelDistribution.map(item=>({riskLevel:item.riskLevel,count:item._count._all})), recentAbnormalVitals,recentOpenRiskAlerts };
  }
}
