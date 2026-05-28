import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FormLinkService } from './form-link.service';
import { OutboundMessageService, type Channel } from './outbound-message.service';
import { WechatOfficialAccountService } from './wechat-official-account.service';
import { HospitalWechatOfficialAccountService } from './hospital-wechat-account.service';

export type PreferredChannel = 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS' | 'MANUAL_COPY' | 'AUTO';

const ENGAGEMENT_TYPE_TO_MESSAGE_TYPE: Record<string, string> = {
  QUESTIONNAIRE: 'QUESTIONNAIRE_REMINDER',
  VITAL_RECHECK: 'VITAL_RECHECK_REMINDER',
  MEDICATION_CHECKIN: 'MEDICATION_REMINDER',
  HOSPITAL_VISIT_CONFIRM: 'HOSPITAL_VISIT_REMINDER',
  CONSENT_ONLY: 'QUESTIONNAIRE_REMINDER',
  GENERIC_NOTICE: 'QUESTIONNAIRE_REMINDER',
};

const DEFAULT_TITLE: Record<string, string> = {
  QUESTIONNAIRE: '请填写本次随访问卷',
  VITAL_RECHECK: '请提交本次指标复测',
  MEDICATION_CHECKIN: '请完成本次用药打卡',
  HOSPITAL_VISIT_CONFIRM: '请确认到院安排',
};

/**
 * PatientEngagementService (v2)
 * ------------------------------
 * 业务层入口. 上层 (controller) 都通过这里创建链接 + 选 channel + 发送.
 *
 * v2 关键变化:
 *   1. AUTO 频道选择按 *本院* 服务号配置走 — 没配置则直接 fallback SMS.
 *   2. send=false 也必须创建一条 MANUAL_COPY 消息 (status=PENDING),
 *      保留 token / linkUrl 在历史消息表中, 否则护士关闭弹窗后这条链接就找不回来.
 *   3. send=true 但失败: message 写 FAILED, 不删除链接.
 *   4. 所有文案改为"本院服务号" / "本院慢病管理团队".
 */
