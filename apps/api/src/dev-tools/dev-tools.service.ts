import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DevToolsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDevelopmentOnly() {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Dev cleanup is disabled in production');
    }
  }

  async cleanupTestData(patientId?: string) {
    this.ensureDevelopmentOnly();

    const patientFilter = patientId ? { patientId } : {};

    const [
      medicationCheckIns,
      questionnaireResults,
      riskAlerts,
      tasks,
      followUps,
      vitalRecords,
    ] = await this.prisma.$transaction([
      this.prisma.medicationCheckIn.deleteMany({
        where: patientFilter,
      }),
      this.prisma.questionnaireResult.deleteMany({
        where: patientFilter,
      }),
      this.prisma.riskAlert.deleteMany({
        where: patientFilter,
      }),
      this.prisma.task.deleteMany({
        where: patientFilter,
      }),
      this.prisma.followUpRecord.deleteMany({
        where: patientFilter,
      }),
      this.prisma.vitalRecord.deleteMany({
        where: patientFilter,
      }),
    ]);

    return {
      mode: 'DEVELOPMENT_ONLY',
      patientId: patientId ?? null,
      preserved: ['Patient', 'DiseaseProfile', 'MedicationRecord'],
      deleted: {
        medicationCheckIns: medicationCheckIns.count,
        questionnaireResults: questionnaireResults.count,
        riskAlerts: riskAlerts.count,
        tasks: tasks.count,
        followUps: followUps.count,
        vitalRecords: vitalRecords.count,
      },
      message:
        '测试流水数据已清理。患者主档案和慢病档案已保留，真实生产环境应使用作废/审计流程而不是硬删除。',
    };
  }
}
