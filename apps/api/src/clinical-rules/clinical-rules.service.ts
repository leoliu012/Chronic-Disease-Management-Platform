import { Injectable, NotFoundException } from '@nestjs/common';
import { DiseaseType, RiskLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVitalRecordDto } from '../vital-records/dto/create-vital-record.dto';
import { UpdateVitalThresholdRuleDto } from './dto/update-vital-threshold-rule.dto';
import { UpdateFollowUpPolicyDto } from './dto/update-follow-up-policy.dto';
import { UpdateQuestionnaireTemplateDto } from './dto/update-questionnaire-template.dto';
import { defaultDiseaseRuleTemplates } from './clinical-rules.defaults';

type PatientWithDiseaseProfiles = {
  id: string;
  diseaseProfiles?: Array<{ diseaseType: DiseaseType; riskLevel?: RiskLevel }>;
};

type MatchedRule = {
  id: string;
  templateId: string;
  templateName: string;
  diseaseType: DiseaseType;
  vitalType: string;
  displayName: string;
  unit: string;
  operator: string;
  thresholdValue: number;
  thresholdValueMax?: number | null;
  riskLevel: RiskLevel;
  alertTitle: string;
  alertDescription?: string | null;
  followUpAction?: string | null;
};

export type ClinicalVitalRuleEvaluation = {
  isAbnormal: boolean;
  riskLevel: RiskLevel;
  title: string;
  description: string;
  triggerRule: string;
  matchedRuleId?: string;
  matchedTemplateId?: string;
  matchedTemplateName?: string;
  followUpAction?: string | null;
  followUpDueWithinHours?: number;
  followUpTaskTitle?: string;
};

const riskRank: Record<RiskLevel, number> = {
  [RiskLevel.LOW]: 0,
  [RiskLevel.MEDIUM]: 1,
  [RiskLevel.HIGH]: 2,
  [RiskLevel.VERY_HIGH]: 3,
};

const riskLabelMap: Record<RiskLevel, string> = {
  [RiskLevel.LOW]: '低危',
  [RiskLevel.MEDIUM]: '中危',
  [RiskLevel.HIGH]: '高危',
  [RiskLevel.VERY_HIGH]: '极高危',
};

const operatorLabelMap: Record<string, string> = {
  GTE: '≥',
  GT: '>',
  LTE: '≤',
  LT: '<',
  BETWEEN: '介于',
  OUTSIDE_RANGE: '超出区间',
};

function matchesOperator(value: number, rule: MatchedRule) {
  switch (rule.operator) {
    case 'GTE':
      return value >= rule.thresholdValue;
    case 'GT':
      return value > rule.thresholdValue;
    case 'LTE':
      return value <= rule.thresholdValue;
    case 'LT':
      return value < rule.thresholdValue;
    case 'BETWEEN':
      return (
        rule.thresholdValueMax !== null &&
        rule.thresholdValueMax !== undefined &&
        value >= rule.thresholdValue &&
        value <= rule.thresholdValueMax
      );
    case 'OUTSIDE_RANGE':
      return (
        rule.thresholdValueMax !== null &&
        rule.thresholdValueMax !== undefined &&
        (value < rule.thresholdValue || value > rule.thresholdValueMax)
      );
    default:
      return false;
  }
}

function formatRuleThreshold(rule: MatchedRule) {
  if (rule.operator === 'BETWEEN' || rule.operator === 'OUTSIDE_RANGE') {
    return `${operatorLabelMap[rule.operator]} ${rule.thresholdValue}–${rule.thresholdValueMax} ${rule.unit}`;
  }

  return `${operatorLabelMap[rule.operator] ?? rule.operator} ${rule.thresholdValue} ${rule.unit}`;
}

