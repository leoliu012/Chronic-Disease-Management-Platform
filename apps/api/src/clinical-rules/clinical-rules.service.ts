import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ClinicalRuleLifecycleStatus,
  DiseaseType,
  Prisma,
  RiskLevel,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVitalRecordDto } from '../vital-records/dto/create-vital-record.dto';
import type { RequestUser } from '../security/request-user.type';
import { CreateRuleVersionDto } from './dto/create-rule-version.dto';
import { ReviewRuleVersionDto } from './dto/review-rule-version.dto';
import { SimulateRuleDto } from './dto/simulate-rule.dto';
import { UpdateFollowUpPolicyDto } from './dto/update-follow-up-policy.dto';
import { UpdateQuestionnaireTemplateDto } from './dto/update-questionnaire-template.dto';
import { UpdateVitalThresholdRuleDto } from './dto/update-vital-threshold-rule.dto';
import { defaultDiseaseRuleTemplates } from './clinical-rules.defaults';

type PatientWithDiseaseProfiles = {
  id: string;
  diseaseProfiles?: Array<{ diseaseType: DiseaseType; riskLevel?: RiskLevel }>;
};

type MatchedRule = {
  id: string;
  templateId: string;
  templateName: string;
  templateVersion: string;
  evidenceBasis?: string | null;
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

type RiskBand = {
  min?: number;
  max?: number;
  riskLevel: RiskLevel;
  conclusion?: string;
  shouldCreateAlert?: boolean;
};

export type ClinicalRuleTrace = {
  ruleId?: string;
  ruleVersion?: string;
  ruleSnapshot: unknown;
  evidenceBasis?: string | null;
  evaluatedAt: Date;
  inputSnapshot: unknown;
  matchedConditions: unknown;
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
  ruleTrace: ClinicalRuleTrace;
};

export type ClinicalQuestionnaireRuleEvaluation = {
  riskLevel: RiskLevel;
  riskConclusion: string;
  shouldCreateAlert: boolean;
  followUpDueWithinHours: number;
  followUpTaskTitle: string;
  ruleTrace: ClinicalRuleTrace;
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

function matchesOperator(value: number, rule: Pick<MatchedRule, 'operator' | 'thresholdValue' | 'thresholdValueMax'>) {
  switch (rule.operator) {
    case 'GTE': return value >= rule.thresholdValue;
    case 'GT': return value > rule.thresholdValue;
    case 'LTE': return value <= rule.thresholdValue;
    case 'LT': return value < rule.thresholdValue;
    case 'BETWEEN':
      return rule.thresholdValueMax !== null && rule.thresholdValueMax !== undefined && value >= rule.thresholdValue && value <= rule.thresholdValueMax;
    case 'OUTSIDE_RANGE':
      return rule.thresholdValueMax !== null && rule.thresholdValueMax !== undefined && (value < rule.thresholdValue || value > rule.thresholdValueMax);
    default: return false;
  }
}

function formatRuleThreshold(rule: Pick<MatchedRule, 'operator' | 'thresholdValue' | 'thresholdValueMax' | 'unit'>) {
  if (rule.operator === 'BETWEEN' || rule.operator === 'OUTSIDE_RANGE') {
    return `${operatorLabelMap[rule.operator]} ${rule.thresholdValue}–${rule.thresholdValueMax} ${rule.unit}`;
  }
  return `${operatorLabelMap[rule.operator] ?? rule.operator} ${rule.thresholdValue} ${rule.unit}`;
}

function isBloodPressureComponent(type?: string | null) {
  return type === 'SYSTOLIC_BP' || type === 'DIASTOLIC_BP' || type === 'BLOOD_PRESSURE';
}

function getAlertTitle(rule: MatchedRule) {
  return isBloodPressureComponent(rule.vitalType) ? '异常健康指标：血压' : rule.alertTitle || `异常健康指标：${rule.displayName}`;
}

function parseRiskLevel(value: unknown): RiskLevel | null {
  return Object.values(RiskLevel).includes(value as RiskLevel) ? (value as RiskLevel) : null;
}

function parseRiskBands(value: Prisma.JsonValue | null): RiskBand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const riskLevel = parseRiskLevel(raw.riskLevel);
    if (!riskLevel) return [];
    return [{
      min: typeof raw.min === 'number' ? raw.min : undefined,
      max: typeof raw.max === 'number' ? raw.max : undefined,
      riskLevel,
      conclusion: typeof raw.conclusion === 'string' ? raw.conclusion : undefined,
      shouldCreateAlert: typeof raw.shouldCreateAlert === 'boolean' ? raw.shouldCreateAlert : undefined,
    }];
  });
}

