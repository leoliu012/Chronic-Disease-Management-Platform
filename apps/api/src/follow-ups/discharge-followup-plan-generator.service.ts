/**
 * discharge-followup-plan-generator.service.ts
 *
 * gateway-production-hardening: 患者出院事件触发的随访任务策略生成器.
 *
 * 与 FollowupPlanGeneratorService (入组随访) 同构:
 *   - 幂等. 同一 (patientId, dischargeRef) 已经生成过 -> 跳过.
 *   - 不抛错. promote 主流程不应该因为随访模板生成失败而 500.
 *
 * 调用方:
 *   IntegrationPromoteService.promoteEncounter(isDischarge=true) 在写完
 *   EncounterRecord + MedicalRecordSummary 之后调用本服务.
 *
 * 输出:
 *   - 一批 DISCHARGE_FU_* Task (PENDING, 带 dueAt)
 *   - 每条 Task 配一条 TaskProcessingEvent (AUTO_GENERATED), 与入组保持一致
 *   - 一条 FollowUpRecord (followUpType=DISCHARGE_BASELINE), 让患者档案上能立刻
 *     看到 "出院后随访计划已下发" 这一事件
 */

import { Injectable, Logger } from '@nestjs/common';
import { DiseaseType, Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildDischargeFollowupPlanTemplate,
  DISCHARGE_FU_TASK_TYPE_PREFIX,
  type DischargeFollowupTaskTemplate,
} from './discharge-followup-plan.constants';

export interface GenerateDischargePlanInput {
  patientId: string;
  /** 这次出院的稳定标识 - 一般是 EncounterRecord.id 或 externalVisitId */
  dischargeRef: string;
  /** 主病种 (来自该次住院 diagnosis 或患者活跃 DiseaseProfile) */
  diseaseType?: DiseaseType | null;
  /** 出院时间 - 锚点 */
  dischargeTime: Date;
  /** 触发链路, 写到 audit log 里 */
  triggerSource?: string;
  /** 默认负责人 (操作护士). null 则不预分配 */
  assigneeId?: string | null;
}

export interface GenerateDischargePlanResult {
  generated: boolean;
  taskIds: string[];
  skippedReason?: string;
  diseaseType: DiseaseType | null;
  dischargeRef: string;
}