@Injectable()
export class ClinicalRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    return this.prisma.diseaseRuleTemplate.findMany({
      include: {
        vitalThresholdRules: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        followUpPolicies: {
          orderBy: [{ riskLevel: 'desc' }, { dueWithinHours: 'asc' }],
        },
        questionnaireTemplates: {
          orderBy: [{ questionnaireType: 'asc' }],
        },
      },
      orderBy: [{ diseaseType: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async seedDefaultRules() {
    for (const template of defaultDiseaseRuleTemplates) {
      const dbTemplate = await this.prisma.diseaseRuleTemplate.upsert({
        where: {
          diseaseType_version: {
            diseaseType: template.diseaseType,
            version: 'v1',
          },
        },
        update: {
          templateName: template.templateName,
          description: template.description,
          managementGoal: template.managementGoal,
          riskBasis: template.riskBasis,
          isActive: true,
        },
        create: {
          id: template.id,
          diseaseType: template.diseaseType,
          templateName: template.templateName,
          description: template.description,
          managementGoal: template.managementGoal,
          riskBasis: template.riskBasis,
          version: 'v1',
          isActive: true,
        },
      });

      for (const rule of template.vitalThresholdRules) {
        await this.prisma.vitalThresholdRule.upsert({
          where: { id: rule.id },
          update: {
            templateId: dbTemplate.id,
            vitalType: rule.vitalType,
            displayName: rule.displayName,
            unit: rule.unit,
            operator: rule.operator,
            thresholdValue: rule.thresholdValue,
            thresholdValueMax: rule.thresholdValueMax,
            riskLevel: rule.riskLevel,
            alertTitle: rule.alertTitle,
            alertDescription: rule.alertDescription,
            followUpAction: rule.followUpAction,
            sortOrder: rule.sortOrder,
            isActive: true,
          },
          create: {
            id: rule.id,
            templateId: dbTemplate.id,
            vitalType: rule.vitalType,
            displayName: rule.displayName,
            unit: rule.unit,
            operator: rule.operator,
            thresholdValue: rule.thresholdValue,
            thresholdValueMax: rule.thresholdValueMax,
            riskLevel: rule.riskLevel,
            alertTitle: rule.alertTitle,
            alertDescription: rule.alertDescription,
            followUpAction: rule.followUpAction,
            sortOrder: rule.sortOrder,
            isActive: true,
          },
        });
      }

      for (const policy of template.followUpPolicies) {
        await this.prisma.followUpPolicy.upsert({
          where: { id: policy.id },
          update: {
            templateId: dbTemplate.id,
            riskLevel: policy.riskLevel,
            followUpType: policy.followUpType,
            dueWithinHours: policy.dueWithinHours,
            frequencyDescription: policy.frequencyDescription,
            taskTitle: policy.taskTitle,
            instruction: policy.instruction,
            isActive: true,
          },
          create: {
            id: policy.id,
            templateId: dbTemplate.id,
            riskLevel: policy.riskLevel,
            followUpType: policy.followUpType,
            dueWithinHours: policy.dueWithinHours,
            frequencyDescription: policy.frequencyDescription,
            taskTitle: policy.taskTitle,
            instruction: policy.instruction,
            isActive: true,
          },
        });
      }

      for (const questionnaire of template.questionnaireTemplates) {
        await this.prisma.questionnaireTemplate.upsert({
          where: { id: questionnaire.id },
          update: {
            templateId: dbTemplate.id,
            questionnaireType: questionnaire.questionnaireType,
            title: questionnaire.title,
            description: questionnaire.description,
            scoringRule: questionnaire.scoringRule as any,
            riskBands: questionnaire.riskBands as any,
            isActive: true,
          },
          create: {
            id: questionnaire.id,
            templateId: dbTemplate.id,
            questionnaireType: questionnaire.questionnaireType,
            title: questionnaire.title,
            description: questionnaire.description,
            scoringRule: questionnaire.scoringRule as any,
            riskBands: questionnaire.riskBands as any,
            isActive: true,
          },
        });
      }
    }

    return {
      message: '默认慢病规则模板已写入，可在规则配置页面查看和调整。',
      count: defaultDiseaseRuleTemplates.length,
      templates: defaultDiseaseRuleTemplates.map((template) => ({
        id: template.id,
        diseaseType: template.diseaseType,
        templateName: template.templateName,
      })),
    };
  }

  async updateVitalThresholdRule(id: string, dto: UpdateVitalThresholdRuleDto) {
    await this.ensureVitalThresholdRule(id);
    return this.prisma.vitalThresholdRule.update({
      where: { id },
      data: {
        displayName: dto.displayName,
        unit: dto.unit,
        operator: dto.operator,
        thresholdValue: dto.thresholdValue,
        thresholdValueMax: dto.thresholdValueMax === null ? null : dto.thresholdValueMax,
        riskLevel: dto.riskLevel,
        alertTitle: dto.alertTitle,
        alertDescription: dto.alertDescription,
        followUpAction: dto.followUpAction,
        sortOrder: dto.sortOrder,
        isActive: dto.isActive,
      },
      include: { template: true },
    });
  }

  async updateFollowUpPolicy(id: string, dto: UpdateFollowUpPolicyDto) {
    await this.ensureFollowUpPolicy(id);
    return this.prisma.followUpPolicy.update({
      where: { id },
      data: {
        riskLevel: dto.riskLevel,
        followUpType: dto.followUpType,
        dueWithinHours: dto.dueWithinHours,
        frequencyDescription: dto.frequencyDescription,
        taskTitle: dto.taskTitle,
        instruction: dto.instruction,
        isActive: dto.isActive,
      },
      include: { template: true },
    });
  }

  async updateQuestionnaireTemplate(id: string, dto: UpdateQuestionnaireTemplateDto) {
    await this.ensureQuestionnaireTemplate(id);
    return this.prisma.questionnaireTemplate.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        scoringRule: dto.scoringRule as any,
        riskBands: dto.riskBands as any,
        isActive: dto.isActive,
      },
      include: { template: true },
    });
  }

  async evaluateVital(patient: PatientWithDiseaseProfiles, dto: CreateVitalRecordDto): Promise<ClinicalVitalRuleEvaluation | null> {
    const value = Number(dto.value);
    if (Number.isNaN(value)) return null;

    const diseaseTypes = Array.from(
      new Set((patient.diseaseProfiles ?? []).map((profile) => profile.diseaseType)),
    );

    if (!diseaseTypes.length) return null;

    const rules = await this.prisma.vitalThresholdRule.findMany({
      where: {
        isActive: true,
        vitalType: dto.type,
        template: {
          isActive: true,
          diseaseType: { in: diseaseTypes },
        },
      },
      include: { template: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    const matchedRules = rules
      .filter((rule) => matchesOperator(value, {
        ...rule,
        templateName: rule.template.templateName,
        diseaseType: rule.template.diseaseType,
      }))
      .map((rule) => ({
        id: rule.id,
        templateId: rule.templateId,
        templateName: rule.template.templateName,
        diseaseType: rule.template.diseaseType,
        vitalType: rule.vitalType,
        displayName: rule.displayName,
        unit: rule.unit,
        operator: rule.operator,
        thresholdValue: rule.thresholdValue,
        thresholdValueMax: rule.thresholdValueMax,
        riskLevel: rule.riskLevel,
        alertTitle: rule.alertTitle,
        alertDescription: rule.alertDescription,
        followUpAction: rule.followUpAction,
      } satisfies MatchedRule));

    if (!matchedRules.length) return null;

    matchedRules.sort((a, b) => riskRank[b.riskLevel] - riskRank[a.riskLevel]);
    const topRule = matchedRules[0];

    const policy = await this.prisma.followUpPolicy.findFirst({
      where: {
        templateId: topRule.templateId,
        riskLevel: topRule.riskLevel,
        isActive: true,
      },
      orderBy: [{ dueWithinHours: 'asc' }, { createdAt: 'asc' }],
    });

    return {
      isAbnormal: true,
      riskLevel: topRule.riskLevel,
      title: topRule.alertTitle || `异常健康指标：${topRule.displayName}`,
      description: [
        `${topRule.displayName} ${value} ${dto.unit || topRule.unit}`,
        `命中规则：${topRule.templateName} / ${formatRuleThreshold(topRule)}`,
        topRule.alertDescription,
        topRule.followUpAction ? `建议处理：${topRule.followUpAction}` : undefined,
      ].filter(Boolean).join('；'),
      triggerRule: `规则配置：${topRule.templateName}，${topRule.displayName} ${formatRuleThreshold(topRule)}，判定为${riskLabelMap[topRule.riskLevel]}`,
      matchedRuleId: topRule.id,
      matchedTemplateId: topRule.templateId,
      matchedTemplateName: topRule.templateName,
      followUpAction: topRule.followUpAction,
      followUpDueWithinHours: policy?.dueWithinHours,
      followUpTaskTitle: policy?.taskTitle,
    };
  }

  private async ensureVitalThresholdRule(id: string) {
    const rule = await this.prisma.vitalThresholdRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Vital threshold rule not found');
    return rule;
  }

  private async ensureFollowUpPolicy(id: string) {
    const policy = await this.prisma.followUpPolicy.findUnique({ where: { id } });
    if (!policy) throw new NotFoundException('Follow-up policy not found');
    return policy;
  }

  private async ensureQuestionnaireTemplate(id: string) {
    const questionnaire = await this.prisma.questionnaireTemplate.findUnique({ where: { id } });
    if (!questionnaire) throw new NotFoundException('Questionnaire template not found');
    return questionnaire;
  }
}