@Injectable()
export class PatientEngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly formLink: FormLinkService,
    private readonly outbound: OutboundMessageService,
    private readonly wechat: WechatOfficialAccountService,
    private readonly accounts: HospitalWechatOfficialAccountService,
  ) {}

  // ---------------------------------------------------------------------------
  // contact summary — used by patient detail page
  // ---------------------------------------------------------------------------

  async getContactSummary(patientId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      include: {
        wechatIdentities: { orderBy: { createdAt: 'desc' }, take: 1 },
        hospitalTenant: true,
      },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const lastMessage = await this.prisma.patientOutboundMessage.findFirst({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
    });

    // Per-tenant openId only — if patient has identities under other tenants
    // we don't count them.
    const tenantId = patient.hospitalTenantId ?? null;
    const account = tenantId ? await this.accounts.getAccountForTenant(tenantId) : null;

    let scopedIdentity = null as null | { openId: string; source: string };
    if (tenantId && account && patient.wechatIdentities.length) {
      const match = patient.wechatIdentities.find(
        (i) => i.hospitalTenantId === tenantId && i.appId === account.appId && i.isVerified,
      );
      if (match) scopedIdentity = { openId: match.openId, source: match.source };
    }

    const hasOpenId = Boolean(scopedIdentity);
    const hasPhone = Boolean(patient.phone);
    const tenantCanWechat = tenantId ? await this.wechat.tenantCanReceiveWechat(tenantId) : false;

    let recommendedChannel: Channel = 'MANUAL_COPY';
    if (hasOpenId && tenantCanWechat) recommendedChannel = 'WECHAT_OFFICIAL_ACCOUNT';
    else if (hasPhone) recommendedChannel = 'SMS';

    return {
      patientId,
      hospitalTenantId: tenantId,
      hospitalDisplayName:
        patient.hospitalTenant?.displayName || patient.hospitalTenant?.name || null,
      hospitalServiceAccountConfigured: Boolean(account),
      hospitalServiceAccountReady: tenantCanWechat,
      hasPhone,
      maskedPhone: patient.phone ? patient.phone.replace(/(\d{3})\d+(\d{4})/, '$1****$2') : null,
      hasOpenId,
      wechatIdentitySource: scopedIdentity?.source ?? null,
      lastMessage: lastMessage
        ? {
            id: lastMessage.id,
            channel: lastMessage.channel,
            status: lastMessage.status,
            messageType: lastMessage.messageType,
            sentAt: lastMessage.sentAt,
            clickedAt: lastMessage.clickedAt,
            submittedAt: lastMessage.submittedAt,
            createdAt: lastMessage.createdAt,
          }
        : null,
      recommendedChannel,
    };
  }

  // ---------------------------------------------------------------------------
  // create + optional send
  // ---------------------------------------------------------------------------

  private async resolvePatient(patientId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      include: {
        wechatIdentities: { orderBy: { createdAt: 'desc' }, take: 5 },
        hospitalTenant: true,
      },
    });
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }

  private async resolveAutoChannel(args: {
    hospitalTenantId: string | null;
    hasOpenIdForThisTenant: boolean;
    hasPhone: boolean;
  }): Promise<Channel> {
    if (!args.hospitalTenantId) return args.hasPhone ? 'SMS' : 'MANUAL_COPY';
    const tenantCanWechat = await this.wechat.tenantCanReceiveWechat(args.hospitalTenantId);
    if (args.hasOpenIdForThisTenant && tenantCanWechat) return 'WECHAT_OFFICIAL_ACCOUNT';
    if (args.hasPhone) return 'SMS';
    return 'MANUAL_COPY';
  }

  private buildContent(args: { type: string; title: string; linkUrl: string; description?: string | null }) {
    const intro =
      args.description?.trim() ||
      '本院慢病管理团队为您安排了一次随访任务, 请点击下方链接填写. 本链接仅用于本次任务, 72 小时内有效.';
    return `${intro}\n填写入口: ${args.linkUrl}\n(若链接打不开, 请直接复制到浏览器)`;
  }

  async createEngagementLink(input: {
    patientId: string;
    type: 'QUESTIONNAIRE' | 'VITAL_RECHECK' | 'MEDICATION_CHECKIN' | 'HOSPITAL_VISIT_CONFIRM' | 'CONSENT_ONLY' | 'GENERIC_NOTICE';
    title?: string;
    description?: string | null;
    payload?: Record<string, unknown> | null;
    expiresInHours?: number;
    taskId?: string | null;
    riskAlertId?: string | null;
    requiresIdentityCheck?: boolean;
    createdBy?: string | null;
    send?: boolean;
    preferredChannel?: PreferredChannel;
  }) {
    const patient = await this.resolvePatient(input.patientId);
    if (!patient.hospitalTenantId) {
      throw new BadRequestException('该患者尚未归属任何医院 (hospitalTenantId 为空), 无法创建随访链接.');
    }

    const requiresIdentityCheck =
      input.requiresIdentityCheck ??
      (input.type === 'VITAL_RECHECK' ||
        input.type === 'MEDICATION_CHECKIN' ||
        input.type === 'HOSPITAL_VISIT_CONFIRM');

    const { formLink, token, linkUrl } = await this.formLink.create({
      hospitalTenantId: patient.hospitalTenantId,
      patientId: patient.id,
      type: input.type,
      title: input.title || DEFAULT_TITLE[input.type] || '医院随访任务',
      description: input.description ?? undefined,
      payload: input.payload ?? undefined,
      expiresInHours: input.expiresInHours,
      taskId: input.taskId ?? undefined,
      riskAlertId: input.riskAlertId ?? undefined,
      requiresIdentityCheck,
      createdBy: input.createdBy ?? undefined,
    });

    await this.prisma.engagementEventLog.create({
      data: {
        patientId: patient.id,
        formLinkId: formLink.id,
        eventType: 'LINK_CREATED',
        metadata: {
          type: input.type,
          createdBy: input.createdBy ?? null,
          hospitalTenantId: patient.hospitalTenantId,
        } as any,
      },
    });

    // -----------------------------------------------------------------
    // resolve channel
    // -----------------------------------------------------------------

    const account = await this.accounts.getAccountForTenant(patient.hospitalTenantId);
    const scopedOpenId = (() => {
      if (!account) return null;
      const match = patient.wechatIdentities.find(
        (i) =>
          i.hospitalTenantId === patient.hospitalTenantId &&
          i.appId === account.appId &&
          i.isVerified,
      );
      return match?.openId ?? null;
    })();

    let channel: Channel;
    if (!input.preferredChannel || input.preferredChannel === 'AUTO') {
      channel = await this.resolveAutoChannel({
        hospitalTenantId: patient.hospitalTenantId,
        hasOpenIdForThisTenant: Boolean(scopedOpenId),
        hasPhone: Boolean(patient.phone),
      });
    } else {
      channel = input.preferredChannel;
    }

    let message: any = null;
    let sendResult: any = null;

    if (input.send) {
      const outcome = await this.sendForLink({
        formLink,
        patient: { id: patient.id, phone: patient.phone, scopedOpenId },
        channel,
        linkUrl,
        createdBy: input.createdBy ?? null,
      });
      message = outcome.message;
      // v2.1 (Problem 5): if WeChat send failed and SMS fallback was triggered,
      // outcome.message is the SMS row; report channel='SMS' and include
      // fallbackFrom='WECHAT_OFFICIAL_ACCOUNT' so the UI can show "本院微信发送
      // 失败, 已自动改用短信".
      const effectiveChannel = (outcome as any).fallbackUsed ? 'SMS' : channel;
      sendResult = {
        channel: effectiveChannel,
        status: outcome.message?.status,
        errorMessage: outcome.message?.errorMessage ?? null,
        fallbackFrom: (outcome as any).fallbackUsed ? channel : null,
        primary: (outcome as any).fallbackUsed
          ? {
              channel,
              status: (outcome as any).primary?.status,
              errorMessage: (outcome as any).primary?.errorMessage ?? null,
            }
          : null,
      };
    } else {
      // Bug 3 fix: create a MANUAL_COPY message so the link doesn't vanish
      // after the create modal closes. Status stays PENDING; nurse copies the
      // url, then optionally /mark-manual-sent later.
      message = await this.outbound.create({
        hospitalTenantId: patient.hospitalTenantId,
        patientId: patient.id,
        formLinkId: formLink.id,
        channel: 'MANUAL_COPY',
        messageType: ENGAGEMENT_TYPE_TO_MESSAGE_TYPE[input.type] || 'QUESTIONNAIRE_REMINDER',
        title: formLink.title,
        content: this.buildContent({
          type: input.type,
          title: formLink.title,
          linkUrl,
          description: input.description ?? undefined,
        }),
        linkUrl,
        recipient: null,
        createdBy: input.createdBy ?? undefined,
        initialStatus: 'PENDING',
      });
      sendResult = { channel: 'MANUAL_COPY', status: 'PENDING', errorMessage: null };
    }

    return { formLink, token, linkUrl, message, sendResult };
  }

  /**
   * Send (or attempt to send) an existing form link via the chosen channel.
   * Used both by createEngagementLink(send=true) and by /messages/:id/resend.
   */
  async sendForLink(args: {
    formLink: {
      id: string;
      patientId: string;
      type: string;
      title: string;
      description: string | null;
      hospitalTenantId: string | null;
    };
    patient: { id: string; phone: string | null; scopedOpenId: string | null };
    channel: Channel;
    linkUrl: string;
    createdBy?: string | null;
  }) {
    if (!args.formLink.hospitalTenantId) {
      throw new BadRequestException('表单链接缺少 hospitalTenantId, 无法发送.');
    }
    const messageType = ENGAGEMENT_TYPE_TO_MESSAGE_TYPE[args.formLink.type] || 'QUESTIONNAIRE_REMINDER';
    const content = this.buildContent({
      type: args.formLink.type,
      title: args.formLink.title,
      linkUrl: args.linkUrl,
      description: args.formLink.description,
    });

    let recipient: string | null = null;
    if (args.channel === 'WECHAT_OFFICIAL_ACCOUNT') recipient = args.patient.scopedOpenId;
    else if (args.channel === 'SMS') recipient = args.patient.phone;

    const message = await this.outbound.create({
      hospitalTenantId: args.formLink.hospitalTenantId,
      patientId: args.patient.id,
      formLinkId: args.formLink.id,
      channel: args.channel,
      messageType,
      title: args.formLink.title,
      content,
      linkUrl: args.linkUrl,
      recipient,
      createdBy: args.createdBy ?? undefined,
      initialStatus: args.channel === 'MANUAL_COPY' ? 'PENDING' : 'PENDING',
    });

    const dispatched = await this.outbound.dispatch(message.id, {
      openId: args.channel === 'WECHAT_OFFICIAL_ACCOUNT' ? recipient : null,
      phone: args.channel === 'SMS' ? recipient : null,
    });

    await this.prisma.engagementEventLog.create({
      data: {
        patientId: args.patient.id,
        formLinkId: args.formLink.id,
        eventType: dispatched?.status === 'SENT' ? 'MESSAGE_SENT' : 'MESSAGE_FAILED',
        metadata: {
          channel: args.channel,
          messageType,
          providerMessageId: dispatched?.providerMessageId ?? null,
          errorMessage: dispatched?.errorMessage ?? null,
          hospitalTenantId: args.formLink.hospitalTenantId,
        } as any,
      },
    });

    // v2.1 (Problem 5): if 本院微信 send failed but the patient has a phone
    // on file, automatically create a second SMS message and try that. The
    // original WeChat row stays FAILED for audit; the SMS row is the "live"
    // delivery attempt and is what we return.
    if (
      args.channel === 'WECHAT_OFFICIAL_ACCOUNT' &&
      dispatched?.status === 'FAILED' &&
      args.patient.phone
    ) {
      const fallbackMsg = await this.outbound.create({
        hospitalTenantId: args.formLink.hospitalTenantId,
        patientId: args.patient.id,
        formLinkId: args.formLink.id,
        channel: 'SMS',
        messageType,
        title: args.formLink.title,
        content,
        linkUrl: args.linkUrl,
        recipient: args.patient.phone,
        createdBy: args.createdBy ?? undefined,
        initialStatus: 'PENDING',
      });
      const fallbackDispatched = await this.outbound.dispatch(fallbackMsg.id, {
        openId: null,
        phone: args.patient.phone,
      });
      await this.prisma.engagementEventLog.create({
        data: {
          patientId: args.patient.id,
          formLinkId: args.formLink.id,
          eventType: 'MESSAGE_FALLBACK_SMS',
          metadata: {
            primaryMessageId: message.id,
            primaryChannel: 'WECHAT_OFFICIAL_ACCOUNT',
            fallbackMessageId: fallbackMsg.id,
            fallbackChannel: 'SMS',
            fallbackStatus: fallbackDispatched?.status,
            fallbackError: fallbackDispatched?.errorMessage ?? null,
            hospitalTenantId: args.formLink.hospitalTenantId,
          } as any,
        },
      });
      return {
        message: fallbackDispatched,
        primary: dispatched,
        fallbackUsed: true,
      };
    }

    return { message: dispatched };
  }

  // ---------------------------------------------------------------------------
  // markClicked / markSubmitted (called from public-form controller)
  // ---------------------------------------------------------------------------

  async markClicked(formLinkId: string, ctx?: { ipAddress?: string; userAgent?: string }) {
    await this.outbound.markClicked(formLinkId);
    await this.prisma.engagementEventLog.create({
      data: {
        formLinkId,
        eventType: 'LINK_OPENED',
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      },
    });
  }

  async markSubmitted(formLinkId: string, ctx?: { ipAddress?: string; userAgent?: string; metadata?: Record<string, unknown> }) {
    await this.outbound.markSubmitted(formLinkId);
    await this.prisma.engagementEventLog.create({
      data: {
        formLinkId,
        eventType: 'FORM_SUBMITTED',
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: (ctx?.metadata as any) ?? undefined,
      },
    });
  }
}