function matchesBand(score: number, band: RiskBand) {
  return (band.min === undefined || score >= band.min) && (band.max === undefined || score <= band.max);
}

function questionnaireConclusion(level: RiskLevel) {
  if (level === RiskLevel.VERY_HIGH) return '问卷提示极高风险，请尽快复核患者症状并安排处置。';
  if (level === RiskLevel.HIGH) return '问卷提示高风险，建议护士在 24 小时内复核。';
  if (level === RiskLevel.MEDIUM) return '问卷提示中等风险，建议持续观察并按计划随访。';
  return '问卷暂未提示明显风险。';
}

// Existing H5 links issued before the governed questionnaire release used these
// identifiers. Keep them readable while storing the canonical configured type
// in the rule trace. New links are issued with the canonical names.
const questionnaireAliases: Record<string, string> = {
  HYPERTENSION_FOLLOWUP: 'HYPERTENSION_MONTHLY',
  DIABETES_FOLLOWUP: 'DIABETES_MONTHLY',
  COPD_FOLLOWUP: 'COPD_CAT',
};

function normalizeQuestionnaireType(questionnaireType: string) {
  return questionnaireAliases[questionnaireType] ?? questionnaireType;
}

@Injectable()
export class ClinicalRulesService {
  constructor(private readonly prisma: PrismaService) {}

  private asJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  private effectiveTemplateWhere(now = new Date()): Prisma.DiseaseRuleTemplateWhereInput {
    return {
      isActive: true,
      lifecycleStatus: ClinicalRuleLifecycleStatus.EFFECTIVE,
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
        { OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
      ],
    };
  }

