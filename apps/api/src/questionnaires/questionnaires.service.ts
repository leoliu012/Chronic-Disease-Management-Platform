import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RiskAlert, RiskLevel, Task } from '@prisma/client';
import { ClinicalDispositionService } from '../clinical-disposition/clinical-disposition.service';
import { ClinicalRulesService } from '../clinical-rules/clinical-rules.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuestionnaireResultDto } from './dto/create-questionnaire-result.dto';

@Injectable()
export class QuestionnairesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly disposition: ClinicalDispositionService,
    private readonly clinicalRules: ClinicalRulesService,
  ) {}

  private legacyFallback(score: number) {
    if (process.env.CLINICAL_RULE_ALLOW_LEGACY_FALLBACK !== 'true') {
      throw new BadRequestException('该问卷尚未配置已生效的版本化规则，已阻止未审核规则自动判定');
    }
    const riskLevel = score >= 9 ? RiskLevel.VERY_HIGH : score >= 8 ? RiskLevel.HIGH : score >= 6 ? RiskLevel.MEDIUM : RiskLevel.LOW;
    return {
      riskLevel,
      riskConclusion: riskLevel === RiskLevel.VERY_HIGH ? '问卷提示极高风险，请尽快复核患者症状并安排随访。' : riskLevel === RiskLevel.HIGH ? '问卷提示高风险，建议护士在 24 小时内复核。' : riskLevel === RiskLevel.MEDIUM ? '问卷提示中等风险，建议持续观察并按计划随访。' : '问卷暂未提示明显风险。',
      shouldCreateAlert: (riskLevel === RiskLevel.HIGH || riskLevel === RiskLevel.VERY_HIGH),
      followUpDueWithinHours: riskLevel === RiskLevel.VERY_HIGH ? 4 : 24,
      followUpTaskTitle: '问卷复核',
      ruleTrace: {
        ruleId: 'LEGACY_QUESTIONNAIRE_FALLBACK',
        ruleVersion: 'legacy-dev-only',
        ruleSnapshot: { thresholds: { VERY_HIGH: 9, HIGH: 8, MEDIUM: 6 } },
        evidenceBasis: '开发环境兼容回退逻辑；禁止作为正式发布规则使用。',
        evaluatedAt: new Date(),
        inputSnapshot: { score },
        matchedConditions: { riskLevel },
      },
    };
  }

  async create(patientId: string, dto: CreateQuestionnaireResultDto) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('Patient not found');

    const evaluation = (await this.clinicalRules.evaluateQuestionnaire(dto.questionnaireType, dto.score)) ?? this.legacyFallback(dto.score);

    return this.prisma.$transaction(async (tx) => {
      const questionnaireResult = await tx.questionnaireResult.create({
        data: { patientId, questionnaireType: dto.questionnaireType, score: dto.score, riskLevel: evaluation.riskLevel, riskConclusion: evaluation.riskConclusion, answers: dto.answers ?? undefined, note: dto.note, dataSource: dto.dataSource },
      });

      let generatedRiskAlert: RiskAlert | null = null;
      let generatedTask: Task | null = null;
      if (evaluation.shouldCreateAlert) {
        const dueAt = new Date(Date.now() + evaluation.followUpDueWithinHours * 60 * 60 * 1000);
        const disposition = await this.disposition.signalRisk(tx, {
          patientId,
          riskCategory: 'QUESTIONNAIRE_HIGH_RISK',
          correlationKey: `QUESTIONNAIRE_HIGH_RISK:${dto.questionnaireType}`,
          riskLevel: evaluation.riskLevel,
          title: `问卷高风险：${dto.questionnaireType}`,
          description: `患者问卷评分 ${dto.score}。${evaluation.riskConclusion}`,
          triggerRule: `版本化问卷规则：${evaluation.ruleTrace.ruleVersion ?? 'unknown'}`,
          sourceQuestionnaireResultId: questionnaireResult.id,
          evidence: { sourceType: 'QuestionnaireResult', questionnaireResultId: questionnaireResult.id, questionnaireType: dto.questionnaireType, score: dto.score, answers: dto.answers ?? null },
          ruleTrace: evaluation.ruleTrace,
          taskTitle: evaluation.followUpTaskTitle,
          taskType: 'QUESTIONNAIRE_REVIEW',
          dueAt,
          assigneeId: patient.responsibleNurseId,
        });
        generatedRiskAlert = disposition.alert;
        generatedTask = disposition.task;
      }
      return { questionnaireResult, generatedRiskAlert, generatedTask, evaluation };
    });
  }

  async findByPatient(patientId: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('Patient not found');
    return this.prisma.questionnaireResult.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const result = await this.prisma.questionnaireResult.findUnique({ where: { id }, include: { patient: true } });
    if (!result) throw new NotFoundException('Questionnaire result not found');
    return result;
  }
}