@Injectable()
export class DischargeFollowupPlanGeneratorService {
  private readonly logger = new Logger(DischargeFollowupPlanGeneratorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateForDischarge(
    input: GenerateDischargePlanInput,
  ): Promise<GenerateDischargePlanResult> {
    const diseaseType = input.diseaseType ?? null;
    const triggerSource = input.triggerSource ?? 'UNKNOWN';
    const dischargeRef = input.dischargeRef;

    if (!dischargeRef) {
      this.logger.warn(
        `[DischargePlan] patient=${input.patientId} skipped: missing dischargeRef trigger=${triggerSource}`,
      );
      return {
        generated: false,
        taskIds: [],
        skippedReason: 'MISSING_DISCHARGE_REF',
        diseaseType,
        dischargeRef,
      };
    }

    try {
      // 幂等检查 — Task.type 形如 DISCHARGE_FU_*_<ref>; 用 contains <ref> 找
      // (Task.type 没有唯一索引, 这是和 ENROLLMENT_* 一样的脚手架级 idempotency).
      const refTag = `__${sanitizeRef(dischargeRef)}`;
      const existing = await this.prisma.task.findFirst({
        where: {
          patientId: input.patientId,
          type: {
            startsWith: DISCHARGE_FU_TASK_TYPE_PREFIX,
            endsWith: refTag,
          },
        },
        select: { id: true, type: true },
      });
      if (existing) {
        this.logger.log(
          `[DischargePlan] patient=${input.patientId} discharge=${dischargeRef} skipped: idempotent (existing=${existing.type})`,
        );
        return {
          generated: false,
          taskIds: [],
          skippedReason: 'IDEMPOTENT_EXISTING_PLAN',
          diseaseType,
          dischargeRef,
        };
      }

      const template = buildDischargeFollowupPlanTemplate({
        diseaseType,
        dischargeTime: input.dischargeTime,
        dischargeRef,
      });
      if (template.tasks.length === 0) {
        return {
          generated: false,
          taskIds: [],
          skippedReason: 'EMPTY_TEMPLATE',
          diseaseType,
          dischargeRef,
        };
      }

      const taskIds = await this.prisma.$transaction(async (tx) => {
        const created: string[] = [];
        for (const tpl of template.tasks) {
          const task = await tx.task.create({
            data: this.toTaskInput(input, tpl),
            select: { id: true },
          });
          created.push(task.id);

          await tx.taskProcessingEvent
            .create({
              data: {
                taskId: task.id,
                patientId: input.patientId,
                eventType: 'AUTO_GENERATED',
                title: `自动生成 · ${tpl.title}`,
                description:
                  `出院后随访任务自动生成。\n` +
                  `病种：${diseaseType ?? '未指定'}\n` +
                  `出院引用：${dischargeRef}\n` +
                  `触发链路：${triggerSource}\n` +
                  `计划锚点：${tpl.offsetLabel}\n` +
                  `渠道：${tpl.channelHint}\n` +
                  `内容：${tpl.description}`,
                sourceType: 'DISCHARGE_FOLLOWUP_GENERATOR',
                sourceId: `${diseaseType ?? 'GENERIC'}:${tpl.offsetKey}:${dischargeRef}`,
              },
            })
            .catch((err) => {
              this.logger.warn(
                `[DischargePlan] processing-event audit failed task=${task.id}: ${(err as Error).message}`,
              );
            });
        }

        // FollowUpRecord baseline - 在患者档案时间线上记录"出院随访计划下发"事件
        await tx.followUpRecord
          .create({
            data: {
              patientId: input.patientId,
              followUpType: 'DISCHARGE_BASELINE',
              followUpTime: input.dischargeTime,
              content:
                `患者本次出院已自动生成 ${created.length} 条出院后随访任务。\n` +
                `主病种：${diseaseType ?? '未指定'}\n` +
                `出院引用：${dischargeRef}`,
              result: '已生成出院后随访计划',
              suggestion: `下次自动随访：${formatDate(template.tasks[0].dueAt)}（${template.tasks[0].title}）`,
              nextFollowUpTime: template.tasks[0].dueAt,
              operatorId: input.assigneeId ?? undefined,
            },
          })
          .catch((err) => {
            this.logger.warn(
              `[DischargePlan] discharge-baseline follow-up failed patient=${input.patientId}: ${(err as Error).message}`,
            );
          });

        return created;
      });

      this.logger.log(
        `[DischargePlan] generated patient=${input.patientId} discharge=${dischargeRef} disease=${diseaseType ?? '-'} ` +
          `taskCount=${taskIds.length} trigger=${triggerSource}`,
      );
      return { generated: true, taskIds, diseaseType, dischargeRef };
    } catch (err) {
      this.logger.error(
        `[DischargePlan] FAILED patient=${input.patientId} discharge=${dischargeRef} ` +
          `trigger=${triggerSource}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return {
        generated: false,
        taskIds: [],
        skippedReason: 'EXCEPTION',
        diseaseType,
        dischargeRef,
      };
    }
  }

  private toTaskInput(
    input: GenerateDischargePlanInput,
    tpl: DischargeFollowupTaskTemplate,
  ): Prisma.TaskUncheckedCreateInput {
    return {
      patientId: input.patientId,
      title: tpl.title,
      type: tpl.type,
      status: TaskStatus.PENDING,
      dueAt: tpl.dueAt,
      assigneeId: input.assigneeId ?? undefined,
    };
  }
}

function sanitizeRef(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'NOREF';
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
