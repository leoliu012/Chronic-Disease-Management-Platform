/**
 * followup-plan-generator.constants.ts —— 入组随访计划默认模板
 *
 * 每个病种入组后的第一年「常规随访骨架」。
 *
 * 通用骨架（所有病种）：
 *   D+3   电话随访 - 新患者入组
 *   D+14  门诊复诊提醒
 *
 * 病种特化（仅当 diseaseType 命中以下白名单时）：
 *   M+1..M+12 每月推送病种宣教问卷
 *
 * 注意：这套常量不是规则配置中心的可编辑模板（ClinicalRulesService.FollowUpPolicy
 * 那个是病种通用的随访策略，按 RiskLevel 触发）。我们这里关心的是「入组」一次性事件
 * 的随访锚点，所以独立维护一份模板。后续可以由临床配置中心接管。
 */

import { DiseaseType } from '@prisma/client';

/** 所有由本服务生成的任务，type 字段都以这个前缀开头，便于幂等查询。 */
export const ENROLLMENT_TASK_TYPE_PREFIX = 'ENROLLMENT_';

/**
 * 单条入组任务的模板表示。`dueAt` 在 service 层根据 enrolledAt + offsetDays 计算。
 */
export type EnrollmentPlanTaskTemplate = {
  type: string;
  title: string;
  dueAt: Date;
  /** 计划锚点（用于审计日志中描述「入组第3天」之类） */
  offsetLabel: string;
  /** 幂等 + 审计辅助键 */
  offsetKey: string;
  /** 频率描述（用于 audit event） */
  frequencyDescription: string;
};

export type EnrollmentPlanTemplate = {
  tasks: EnrollmentPlanTaskTemplate[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 病种 → 月度问卷类型。
 * 只有命中白名单的病种才会下发月度问卷；未命中的（如 OTHER）只生成 D+3 / D+14 骨架。
 *
 * 这里的 questionnaireType 命名与 ClinicalRulesService.defaultDiseaseRuleTemplates 中
 * 的 questionnaireTemplates[].questionnaireType 完全对齐，方便患者端小程序填写问卷时
 * 自动找到对应模板。
 */
const DISEASE_MONTHLY_QUESTIONNAIRE: Partial<
  Record<
    DiseaseType,
    {
      questionnaireType: string;
      questionnaireTitle: string;
    }
  >
> = {
  [DiseaseType.HYPERTENSION]: {
    questionnaireType: 'HYPERTENSION_MONTHLY',
    questionnaireTitle: '高血压月度随访问卷',
  },
  [DiseaseType.TYPE_2_DIABETES]: {
    questionnaireType: 'DIABETES_MONTHLY',
    questionnaireTitle: '糖尿病月度随访问卷',
  },
  [DiseaseType.COPD]: {
    questionnaireType: 'COPD_CAT',
    questionnaireTitle: '慢阻肺 CAT 症状评估',
  },
  [DiseaseType.CORONARY_HEART_DISEASE]: {
    questionnaireType: 'CHD_MONTHLY',
    questionnaireTitle: '冠心病月度随访问卷',
  },
  [DiseaseType.HYPERLIPIDEMIA]: {
    questionnaireType: 'LIPID_LIFESTYLE',
    questionnaireTitle: '血脂生活方式问卷',
  },
  [DiseaseType.OBESITY]: {
    questionnaireType: 'OBESITY_LIFESTYLE',
    questionnaireTitle: '体重管理生活方式问卷',
  },
};

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * DAY_MS);
}

function addMonths(base: Date, months: number) {
  const next = new Date(base.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
}

function diseaseLabel(diseaseType?: DiseaseType | null): string {
  if (!diseaseType) return '慢病';
  const map: Record<DiseaseType, string> = {
    [DiseaseType.HYPERTENSION]: '高血压',
    [DiseaseType.TYPE_2_DIABETES]: '2 型糖尿病',
    [DiseaseType.COPD]: '慢阻肺',
    [DiseaseType.CORONARY_HEART_DISEASE]: '冠心病',
    [DiseaseType.HYPERLIPIDEMIA]: '高脂血症',
    [DiseaseType.OBESITY]: '肥胖症',
    [DiseaseType.OTHER]: '慢病',
  };
  return map[diseaseType] ?? '慢病';
}

export function buildEnrollmentPlanTemplate(input: {
  diseaseType?: DiseaseType | null;
  enrolledAt: Date;
}): EnrollmentPlanTemplate {
  const { enrolledAt } = input;
  const diseaseType = input.diseaseType ?? null;
  const label = diseaseLabel(diseaseType);

  const tasks: EnrollmentPlanTaskTemplate[] = [];

  // ----- D+3 电话随访 -----
  tasks.push({
    type: 'ENROLLMENT_PHONE_FOLLOWUP_DAY3',
    title: `入组第3天电话随访 - ${label}`,
    dueAt: addDays(enrolledAt, 3),
    offsetLabel: '第 3 天',
    offsetKey: 'D3',
    frequencyDescription: '一次性',
  });

  // ----- D+14 门诊复诊提醒 -----
  tasks.push({
    type: 'ENROLLMENT_OUTPATIENT_VISIT_REMINDER_DAY14',
    title: `入组第14天门诊复诊提醒 - ${label}`,
    dueAt: addDays(enrolledAt, 14),
    offsetLabel: '第 14 天',
    offsetKey: 'D14',
    frequencyDescription: '一次性',
  });

  // ----- 月度问卷推送（仅对白名单病种） -----
  const monthly = diseaseType ? DISEASE_MONTHLY_QUESTIONNAIRE[diseaseType] : undefined;
  if (monthly) {
    for (let month = 1; month <= 12; month += 1) {
      tasks.push({
        type: `ENROLLMENT_MONTHLY_QUESTIONNAIRE_M${month}`,
        title: `第 ${month} 月推送：${monthly.questionnaireTitle}`,
        dueAt: addMonths(enrolledAt, month),
        offsetLabel: `第 ${month} 个月`,
        offsetKey: `M${month}`,
        frequencyDescription: `每月一次（共 12 次），问卷类型 ${monthly.questionnaireType}`,
      });
    }
  }

  return { tasks };
}
