import { Injectable, NotFoundException } from '@nestjs/common';
import { RiskAlert, RiskLevel, Task } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuestionnaireResultDto } from './dto/create-questionnaire-result.dto';

@Injectable()
export class QuestionnairesService {
  constructor(private readonly prisma: PrismaService) {}

  private evaluateQuestionnaire(score: number) {
    if (score >= 9) {
      return {
        riskLevel: RiskLevel.VERY_HIGH,
        riskConclusion: '问卷提示极高风险，请尽快复核患者症状并安排随访。',
        shouldCreateAlert: true,
      };
    }

    if (score >= 8) {
      return {
        riskLevel: RiskLevel.HIGH,
        riskConclusion: '问卷提示高风险，建议护士在 24 小时内复核。',
        shouldCreateAlert: true,
      };
    }

    if (score >= 6) {
      return {
        riskLevel: RiskLevel.MEDIUM,
        riskConclusion: '问卷提示中等风险，建议持续观察并按计划随访。',
        shouldCreateAlert: false,
      };
    }

    return {
      riskLevel: RiskLevel.LOW,
      riskConclusion: '问卷暂未提示明显风险。',
      shouldCreateAlert: false,
    };
  }

  private getQuestionnaireReviewDueAt(riskLevel: RiskLevel) {
    const dueAt = new Date();

    if (riskLevel === RiskLevel.VERY_HIGH) {
      dueAt.setHours(dueAt.getHours() + 4);
      return dueAt;
    }

    dueAt.setHours(dueAt.getHours() + 24);
    return dueAt;
  }

  async create(patientId: string, dto: CreateQuestionnaireResultDto) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    const evaluation = this.evaluateQuestionnaire(dto.score);

    return this.prisma.$transaction(async (tx) => {
      const questionnaireResult = await tx.questionnaireResult.create({
        data: {
          patientId,
          questionnaireType: dto.questionnaireType,
          score: dto.score,
          riskLevel: evaluation.riskLevel,
          riskConclusion: evaluation.riskConclusion,
          answers: dto.answers ?? undefined,
          note: dto.note,
          dataSource: dto.dataSource,
        },
      });

      let generatedRiskAlert: RiskAlert | null = null;
      let generatedTask: Task | null = null;

      if (evaluation.shouldCreateAlert) {
        generatedRiskAlert = await tx.riskAlert.create({
          data: {
            patientId,
            riskType: 'QUESTIONNAIRE_HIGH_RISK',
            riskLevel: evaluation.riskLevel,
            title: `问卷高风险：${dto.questionnaireType}`,
            description: `患者问卷评分 ${dto.score}/10。${evaluation.riskConclusion}`,
            triggerRule: '患者微信小程序提交问卷，评分 ≥ 8 自动触发预警',
          },
        });

        generatedTask = await tx.task.create({
          data: {
            patientId,
            title: `问卷复核：${dto.questionnaireType}`,
            type: 'QUESTIONNAIRE_REVIEW',
            dueAt: this.getQuestionnaireReviewDueAt(evaluation.riskLevel),
            assigneeId: patient.responsibleNurseId ?? 'nurse-001',
            relatedAlertId: generatedRiskAlert.id,
          },
        });
      }

      return {
        questionnaireResult,
        generatedRiskAlert,
        generatedTask,
        evaluation,
      };
    });
  }

  async findByPatient(patientId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    return this.prisma.questionnaireResult.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const result = await this.prisma.questionnaireResult.findUnique({
      where: { id },
      include: {
        patient: true,
      },
    });

    if (!result) {
      throw new NotFoundException('Questionnaire result not found');
    }

    return result;
  }
}