  async getSummary() {
    return this.prisma.diseaseRuleTemplate.findMany({
      include: {
        approvals: { orderBy: { createdAt: 'asc' } },
        vitalThresholdRules: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        followUpPolicies: { orderBy: [{ riskLevel: 'desc' }, { dueWithinHours: 'asc' }] },
        questionnaireTemplates: { orderBy: [{ questionnaireType: 'asc' }] },
      },
      orderBy: [{ diseaseType: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async seedDefaultRules() {
    const now = new Date();
    for (const template of defaultDiseaseRuleTemplates) {
      const existingEffective = await this.prisma.diseaseRuleTemplate.findFirst({
        where: { diseaseType: template.diseaseType, ...this.effectiveTemplateWhere(now) },
        select: { id: true },
      });
      const shouldActivateSeed = !existingEffective;
      const dbTemplate = await this.prisma.diseaseRuleTemplate.upsert({
        where: { diseaseType_version: { diseaseType: template.diseaseType, version: 'v1' } },
        // Seed is create-only. Re-running bootstrap must never mutate a
        // released version or silently reset its effective timestamp. If an
        // effective custom version already exists, insert a non-active Draft
        // seed instead of colliding with the one-effective-version invariant.
        update: {},
        create: {
          id: template.id,
          diseaseType: template.diseaseType,
          templateName: template.templateName,
          description: template.description,
          managementGoal: template.managementGoal,
          riskBasis: template.riskBasis,
          evidenceBasis: template.riskBasis,
          version: 'v1',
          isActive: shouldActivateSeed,
          lifecycleStatus: shouldActivateSeed ? ClinicalRuleLifecycleStatus.EFFECTIVE : ClinicalRuleLifecycleStatus.DRAFT,
          effectiveFrom: shouldActivateSeed ? now : undefined,
          publishedAt: shouldActivateSeed ? now : undefined,
          publishedBy: shouldActivateSeed ? 'SYSTEM_SEED' : undefined,
        },
      });
      for (const rule of template.vitalThresholdRules) {
        await this.prisma.vitalThresholdRule.upsert({
          where: { id: rule.id },
          update: {},
          create: { templateId: dbTemplate.id, ...rule, isActive: true },
        });
      }
      for (const policy of template.followUpPolicies) {
        await this.prisma.followUpPolicy.upsert({
          where: { id: policy.id },
          update: {},
          create: { templateId: dbTemplate.id, ...policy, isActive: true },
        });
      }
      for (const questionnaire of template.questionnaireTemplates) {
        await this.prisma.questionnaireTemplate.upsert({
          where: { id: questionnaire.id },
          update: {},
          create: { templateId: dbTemplate.id, ...questionnaire, scoringRule: this.asJson(questionnaire.scoringRule), riskBands: this.asJson(questionnaire.riskBands), isActive: true },
        });
      }
    }
    return { message: '默认慢病规则模板已写入。正式阈值调整请克隆 Draft 版本并完成医生审核。', count: defaultDiseaseRuleTemplates.length };
  }

  private async assertDraftTemplate(templateId: string) {
    const template = await this.prisma.diseaseRuleTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new NotFoundException('Disease rule template not found');
    if (template.lifecycleStatus !== ClinicalRuleLifecycleStatus.DRAFT) {
      throw new BadRequestException('已发布或审核中的规则不可直接修改，请先克隆新的 Draft 版本');
    }
    return template;
  }

  async updateVitalThresholdRule(id: string, dto: UpdateVitalThresholdRuleDto) {
    const rule = await this.ensureVitalThresholdRule(id);
    await this.assertDraftTemplate(rule.templateId);
    return this.prisma.vitalThresholdRule.update({ where: { id }, data: { ...dto, thresholdValueMax: dto.thresholdValueMax === null ? null : dto.thresholdValueMax }, include: { template: true } });
  }

  async updateFollowUpPolicy(id: string, dto: UpdateFollowUpPolicyDto) {
    const policy = await this.ensureFollowUpPolicy(id);
    await this.assertDraftTemplate(policy.templateId);
    return this.prisma.followUpPolicy.update({ where: { id }, data: dto, include: { template: true } });
  }

  async updateQuestionnaireTemplate(id: string, dto: UpdateQuestionnaireTemplateDto) {
    const questionnaire = await this.ensureQuestionnaireTemplate(id);
    await this.assertDraftTemplate(questionnaire.templateId);
    return this.prisma.questionnaireTemplate.update({
      where: { id },
      data: { title: dto.title, description: dto.description, scoringRule: dto.scoringRule === undefined ? undefined : this.asJson(dto.scoringRule), riskBands: dto.riskBands === undefined ? undefined : this.asJson(dto.riskBands), isActive: dto.isActive },
      include: { template: true },
    });
  }

  async createDraftVersion(sourceTemplateId: string, dto: CreateRuleVersionDto, _user: RequestUser) {
    const source = await this.prisma.diseaseRuleTemplate.findUnique({
      where: { id: sourceTemplateId },
      include: { vitalThresholdRules: true, followUpPolicies: true, questionnaireTemplates: true },
    });
    if (!source) throw new NotFoundException('Disease rule template not found');
    const version = dto.version?.trim() || `draft-${Date.now()}`;
    return this.prisma.diseaseRuleTemplate.create({
      data: {
        diseaseType: source.diseaseType,
        templateName: source.templateName,
        description: source.description,
        managementGoal: source.managementGoal,
        riskBasis: source.riskBasis,
        evidenceBasis: source.evidenceBasis ?? source.riskBasis,
        version,
        isActive: false,
        lifecycleStatus: ClinicalRuleLifecycleStatus.DRAFT,
        basedOnTemplateId: source.id,
        vitalThresholdRules: { create: source.vitalThresholdRules.map(({ id: _id, templateId: _templateId, createdAt: _createdAt, updatedAt: _updatedAt, ...rule }) => rule) },
        followUpPolicies: { create: source.followUpPolicies.map(({ id: _id, templateId: _templateId, createdAt: _createdAt, updatedAt: _updatedAt, ...policy }) => policy) },
        questionnaireTemplates: {
          create: source.questionnaireTemplates.map(({ id: _id, templateId: _templateId, createdAt: _createdAt, updatedAt: _updatedAt, scoringRule, riskBands, ...questionnaire }) => ({
            ...questionnaire,
            scoringRule: scoringRule === null ? undefined : this.asJson(scoringRule),
            riskBands: riskBands === null ? undefined : this.asJson(riskBands),
          })),
        },
      },
      include: { vitalThresholdRules: true, followUpPolicies: true, questionnaireTemplates: true, approvals: true },
    });
  }

  async submitForReview(id: string, _dto: ReviewRuleVersionDto) {
    await this.assertDraftTemplate(id);
    return this.prisma.diseaseRuleTemplate.update({ where: { id }, data: { lifecycleStatus: ClinicalRuleLifecycleStatus.PHYSICIAN_REVIEW }, include: { approvals: true } });
  }

  async approveVersion(id: string, dto: ReviewRuleVersionDto, user: RequestUser) {
    const template = await this.prisma.diseaseRuleTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Disease rule template not found');
    if (template.lifecycleStatus !== ClinicalRuleLifecycleStatus.PHYSICIAN_REVIEW) throw new BadRequestException('Only PHYSICIAN_REVIEW versions can be approved');
    await this.prisma.clinicalRuleApproval.upsert({
      where: { templateId_reviewerId: { templateId: id, reviewerId: user.id } },
      update: { reviewerRole: user.role, decision: 'APPROVED', note: dto.note },
      create: { templateId: id, reviewerId: user.id, reviewerRole: user.role, decision: 'APPROVED', note: dto.note },
    });
    return this.prisma.diseaseRuleTemplate.findUnique({ where: { id }, include: { approvals: { orderBy: { createdAt: 'asc' } } } });
  }

  private async approvalRequirement(templateId: string) {
    const template = await this.prisma.diseaseRuleTemplate.findUnique({
      where: { id: templateId },
      include: { vitalThresholdRules: true, questionnaireTemplates: true, approvals: { where: { decision: 'APPROVED' } } },
    });
    if (!template) throw new NotFoundException('Disease rule template not found');
    const highRiskVital = template.vitalThresholdRules.some((rule) => (rule.riskLevel === RiskLevel.HIGH || rule.riskLevel === RiskLevel.VERY_HIGH));
    const highRiskQuestionnaire = template.questionnaireTemplates.some((questionnaire) => parseRiskBands(questionnaire.riskBands).some((band) => (band.riskLevel === RiskLevel.HIGH || band.riskLevel === RiskLevel.VERY_HIGH)));
    return { template, required: highRiskVital || highRiskQuestionnaire ? 2 : 1, approvals: template.approvals.length };
  }

  async publishVersion(id: string, user: RequestUser) {
    const { template, required, approvals } = await this.approvalRequirement(id);
    if (template.lifecycleStatus !== ClinicalRuleLifecycleStatus.PHYSICIAN_REVIEW) throw new BadRequestException('Only reviewed versions can be published');
    if (approvals < required) throw new BadRequestException(`规则需要 ${required} 名不同审核人批准，当前仅 ${approvals} 名`);
    return this.prisma.diseaseRuleTemplate.update({ where: { id }, data: { lifecycleStatus: ClinicalRuleLifecycleStatus.PUBLISHED, publishedAt: new Date(), publishedBy: user.id }, include: { approvals: true } });
  }

  async activateVersion(id: string, user: RequestUser) {
    const template = await this.prisma.diseaseRuleTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Disease rule template not found');
    if (template.lifecycleStatus !== ClinicalRuleLifecycleStatus.PUBLISHED) throw new BadRequestException('Only PUBLISHED versions can become EFFECTIVE');
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.diseaseRuleTemplate.updateMany({
        where: { diseaseType: template.diseaseType, lifecycleStatus: ClinicalRuleLifecycleStatus.EFFECTIVE, id: { not: id } },
        data: { lifecycleStatus: ClinicalRuleLifecycleStatus.DEACTIVATED, isActive: false, effectiveUntil: now, deactivatedAt: now, deactivatedBy: user.id },
      });
      return tx.diseaseRuleTemplate.update({ where: { id }, data: { lifecycleStatus: ClinicalRuleLifecycleStatus.EFFECTIVE, isActive: true, effectiveFrom: now, effectiveUntil: null }, include: { approvals: true } });
    });
  }

  async deactivateVersion(id: string, user: RequestUser) {
    const template = await this.prisma.diseaseRuleTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Disease rule template not found');
    if (template.lifecycleStatus === ClinicalRuleLifecycleStatus.DEACTIVATED) return template;
    const now = new Date();
    return this.prisma.diseaseRuleTemplate.update({ where: { id }, data: { lifecycleStatus: ClinicalRuleLifecycleStatus.DEACTIVATED, isActive: false, effectiveUntil: now, deactivatedAt: now, deactivatedBy: user.id } });
  }

  async rollbackAsDraft(id: string, dto: CreateRuleVersionDto, user: RequestUser) {
    return this.createDraftVersion(id, { ...dto, version: dto.version || `rollback-${Date.now()}` }, user);
  }

  async compareVersions(leftId: string, rightId: string) {
    const [left, right] = await Promise.all([this.snapshotTemplate(leftId), this.snapshotTemplate(rightId)]);
    return { left, right };
  }

  private async snapshotTemplate(id: string) {
    const template = await this.prisma.diseaseRuleTemplate.findUnique({
      where: { id },
      include: { vitalThresholdRules: { orderBy: { sortOrder: 'asc' } }, followUpPolicies: true, questionnaireTemplates: true, approvals: true },
    });
    if (!template) throw new NotFoundException('Disease rule template not found');
    return template;
  }

  async simulateTemplate(id: string, dto: SimulateRuleDto) {
    const template = await this.snapshotTemplate(id);
    const matched = template.vitalThresholdRules.filter((rule) => rule.isActive && rule.vitalType === dto.vitalType && matchesOperator(dto.value, rule));
    matched.sort((a, b) => riskRank[b.riskLevel] - riskRank[a.riskLevel]);
    return { templateId: id, version: template.version, input: dto, matchedRules: matched, highestRiskLevel: matched[0]?.riskLevel ?? RiskLevel.LOW };
  }

  async estimateImpact(id: string, days = 90) {
    const template = await this.snapshotTemplate(id);
    const cutoff = new Date(Date.now() - Math.min(Math.max(days, 1), 365) * 24 * 60 * 60 * 1000);
    const types = [...new Set(template.vitalThresholdRules.filter((rule) => rule.isActive).map((rule) => rule.vitalType))];
    const records = await this.prisma.vitalRecord.findMany({ where: { type: { in: types }, measuredAt: { gte: cutoff } }, select: { id: true, patientId: true, type: true, value: true, unit: true, measuredAt: true } });
    const affectedRecords = records.filter((record) => template.vitalThresholdRules.some((rule) => rule.isActive && rule.vitalType === record.type && matchesOperator(record.value, rule)));
    return { templateId: id, version: template.version, replayDays: days, evaluatedRecordCount: records.length, matchedRecordCount: affectedRecords.length, affectedPatientCount: new Set(affectedRecords.map((record) => record.patientId)).size };
  }

  async prepareQuestionnaireLinkPayload(payload: Record<string, unknown> | null | undefined) {
    const base = { ...(payload ?? {}) };
    const submittedType = String(base.questionnaireType ?? 'GENERIC');
    const normalizedQuestionnaireType = normalizeQuestionnaireType(submittedType);
    const questionnaire = await this.prisma.questionnaireTemplate.findFirst({
      where: { questionnaireType: normalizedQuestionnaireType, isActive: true, template: this.effectiveTemplateWhere() },
      include: { template: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!questionnaire) {
      if (process.env.CLINICAL_RULE_ALLOW_LEGACY_FALLBACK === 'true') return base;
      throw new BadRequestException(`问卷 ${normalizedQuestionnaireType} 尚未配置已生效的版本化规则，已阻止创建未审核问卷链接`);
    }
    return {
      ...base,
      questionnaireType: normalizedQuestionnaireType,
      questionnaireRuleSnapshot: {
        questionnaireTemplateId: questionnaire.id,
        ruleVersion: questionnaire.template.version,
        scoringRule: questionnaire.scoringRule,
        riskBands: questionnaire.riskBands,
        evidenceBasis: questionnaire.template.evidenceBasis ?? questionnaire.template.riskBasis,
        issuedAt: new Date().toISOString(),
      },
    };
  }

  async evaluateVital(patient: PatientWithDiseaseProfiles, dto: CreateVitalRecordDto): Promise<ClinicalVitalRuleEvaluation | null> {
    const value = Number(dto.value);
    if (Number.isNaN(value)) return null;
    const diseaseTypes = [...new Set((patient.diseaseProfiles ?? []).map((profile) => profile.diseaseType))];
    if (!diseaseTypes.length) return null;
    const rules = await this.prisma.vitalThresholdRule.findMany({
      where: { isActive: true, vitalType: dto.type, template: { ...this.effectiveTemplateWhere(), diseaseType: { in: diseaseTypes } } },
      include: { template: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const matchedRules: MatchedRule[] = rules
      .map((rule) => ({ id: rule.id, templateId: rule.templateId, templateName: rule.template.templateName, templateVersion: rule.template.version, evidenceBasis: rule.template.evidenceBasis ?? rule.template.riskBasis, diseaseType: rule.template.diseaseType, vitalType: rule.vitalType, displayName: rule.displayName, unit: rule.unit, operator: rule.operator, thresholdValue: rule.thresholdValue, thresholdValueMax: rule.thresholdValueMax, riskLevel: rule.riskLevel, alertTitle: rule.alertTitle, alertDescription: rule.alertDescription, followUpAction: rule.followUpAction }))
      .filter((rule) => matchesOperator(value, rule));
    if (!matchedRules.length) return null;
    matchedRules.sort((a, b) => riskRank[b.riskLevel] - riskRank[a.riskLevel]);
    const topRule = matchedRules[0];
    const policy = await this.prisma.followUpPolicy.findFirst({ where: { templateId: topRule.templateId, riskLevel: topRule.riskLevel, isActive: true }, orderBy: [{ dueWithinHours: 'asc' }, { createdAt: 'asc' }] });
    if (!policy) {
      throw new BadRequestException(`生效规则 ${topRule.templateName} ${topRule.templateVersion} 缺少 ${topRule.riskLevel} 随访 SLA，已阻止自动任务创建`);
    }
    const evaluatedAt = new Date();
    return {
      isAbnormal: true,
      riskLevel: topRule.riskLevel,
      title: getAlertTitle(topRule),
      description: [`${topRule.displayName} ${value} ${dto.unit || topRule.unit}`, `命中规则：${topRule.templateName} / ${formatRuleThreshold(topRule)}`, topRule.alertDescription, topRule.followUpAction ? `建议处理：${topRule.followUpAction}` : undefined].filter(Boolean).join('；'),
      triggerRule: `规则配置：${topRule.templateName} ${topRule.templateVersion}，${topRule.displayName} ${formatRuleThreshold(topRule)}，判定为${riskLabelMap[topRule.riskLevel]}`,
      matchedRuleId: topRule.id,
      matchedTemplateId: topRule.templateId,
      matchedTemplateName: topRule.templateName,
      followUpAction: topRule.followUpAction,
      followUpDueWithinHours: policy.dueWithinHours,
      followUpTaskTitle: policy.taskTitle,
      ruleTrace: { ruleId: topRule.id, ruleVersion: topRule.templateVersion, ruleSnapshot: topRule, evidenceBasis: topRule.evidenceBasis, evaluatedAt, inputSnapshot: { patientId: patient.id, vitalType: dto.type, value, unit: dto.unit }, matchedConditions: matchedRules },
    };
  }

  async evaluateQuestionnaire(
    questionnaireType: string,
    score: number,
    options?: { questionnaireTemplateId?: string },
  ): Promise<ClinicalQuestionnaireRuleEvaluation | null> {
    const normalizedQuestionnaireType = normalizeQuestionnaireType(questionnaireType);
    const questionnaire = await this.prisma.questionnaireTemplate.findFirst({
      where: options?.questionnaireTemplateId
        ? { id: options.questionnaireTemplateId, questionnaireType: normalizedQuestionnaireType, isActive: true }
        : { questionnaireType: normalizedQuestionnaireType, isActive: true, template: this.effectiveTemplateWhere() },
      include: { template: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!questionnaire) return null;
    const bands = parseRiskBands(questionnaire.riskBands);
    const matchedBand = bands.filter((band) => matchesBand(score, band)).sort((a, b) => riskRank[b.riskLevel] - riskRank[a.riskLevel])[0];
    if (!matchedBand) throw new BadRequestException(`问卷 ${normalizedQuestionnaireType} 的 riskBands 未覆盖评分 ${score}`);
    const shouldCreateAlert = matchedBand.shouldCreateAlert ?? (matchedBand.riskLevel === RiskLevel.HIGH || matchedBand.riskLevel === RiskLevel.VERY_HIGH);
    const policy = await this.prisma.followUpPolicy.findFirst({ where: { templateId: questionnaire.templateId, riskLevel: matchedBand.riskLevel, isActive: true }, orderBy: [{ dueWithinHours: 'asc' }, { createdAt: 'asc' }] });
    if (shouldCreateAlert && !policy) {
      throw new BadRequestException(`生效问卷规则 ${questionnaire.template.templateName} ${questionnaire.template.version} 缺少 ${matchedBand.riskLevel} 随访 SLA，已阻止自动任务创建`);
    }
    const evaluatedAt = new Date();
    return {
      riskLevel: matchedBand.riskLevel,
      riskConclusion: matchedBand.conclusion ?? questionnaireConclusion(matchedBand.riskLevel),
      shouldCreateAlert,
      // No task is created for LOW/MEDIUM bands. A zero value prevents an
      // unreviewed operational fallback from leaking into released rules.
      followUpDueWithinHours: policy?.dueWithinHours ?? 0,
      followUpTaskTitle: policy?.taskTitle ?? `问卷复核：${normalizedQuestionnaireType}`,
      ruleTrace: {
        ruleId: questionnaire.id,
        ruleVersion: questionnaire.template.version,
        ruleSnapshot: { questionnaireTemplateId: questionnaire.id, questionnaireType: normalizedQuestionnaireType, riskBands: questionnaire.riskBands, scoringRule: questionnaire.scoringRule },
        evidenceBasis: questionnaire.template.evidenceBasis ?? questionnaire.template.riskBasis,
        evaluatedAt,
        inputSnapshot: { submittedQuestionnaireType: questionnaireType, questionnaireType: normalizedQuestionnaireType, score },
        matchedConditions: matchedBand,
      },
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


