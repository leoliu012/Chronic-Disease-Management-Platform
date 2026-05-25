/**
 * followup-plan-generator.service.ts —— 入组随访计划生成引擎
 *
 * Mission:
 *   患者刚刚签署知情同意被升档为 Patient 之后，立刻把第一年的常规随访骨架
 *   摊在工作台上 —— 不再依赖任何一次性手动触发，也不需要等待第一条
 *   异常指标进来。
 *
 * 输出锚点：
 *   入组 D+3  「电话随访 - 新患者入组」    -> Task (PENDING)
 *   入组 D+14 「门诊复诊提醒」              -> Task (PENDING)
 *   入组 M+1..M+12 每月推送病种宣教问卷    -> Task (PENDING) × 12
 *
 * 设计要点：
 *   1) 这是一个**幂等**服务。同一 (patientId, diseaseType) 重复调用不会
 *      生成重复的入组任务，便于在多个入口（ChronicLeadsService.sign /
 *      DiseaseProfilesService.create / 手工兜底）都放心地调用。
 *      幂等键写在 Task.title 里，因为 schema 没有 externalKey 字段。
 *   2) 调用方传入 enrolledAt（一般是 patient.createdAt 或 lead.promotedAt），
 *      省去服务自己 findUnique 一次。
 *   3) **不抛错**给上游。即使整个生成过程都失败，也只在 stderr 留痕，
 *      绝不阻塞 Patient/Sign 主流程 —— 这是患者建档接口的核心动作，
 *      不能因为随访模板生成不出来就让护士点不了「确认签约」。
 *   4) 病种特化模板放在 followup-plan-generator.constants.ts，
 *      规则配置中心（ClinicalRulesService）以后能覆盖这些默认值。
 */

import { Injectable, Logger } from '@nestjs/common';
import { DiseaseType, Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildEnrollmentPlanTemplate,
  ENROLLMENT_TASK_TYPE_PREFIX,
  type EnrollmentPlanTaskTemplate,
} from './followup-plan-generator.constants';

export type GenerateEnrollmentPlanInput = {
  patientId: string;
  /**
   * 主病种 —— 若为 null/undefined，会生成一个不带病种特化问卷的最小骨架
   * (只有 D+3 电话随访 + D+14 复诊提醒，不下发月度问卷)。
   */
  diseaseType?: DiseaseType | null;
  /**
   * 入组时间锚点。`ChronicLeadsService.sign()` 应该传 `promotedAt`,
   * `DiseaseProfilesService.create()` 应该传 `new Date()`。
   */
  enrolledAt?: Date;
  /**
   * 触发链路用于审计/日志，例如 'CHRONIC_LEAD_SIGN' / 'DISEASE_PROFILE_CREATE' /
   * 'MANUAL_BOOTSTRAP'。
   */
  triggerSource?: string;
  /**
   * 默认负责人 —— 一般是当前操作护士 (req.user.id)。若为 null 则任务不预分配。
   */
  assigneeId?: string | null;
};

export type GenerateEnrollmentPlanResult = {
  /** 是否实际生成了新任务（幂等检测命中时返回 false） */
  generated: boolean;
  /** 本次生成的任务 ID 列表 */
  taskIds: string[];
  /** 跳过原因（幂等命中 / 病种为空 / 异常等） */
  skippedReason?: string;
  /** 主病种 */
  diseaseType: DiseaseType | null;
};

/**
 * 入组随访计划生成器。
 *
 * 这是一个无状态服务 —— 所有持久化都通过 PrismaService。
 * 因为 `Task` 表没有 unique 索引可以用，幂等性靠
 * `Task.type LIKE 'ENROLLMENT_%' AND Task.patientId = ?` 的批量查询实现。
 */
