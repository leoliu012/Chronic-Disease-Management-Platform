import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from './sms.service';
import { WechatOfficialAccountService } from './wechat-official-account.service';

export type Channel = 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS' | 'MANUAL_COPY';

export type CreateOutboundMessageInput = {
  hospitalTenantId: string;
  patientId: string;
  formLinkId?: string | null;
  channel: Channel;
  messageType: string;
  title: string;
  content: string;
  linkUrl?: string | null;
  recipient?: string | null;
  templateId?: string | null;
  createdBy?: string | null;
  /** For MANUAL_COPY we usually keep status=PENDING (护士还没真发出去). */
  initialStatus?: 'PENDING' | 'SENT';
};

/**
 * OutboundMessageService (v2)
 * ---------------------------
 * 所有 outbound (本院服务号 / SMS / MANUAL_COPY) 写在 PatientOutboundMessage 流水里.
 * status: PENDING → SENT / FAILED → CLICKED → SUBMITTED.
 *
 * 关键变化:
 *   - hospitalTenantId 现在是 *required* (per-tenant 隔离)
 *   - dispatch 微信通道时, 透传 hospitalTenantId 给 WechatOfficialAccountService
 *   - 文案换成"本院服务号"
 *   - MANUAL_COPY 可指定 initialStatus, 默认 PENDING (Bug 3 要求保留 history)
 */
