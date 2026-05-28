/**
 * discharge-followup-plan.constants.ts
 *
 * gateway-production-hardening: 出院后随访任务策略模板.
 *
 * 适用场景: 患者从我院出院后, 慢病管理团队需要按照一套固定的"出院后随访骨架"
 * 主动跟踪患者, 尤其是 D+2 / D+7 / D+14 / D+30 这几个关键观察窗口.
 *
 * 这与 FollowupPlanGeneratorService 的"入组随访"是平行系统:
 *   - 入组随访: 患者刚加入慢病管理时一次性下发, 锚点是 enrolledAt
 *   - 出院随访: 每次出院都触发一份, 锚点是 dischargeTime
 *
 * 一个患者可以同时拥有这两类任务, 它们在 Task.type 上用不同前缀区分:
 *   - 入组: ENROLLMENT_*
 *   - 出院: DISCHARGE_FU_*
 *
 * 设计要点:
 *   - 4 条任务的间隔基于国内慢病管理实操经验:
 *       D+2  电话随访     -- 出院后 48h 内, 用药遵从 + 症状监测
 *       D+7  用药依从核查 -- 一周时, 检查处方是否在按时服用
 *       D+14 复诊提醒     -- 两周时, 提醒预约复诊
 *       D+30 体征监测核查 -- 一个月时, 综合复盘
 *   - 病种特化: 心血管 / 糖尿病 出院增加 D+3 体征采集提醒 (高风险窗口提前)
 */

import { DiseaseType } from '@prisma/client';

/** 所有由本服务生成的任务, type 字段都以这个前缀开头, 便于幂等查询. */
export const DISCHARGE_FU_TASK_TYPE_PREFIX = 'DISCHARGE_FU_';

export interface DischargeFollowupTaskTemplate {
  type: string;
  title: string;
  dueAt: Date;
  offsetLabel: string;
  offsetKey: string;
  channelHint: 'PHONE' | 'IN_PERSON' | 'QUESTIONNAIRE' | 'VITAL_CHECK';
  description: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

/**
 * 触发出院 D+3 体征采集的病种白名单.
 * 心血管 / 糖尿病 出院初期是 RiskAlert 高发窗口, 越早采到数据越能保命.
 */
const HIGH_RISK_EARLY_VITAL_DISEASES: ReadonlySet<DiseaseType> = new Set([
  DiseaseType.HYPERTENSION,
  DiseaseType.CORONARY_HEART_DISEASE,
  DiseaseType.TYPE_2_DIABETES,
]);

export interface BuildDischargePlanInput {
  diseaseType?: DiseaseType | null;
  dischargeTime: Date;
  /** 唯一标识本次出院, 用于在 Task.type 后缀里做幂等 (e.g. encounterId). */
  dischargeRef: string;
}

export interface DischargeFollowupPlanTemplate {
  tasks: DischargeFollowupTaskTemplate[];
}

export function buildDischargeFollowupPlanTemplate(
  input: BuildDischargePlanInput,
): DischargeFollowupPlanTemplate {
  const { dischargeTime, diseaseType, dischargeRef } = input;
  const refSuffix = sanitize(dischargeRef).slice(0, 32) || 'NOREF';

  const tasks: DischargeFollowupTaskTemplate[] = [];

  tasks.push({
    type: `DISCHARGE_FU_PHONE_D2__${refSuffix}`,
    title: `出院 D+2 电话随访 - 用药与症状核查`,
    dueAt: addDays(dischargeTime, 2),
    offsetLabel: '出院后第 2 天',
    offsetKey: 'D2',
    channelHint: 'PHONE',
    description:
      '出院后 48 小时核心动作: 确认出院带药已按时服用; 询问主要症状是否复发或加重; 评估患者居家自管的难点; ' +
      '若发现高风险征象 (胸痛 / 严重低血糖 / 突发气促 等) 立即触发复诊提醒.',
  });

  // 心血管 / 糖尿病 高风险患者: D+3 体征采集提醒 (早 1 天)
  if (diseaseType && HIGH_RISK_EARLY_VITAL_DISEASES.has(diseaseType)) {
    tasks.push({
      type: `DISCHARGE_FU_VITAL_D3__${refSuffix}`,
      title: `出院 D+3 体征采集提醒 - 高风险窗口`,
      dueAt: addDays(dischargeTime, 3),
      offsetLabel: '出院后第 3 天',
      offsetKey: 'D3',
      channelHint: 'VITAL_CHECK',
      description:
        '高风险病种 (高血压 / 冠心病 / 2 型糖尿病) 出院后第 3 天血压 / 血糖波动较大, ' +
        '提醒患者通过小程序录入晨起体征; 若 48h 内仍无数据, 主动电话外呼.',
    });
  }

  tasks.push({
    type: `DISCHARGE_FU_MEDICATION_D7__${refSuffix}`,
    title: `出院 D+7 用药依从性核查`,
    dueAt: addDays(dischargeTime, 7),
    offsetLabel: '出院后第 7 天',
    offsetKey: 'D7',
    channelHint: 'QUESTIONNAIRE',
    description:
      '出院后一周用药断档高发. 通过用药依从问卷 + 打卡记录, 核查患者是否漏服 / 自行停药, ' +
      '识别需要药师介入的患者, 必要时主动联系患者并把信息回写到 EMR.',
  });

  tasks.push({
    type: `DISCHARGE_FU_VISIT_D14__${refSuffix}`,
    title: `出院 D+14 复诊提醒`,
    dueAt: addDays(dischargeTime, 14),
    offsetLabel: '出院后第 14 天',
    offsetKey: 'D14',
    channelHint: 'IN_PERSON',
    description:
      '到出院后第 2 周需要确认患者已预约复诊或已完成首次复诊. ' +
      '未约则发送预约提示并由分诊护士主动联系; 已复诊则记录复诊结论以备 D+30 综合复盘.',
  });

  tasks.push({
    type: `DISCHARGE_FU_VITAL_D30__${refSuffix}`,
    title: `出院 D+30 体征监测综合核查`,
    dueAt: addDays(dischargeTime, 30),
    offsetLabel: '出院后第 30 天',
    offsetKey: 'D30',
    channelHint: 'VITAL_CHECK',
    description:
      '一个月时综合复盘: 30 天内体征采集次数 / 异常预警次数 / 复诊情况 / 用药依从率. ' +
      '不达标者降级为高频随访; 达标者进入常规月度随访节奏.',
  });

  return { tasks };
}

function sanitize(s: string): string {
  // 把 ref 里的非字母数字下划线干掉, 防止破坏 Task.type 的 LIKE 索引前缀.
  return s.replace(/[^a-zA-Z0-9_-]/g, '');
}
