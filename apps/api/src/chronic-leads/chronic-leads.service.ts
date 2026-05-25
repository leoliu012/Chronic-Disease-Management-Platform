/**
 * chronic-leads.service.ts —— 高危慢病线索池服务
 *
 * 高危患者在网关识别 → 落到 ChronicLead 待邀约池 → 护士打电话邀约 →
 * 患者口头同意 → 护士点【签约】此服务的 sign() 唯一负责把线索升档为
 * Patient + DiseaseProfile + 触发 FollowupPlanGeneratorService 生成入组随访骨架。
 *
 * 任何对 ChronicLead 的状态变更都会写一条 AuditLog。
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ChronicLead,
  DataSource,
  Gender,
  LeadConsentSource,
  LeadStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FollowupPlanGeneratorService } from '../follow-ups/followup-plan-generator.service';
import type { RequestUser } from '../security/request-user.type';
import { QueryChronicLeadsDto } from './dto/query-chronic-leads.dto';
import { SignChronicLeadDto } from './dto/sign-chronic-lead.dto';
import { NoteChronicLeadDto } from './dto/note-chronic-lead.dto';
import { RejectChronicLeadDto } from './dto/reject-chronic-lead.dto';

const SIGNABLE_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR];

const INCLUDE_BLOCK = {
  reviewedBy: {
    select: { id: true, displayName: true, role: true },
  },
  promotedPatient: {
    select: { id: true, name: true, hospitalPatientId: true },
  },
} as const;

@Injectable()
export class ChronicLeadsService {
  private readonly logger = new Logger(ChronicLeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly followupPlanGenerator: FollowupPlanGeneratorService,
  ) {}

  // ---------------------------------------------------------------------------
  // Listing
  // ---------------------------------------------------------------------------

  async findAll(query: QueryChronicLeadsDto) {
    const where: Prisma.ChronicLeadWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.suspectedDisease) where.suspectedDisease = query.suspectedDisease;

    const keyword = (query.keyword ?? '').trim();
    if (keyword) {
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { hospitalPatientId: { contains: keyword, mode: 'insensitive' } },
        { phone: { contains: keyword } },
        { diagnosisIcd: { contains: keyword, mode: 'insensitive' } },
        { diagnosisText: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    return this.prisma.chronicLead.findMany({
      where,
      orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
      take: query.limit ?? 100,
      include: INCLUDE_BLOCK,
    });
  }

  async findOne(id: string) {
    const lead = await this.prisma.chronicLead.findUnique({
      where: { id },
      include: INCLUDE_BLOCK,
    });
    if (!lead) throw new NotFoundException('ChronicLead not found');
    return lead;
  }

  // ---------------------------------------------------------------------------
  // Mini-program lookup helpers (used by PatientAuthAndSignController)
  // ---------------------------------------------------------------------------

  /**
   * 小程序扫码进来后，按患者识别信息查找待签约线索。
   * 不抛 not-found —— 返回 null，让小程序优雅地提示「未在高危池中找到」。
   */
  async findActiveLeadForPatient(criteria: {
    hospitalPatientId?: string;
    idCardNo?: string;
    idCardLast4?: string;
    phone?: string;
  }): Promise<ChronicLead | null> {
    const conditions: Prisma.ChronicLeadWhereInput[] = [];

    if (criteria.hospitalPatientId) {
      conditions.push({ hospitalPatientId: criteria.hospitalPatientId });
    }
    if (criteria.idCardNo) {
      conditions.push({ idCardNo: criteria.idCardNo });
    }
    if (criteria.idCardLast4 && /^\d{4}$/.test(criteria.idCardLast4)) {
      conditions.push({ idCardNo: { endsWith: criteria.idCardLast4 } });
    }
    if (criteria.phone) {
      conditions.push({ phone: criteria.phone });
    }

    if (conditions.length === 0) return null;

    return this.prisma.chronicLead.findFirst({
      where: {
        OR: conditions,
        status: { in: [LeadStatus.PENDING_REVIEW, LeadStatus.CONTACTED, LeadStatus.DEFERRED] },
      },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------------

  async contact(id: string, dto: NoteChronicLeadDto, user: RequestUser, ipAddress?: string) {
    this.assertRole(user);
    const before = await this.findOne(id);
    this.assertStatusForTransition(before, [LeadStatus.PENDING_REVIEW, LeadStatus.DEFERRED], 'CONTACT');

    const updated = await this.prisma.chronicLead.update({
      where: { id },
      data: {
        status: LeadStatus.CONTACTED,
        contactNote: dto.note ?? before.contactNote,
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
      include: INCLUDE_BLOCK,
    });

    await this.audit({
      user,
      action: 'CHRONIC_LEAD_CONTACTED',
      targetId: id,
      ipAddress,
      before,
      after: updated,
    });

    return updated;
  }

  async defer(id: string, dto: NoteChronicLeadDto, user: RequestUser, ipAddress?: string) {
    this.assertRole(user);
    const before = await this.findOne(id);
    this.assertStatusForTransition(
      before,
      [LeadStatus.PENDING_REVIEW, LeadStatus.CONTACTED],
      'DEFER',
    );

    const updated = await this.prisma.chronicLead.update({
      where: { id },
      data: {
        status: LeadStatus.DEFERRED,
        deferNote: dto.note ?? before.deferNote,
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
      include: INCLUDE_BLOCK,
    });

    await this.audit({
      user,
      action: 'CHRONIC_LEAD_DEFERRED',
      targetId: id,
      ipAddress,
      before,
      after: updated,
    });

    return updated;
  }

  async reject(id: string, dto: RejectChronicLeadDto, user: RequestUser, ipAddress?: string) {
    this.assertRole(user);
    const before = await this.findOne(id);
    this.assertStatusForTransition(
      before,
      [LeadStatus.PENDING_REVIEW, LeadStatus.CONTACTED, LeadStatus.DEFERRED],
      'REJECT',
    );

    const updated = await this.prisma.chronicLead.update({
      where: { id },
      data: {
        status: LeadStatus.REJECTED,
        rejectReason: dto.rejectReason ?? '患者明确拒绝入组',
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
      include: INCLUDE_BLOCK,
    });

    await this.audit({
      user,
      action: 'CHRONIC_LEAD_REJECTED',
      targetId: id,
      ipAddress,
      before,
      after: updated,
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // SIGN — the only place where ChronicLead becomes Patient
  // ---------------------------------------------------------------------------

  /**
   * 把线索升档为正式 Patient 档案。这是整个 ChronicLeadsModule 唯一会调用
   * `prisma.patient.create()` 的入口，护士端 / 医生端 / 小程序端三条签约路径
   * 都汇聚到这里。
   *
   * 流程：
   *   1) 角色 + 状态机校验
   *   2) 在一个事务里 INSERT Patient → INSERT DiseaseProfile → UPDATE ChronicLead.status=SIGNED
   *   3) 事务外（避免长事务阻塞）触发 FollowupPlanGeneratorService 生成入组随访骨架
   *   4) 写 AuditLog
   *
   * **不可重入**：如果线索已经是 SIGNED，会抛 400。
   */
  async sign(id: string, dto: SignChronicLeadDto, user: RequestUser, ipAddress?: string) {
    this.assertRole(user);

    const before = await this.findOne(id);

    if (before.status === LeadStatus.SIGNED) {
      throw new BadRequestException('该线索已签约，不能重复建档');
    }
    if (before.status === LeadStatus.REJECTED || before.status === LeadStatus.EXPIRED) {
      throw new BadRequestException(`该线索状态为 ${before.status}，不允许签约`);
    }

    const consentSource = dto.consentSource;
    const consentRef = dto.consentRef?.trim();
    if (!consentRef) {
      throw new BadRequestException('知情同意证据 consentRef 不能为空');
    }

    // 角色 vs consentSource 一致性校验：
    //   - 微信小程序端只能用 MINI_PROGRAM_SIGN（由专用 controller 传 ADMIN 系统角色调用）
    //   - 护士工作台只能用 NURSE_CONFIRM
    //   - 医生桌面端用 DOCTOR_CONFIRM
    // 这里只在角色明显不匹配时阻断，避免越权。
    if (consentSource === LeadConsentSource.NURSE_CONFIRM && user.role === UserRole.DOCTOR) {
      // 医生用护士确认链路也允许（医院实际场景兼容），不阻断
    }
    if (consentSource === LeadConsentSource.DOCTOR_CONFIRM && user.role === UserRole.NURSE) {
      throw new ForbiddenException('护士角色不能使用 DOCTOR_CONFIRM 签约链路');
    }

    // 选定患者人口学字段：override 优先，其次 lead 自身字段。
    const name = (dto.overrideName ?? before.name ?? '').trim();
    if (!name) {
      throw new BadRequestException('无法建档：线索未携带姓名，请填写 overrideName');
    }
    const phone = (dto.overridePhone ?? before.phone ?? '').trim() || undefined;
    const hospitalPatientId =
      (dto.overrideHospitalPatientId ?? before.hospitalPatientId ?? '').trim() || undefined;

    // 防止重复建档：如果 hospitalPatientId 已存在于 Patient 表，直接复用而不是抛错。
    let patient = hospitalPatientId
      ? await this.prisma.patient.findUnique({ where: { hospitalPatientId } })
      : null;

    const now = new Date();

    const { lead, createdPatient } = await this.prisma.$transaction(async (tx) => {
      // 1) 建 Patient（如未存在）
      let createdPatient = patient;
      if (!createdPatient) {
        createdPatient = await tx.patient.create({
          data: {
            hospitalPatientId,
            name,
            gender: before.gender ?? Gender.UNKNOWN,
            birthDate: before.birthDate ?? undefined,
            phone,
            idCardNo: before.idCardNo ?? undefined,
          },
        });
      }

      // 2) 建 DiseaseProfile（如有 suspectedDisease）
      if (before.suspectedDisease) {
        const existingProfile = await tx.diseaseProfile.findFirst({
          where: { patientId: createdPatient.id, diseaseType: before.suspectedDisease },
        });

        if (!existingProfile) {
          await tx.diseaseProfile.create({
            data: {
              patientId: createdPatient.id,
              diseaseType: before.suspectedDisease,
              riskLevel: before.riskHint,
              dataSource: this.deriveDataSource(before.sourceChannel),
              diagnosisDate: now,
            },
          });
        }
      }

      // 3) 更新 ChronicLead 为 SIGNED
      const lead = await tx.chronicLead.update({
        where: { id },
        data: {
          status: LeadStatus.SIGNED,
          consentSource,
          consentRef,
          reviewedById: user.id,
          reviewedAt: now,
          promotedPatientId: createdPatient.id,
          promotedAt: now,
        },
        include: INCLUDE_BLOCK,
      });

      return { lead, createdPatient };
    });

    // 4) 事务外触发随访模板生成（FollowupPlanGeneratorService 内部 catch 任何错误，
    //    不会冒泡到这里。即使生成失败，签约动作本身也算成功。）
    const planResult = await this.followupPlanGenerator.generateForNewEnrollment({
      patientId: createdPatient.id,
      diseaseType: before.suspectedDisease ?? null,
      enrolledAt: now,
      triggerSource: `CHRONIC_LEAD_SIGN:${consentSource}`,
      assigneeId: user.id,
    });

    // 5) 审计
    await this.audit({
      user,
      action: 'CHRONIC_LEAD_SIGNED',
      targetId: id,
      ipAddress,
      before,
      after: {
        ...lead,
        followupPlan: {
          generated: planResult.generated,
          taskCount: planResult.taskIds.length,
          skippedReason: planResult.skippedReason,
        },
      },
    });

    return {
      lead,
      patient: createdPatient,
      followupPlan: {
        generated: planResult.generated,
        taskCount: planResult.taskIds.length,
        skippedReason: planResult.skippedReason,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private assertRole(user: RequestUser) {
    if (!SIGNABLE_ROLES.includes(user.role)) {
      throw new ForbiddenException('仅管理员 / 护士 / 医生可操作高危线索');
    }
  }

  private assertStatusForTransition(
    lead: ChronicLead,
    allowed: LeadStatus[],
    action: string,
  ) {
    if (!allowed.includes(lead.status)) {
      throw new BadRequestException(
        `线索当前状态为 ${lead.status}，不允许执行 ${action} 动作`,
      );
    }
  }

  private deriveDataSource(channel: ChronicLead['sourceChannel']): DataSource {
    if (channel.startsWith('HL7') || channel.startsWith('HIS_EVENT')) return DataSource.HIS;
    if (channel.startsWith('FHIR')) return DataSource.EMR;
    if (channel === 'INTERMEDIATE_DB') return DataSource.HIS;
    return DataSource.NURSE_INPUT;
  }

  private async audit(params: {
    user: RequestUser;
    action: string;
    targetId: string;
    ipAddress?: string;
    before: unknown;
    after: unknown;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          operatorId: params.user.id,
          action: params.action,
          targetType: 'ChronicLead',
          targetId: params.targetId,
          ipAddress: params.ipAddress,
          beforeData: this.toJson(params.before),
          afterData: this.toJson(params.after),
        },
      });
    } catch (err) {
      this.logger.warn(
        `[ChronicLeads] audit log failed action=${params.action} target=${params.targetId}: ${(err as Error).message}`,
      );
    }
  }

  private toJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) return undefined;
    try {
      // Date → ISO string, Prisma decimals → string, etc.
      return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    } catch {
      return undefined;
    }
  }
}