@Injectable()
export class OutboundMessageService {
  private readonly logger = new Logger('OutboundMessage');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly wechat: WechatOfficialAccountService,
  ) {}

  private maskPhone(value?: string | null): string | null {
    if (!value) return null;
    return value.replace(/(\d{3})\d+(\d{4})/, '$1****$2');
  }

  private maskOpenId(value?: string | null): string | null {
    if (!value) return null;
    if (value.length <= 8) return value;
    return value.slice(0, 4) + '****' + value.slice(-4);
  }

  private hashRecipient(value?: string | null): string | null {
    if (!value) return null;
    const salt = process.env.PATIENT_ENGAGEMENT_SECRET_KEY || process.env.PATIENT_FORM_TOKEN_SECRET || 'dev_change_me';
    return crypto.createHmac('sha256', salt).update(String(value)).digest('hex');
  }

  async create(input: CreateOutboundMessageInput) {
    return this.prisma.patientOutboundMessage.create({
      data: {
        hospitalTenantId: input.hospitalTenantId,
        patientId: input.patientId,
        formLinkId: input.formLinkId ?? undefined,
        channel: input.channel,
        messageType: input.messageType,
        title: input.title,
        content: input.content,
        linkUrl: input.linkUrl ?? undefined,
        templateId: input.templateId ?? undefined,
        recipientMasked:
          input.channel === 'WECHAT_OFFICIAL_ACCOUNT'
            ? this.maskOpenId(input.recipient)
            : this.maskPhone(input.recipient),
        recipientRawHash: this.hashRecipient(input.recipient),
        status: input.initialStatus ?? 'PENDING',
        createdBy: input.createdBy ?? undefined,
      },
    });
  }

  async markSent(messageId: string, providerMessageId?: string | null, templateId?: string | null) {
    return this.prisma.patientOutboundMessage.update({
      where: { id: messageId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        providerMessageId: providerMessageId ?? undefined,
        templateId: templateId ?? undefined,
      },
    });
  }

  async markFailed(messageId: string, errorMessage: string) {
    return this.prisma.patientOutboundMessage.update({
      where: { id: messageId },
      data: {
        status: 'FAILED',
        errorMessage: errorMessage.slice(0, 500),
      },
    });
  }

  async markClicked(formLinkId: string) {
    return this.prisma.patientOutboundMessage.updateMany({
      where: { formLinkId, status: { in: ['SENT', 'PENDING'] } },
      data: { status: 'CLICKED', clickedAt: new Date() },
    });
  }

  async markSubmitted(formLinkId: string) {
    return this.prisma.patientOutboundMessage.updateMany({
      where: { formLinkId, status: { in: ['SENT', 'PENDING', 'CLICKED'] } },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
  }


  // ---------------------------------------------------------------------------
  // v3.2: delivery attempts
  // ---------------------------------------------------------------------------
  // PatientOutboundMessage is the canonical "case". Every real send (initial,
  // auto SMS fallback, nurse resend) is a PatientOutboundAttempt row under it.
  // recomputeDelivery() rolls the attempts up into message.status +
  // deliverySummary so the list UI can show "本院服务号 + 短信" and per-channel
  // warnings without N+1 queries.

  async recordAttempt(input: {
    messageId: string;
    hospitalTenantId: string;
    patientId: string;
    formLinkId?: string | null;
    channel: 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS';
    status: 'SENT' | 'FAILED';
    recipientMasked?: string | null;
    providerMessageId?: string | null;
    errorMessage?: string | null;
    triggerReason?: 'INITIAL' | 'AUTO_FALLBACK' | 'NURSE_RESEND' | string | null;
    triggeredBy?: string | null;
  }) {
    const prior = await this.prisma.patientOutboundAttempt.count({
      where: { messageId: input.messageId },
    });
    return this.prisma.patientOutboundAttempt.create({
      data: {
        messageId: input.messageId,
        hospitalTenantId: input.hospitalTenantId,
        patientId: input.patientId,
        formLinkId: input.formLinkId ?? undefined,
        channel: input.channel,
        status: input.status,
        recipientMasked: input.recipientMasked ?? undefined,
        providerMessageId: input.providerMessageId ?? undefined,
        errorMessage: input.errorMessage ? input.errorMessage.slice(0, 500) : undefined,
        attemptNo: prior + 1,
        triggerReason: input.triggerReason ?? undefined,
        triggeredBy: input.triggeredBy ?? undefined,
        sentAt: input.status === 'SENT' ? new Date() : undefined,
      },
    });
  }

  /**
   * Roll attempts up into the parent message. Preserves terminal states the
   * patient drives (CLICKED / SUBMITTED / CANCELED) — those are NOT downgraded
   * by a later send attempt.
   */
  async recomputeDelivery(messageId: string) {
    const message = await this.prisma.patientOutboundMessage.findUnique({
      where: { id: messageId },
    });
    if (!message) return null;

    const attempts = await this.prisma.patientOutboundAttempt.findMany({
      where: { messageId },
      orderBy: { createdAt: 'asc' },
    });

    // latest status per channel
    const perChannel: Record<string, string> = {};
    for (const a of attempts) perChannel[a.channel] = a.status;
    const channels = Object.keys(perChannel);
    const anySent = Object.values(perChannel).includes('SENT');

    const lastAttempt = attempts[attempts.length - 1] || null;
    const deliverySummary: any = {
      channels,
      wechat: perChannel['WECHAT_OFFICIAL_ACCOUNT'] ?? null,
      sms: perChannel['SMS'] ?? null,
      attemptCount: attempts.length,
    };

    // Don't clobber patient-driven terminal states.
    const protectedStatuses = ['CLICKED', 'SUBMITTED', 'CANCELED'];
    let nextStatus = message.status;
    if (!protectedStatuses.includes(message.status)) {
      if (attempts.length === 0) nextStatus = message.status;
      else nextStatus = anySent ? 'SENT' : 'FAILED';
    }

    const lastSent = [...attempts].reverse().find((a) => a.status === 'SENT');

    return this.prisma.patientOutboundMessage.update({
      where: { id: messageId },
      data: {
        status: nextStatus,
        deliverySummary,
        lastAttemptAt: lastAttempt?.createdAt ?? undefined,
        // keep the freshest successful channel + providerMessageId on the message
        ...(lastSent
          ? { channel: lastSent.channel, providerMessageId: lastSent.providerMessageId ?? undefined, sentAt: lastSent.sentAt ?? new Date(), errorMessage: null }
          : lastAttempt
            ? { channel: lastAttempt.channel, errorMessage: lastAttempt.errorMessage ?? undefined }
            : {}),
      },
    });
  }

  /**
   * Canonical "send one channel under an existing message" primitive:
   * dispatch through the adapter, write a PatientOutboundAttempt, then
   * recompute the parent message. Returns { attempt, dispatched }.
   */
  async attemptDispatch(args: {
    messageId: string;
    channel: 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS';
    openId?: string | null;
    phone?: string | null;
    triggerReason?: 'INITIAL' | 'AUTO_FALLBACK' | 'NURSE_RESEND' | string | null;
    triggeredBy?: string | null;
  }) {
    const message = await this.prisma.patientOutboundMessage.findUnique({
      where: { id: args.messageId },
    });
    if (!message) return { attempt: null, dispatched: null };

    // Reuse the per-adapter logic in dispatch() by temporarily aligning the
    // message channel, then dispatching. dispatch() updates message.status, but
    // recomputeDelivery() below re-derives the authoritative status from attempts.
    if (message.channel !== args.channel) {
      await this.prisma.patientOutboundMessage.update({
        where: { id: args.messageId },
        data: { channel: args.channel },
      });
    }
    const dispatched = await this.dispatch(args.messageId, {
      openId: args.channel === 'WECHAT_OFFICIAL_ACCOUNT' ? args.openId ?? null : null,
      phone: args.channel === 'SMS' ? args.phone ?? null : null,
    });

    const recipientMasked =
      args.channel === 'WECHAT_OFFICIAL_ACCOUNT'
        ? this.maskOpenId(args.openId)
        : this.maskPhone(args.phone);

    const attempt = await this.recordAttempt({
      messageId: args.messageId,
      hospitalTenantId: message.hospitalTenantId,
      patientId: message.patientId,
      formLinkId: message.formLinkId,
      channel: args.channel,
      status: dispatched?.status === 'SENT' ? 'SENT' : 'FAILED',
      recipientMasked,
      providerMessageId: dispatched?.providerMessageId ?? null,
      errorMessage: dispatched?.status === 'SENT' ? null : dispatched?.errorMessage ?? '发送失败',
      triggerReason: args.triggerReason ?? 'INITIAL',
      triggeredBy: args.triggeredBy ?? null,
    });

    const refreshed = await this.recomputeDelivery(args.messageId);
    return { attempt, dispatched, message: refreshed };
  }

  /**
   * Actually send a previously-created message through the right adapter.
   *
   * MANUAL_COPY: stays at its initial status (PENDING by default) — nothing
   * is dispatched. Callers can later POST /messages/:id/mark-manual-sent.
   */
  async dispatch(
    messageId: string,
    options: { openId?: string | null; phone?: string | null },
  ) {
    const message = await this.prisma.patientOutboundMessage.findUnique({
      where: { id: messageId },
    });
    if (!message) return null;

    if (message.channel === 'MANUAL_COPY') {
      // Don't auto-mark SENT — Bug 3: 我们想让 history 看到这条 PENDING 链接,
      // 护士手动复制 / 标记后再 update.
      this.logger.log(
        `[manual-copy] tenant=${message.hospitalTenantId ?? '-'} message=${message.id} kept at status=${message.status}`,
      );
      return message;
    }

    if (message.channel === 'WECHAT_OFFICIAL_ACCOUNT') {
      if (!options.openId) {
        return this.markFailed(messageId, '患者未关联本院服务号 (无 openId)');
      }
      if (!message.hospitalTenantId) {
        return this.markFailed(messageId, '消息缺少 hospitalTenantId, 无法走本院服务号');
      }
      const result = await this.wechat.sendTemplateMessage({
        hospitalTenantId: message.hospitalTenantId,
        patientId: message.patientId,
        openId: options.openId,
        messageType: message.messageType,
        title: message.title,
        content: message.content,
        linkUrl: message.linkUrl ?? '',
        formLinkId: message.formLinkId ?? undefined,
      });
      if (result.ok) {
        return this.markSent(messageId, result.providerMessageId, result.templateId);
      }
      return this.markFailed(messageId, result.errorMessage || '本院服务号发送失败');
    }

    if (message.channel === 'SMS') {
      if (!options.phone) {
        return this.markFailed(messageId, '患者档案缺少手机号');
      }
      const smsBody = `${message.title}\n${message.content}\n${message.linkUrl || ''}`.trim();
      const result = await this.sms.send({
        hospitalTenantId: message.hospitalTenantId ?? undefined,
        phone: options.phone,
        content: smsBody,
      });
      if (result.success) return this.markSent(messageId, result.providerMessageId);
      return this.markFailed(messageId, result.errorMessage || '短信发送失败');
    }

    return this.markFailed(messageId, `未知触达通道: ${message.channel}`);
  }
}