@Injectable()
export class FollowupPlanGeneratorService {
  private readonly logger = new Logger(FollowupPlanGeneratorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 主入口 —— 在患者刚晋级为正式档案后调用。
   *
   * **不会抛错**。所有错误吞掉后仅在日志里留痕，保证调用方的主流程
   * （Patient 建档）永远不会因为随访模板生成失败而 500。
   */
  async generateForNewEnrollment(input: GenerateEnrollmentPlanInput): Promise<GenerateEnrollmentPlanResult> {
    const diseaseType = input.diseaseType ?? null;
    const enrolledAt = input.enrolledAt ?? new Date();
    const triggerSource = input.triggerSource ?? 'UNKNOWN';

    try {
      // 1) 幂等检查 —— 如果该患者已经存在任何入组类任务，认为本次跳过。
      //    重复签约或重复创建病种 profile 都会走到这里，但只生成一次。
      const existing = await this.prisma.task.findFirst({
        where: {
          patientId: input.patientId,
          type: { startsWith: ENROLLMENT_TASK_TYPE_PREFIX },
        },
        select: { id: true, type: true },
      });

      if (existing) {
        this.logger.log(
          `[FollowupPlan] skip patient=${input.patientId} disease=${diseaseType ?? '-'} ` +
            `reason=idempotent_existing_task=${existing.type} trigger=${triggerSource}`,
        );
        return {
          generated: false,
          taskIds: [],
          skippedReason: 'IDEMPOTENT_EXISTING_PLAN',
          diseaseType,
        };
      }

      // 2) 组装病种特化模板。模板里每个 Task 的 dueAt 都是相对入组时间的 offset，
      //    在这里折算成绝对时间。
      const template = buildEnrollmentPlanTemplate({
        diseaseType,
        enrolledAt,
      });

      if (template.tasks.length === 0) {
        this.logger.warn(
          `[FollowupPlan] skip patient=${input.patientId} disease=${diseaseType ?? '-'} ` +
            `reason=empty_template trigger=${triggerSource}`,
        );
        return {
          generated: false,
          taskIds: [],
          skippedReason: 'EMPTY_TEMPLATE',
          diseaseType,
        };
      }

      // 3) 在一个事务里批量落库。Postgres 顺序 INSERT，单 patient 量级
      //    最多 14 条，开销可忽略。
      //    （注意：Prisma 的 createMany 不返回 id，所以这里逐条 create
      //    以便拿到 id 反馈给上游审计。14 次往返也是可控的。）
      const taskIds = await this.prisma.$transaction(async (tx) => {
        const created: string[] = [];

        for (const taskTpl of template.tasks) {
          const task = await tx.task.create({
            data: this.taskTemplateToInput(input, taskTpl),
            select: { id: true },
          });
          created.push(task.id);

          // 给每条入组任务记录一条 PROCESSING_EVENT，便于在
          // 工作台「处理记录」时间线上看到任务的来源。
          await tx.taskProcessingEvent
            .create({
              data: {
                taskId: task.id,
                patientId: input.patientId,
                eventType: 'AUTO_GENERATED',
                title: `自动生成 · ${taskTpl.title}`,
                description:
                  `入组随访计划自动生成。\n` +
                  `病种：${diseaseType ?? '未指定'}\n` +
                  `触发链路：${triggerSource}\n` +
                  `计划锚点：入组${taskTpl.offsetLabel}\n` +
                  `频率：${taskTpl.frequencyDescription}`,
                sourceType: 'FOLLOWUP_PLAN_GENERATOR',
                sourceId: `${diseaseType ?? 'GENERIC'}:${taskTpl.offsetKey}`,
              },
            })
            .catch((err) => {
              // 这条 event 失败不影响主流程
              this.logger.warn(
                `[FollowupPlan] processing-event audit failed task=${task.id}: ${(err as Error).message}`,
              );
            });
        }

        // 4) 在 FollowUpRecord 上写一条 enrollment 基线（便于患者档案上能看到“入组建档”这条事件）
        await tx.followUpRecord
          .create({
            data: {
              patientId: input.patientId,
              followUpType: 'ENROLLMENT_BASELINE',
              followUpTime: enrolledAt,
              content:
                `患者完成知情同意并入组慢病管理。\n` +
                `主病种：${diseaseType ?? '未指定'}\n` +
                `系统已生成入组第一年常规随访计划（共 ${created.length} 条待办）。`,
              result: '已生成入组随访计划',
              suggestion: `下次自动随访：${this.formatDate(template.tasks[0].dueAt)}（${template.tasks[0].title}）`,
              nextFollowUpTime: template.tasks[0].dueAt,
              operatorId: input.assigneeId ?? undefined,
            },
          })
          .catch((err) => {
            this.logger.warn(
              `[FollowupPlan] enrollment-baseline follow-up failed patient=${input.patientId}: ${(err as Error).message}`,
            );
          });

        return created;
      });

      this.logger.log(
        `[FollowupPlan] generated patient=${input.patientId} disease=${diseaseType ?? '-'} ` +
          `taskCount=${taskIds.length} trigger=${triggerSource}`,
      );

      return {
        generated: true,
        taskIds,
        diseaseType,
      };
    } catch (err) {
      // 兜底：失败时仅日志，不上抛。Patient 建档不会因为随访模板生成失败而 500。
      this.logger.error(
        `[FollowupPlan] FAILED patient=${input.patientId} disease=${diseaseType ?? '-'} ` +
          `trigger=${triggerSource}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return {
        generated: false,
        taskIds: [],
        skippedReason: 'EXCEPTION',
        diseaseType,
      };
    }
  }

  private taskTemplateToInput(
    input: GenerateEnrollmentPlanInput,
    tpl: EnrollmentPlanTaskTemplate,
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

  private formatDate(date: Date) {
    return date.toISOString().slice(0, 10);
  }
}
