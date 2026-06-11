import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FormLinkService } from '../patient-engagement/form-link.service';
import { OutboundMessageService } from '../patient-engagement/outbound-message.service';
import { WechatOfficialAccountService } from '../patient-engagement/wechat-official-account.service';
import { HospitalWechatOfficialAccountService } from '../patient-engagement/hospital-wechat-account.service';

/**
 * CareReminderResendService (v3.1)
 * --------------------------------
 * Re-sends a reminder for an occurrence that was already SENT/CLICKED but the
 * patient hasn't completed yet. Spec rules:
 *
 *   - Only ADMIN/DOCTOR/NURSE (MANAGER is read-only) — enforced by the caller
 *     via PatientEngagementTenantService.assertWriteAllowed + tenant checks.
 *   - Only occurrence.status in open dispatch / clicked / manual-action states AND completedAt == null.
 *   - If the original PatientFormLink is still usable (ACTIVE, not expired, not
 *     revoked, not used) → reuse its linkUrl (recovered from the most recent
 *     PatientOutboundMessage on that link).
 *   - Otherwise mint a fresh PatientFormLink (type derived from occurrenceType)
 *     and re-point the occurrence's formLinkId at it so later H5 completion still
 *     maps back to the occurrence.
 *   - EVERY resend creates a new PatientOutboundMessage (audit trail / history).
 *   - The occurrence remains in its authoritative delivery state; we bump resendCount + lastResentAt.
 *
 * Channel resolution mirrors the worker's dispatchOne(): WeChat official account
 * first (if patient has a verified openId for this tenant's appId and the tenant
 * can send), else SMS (if phone), else MANUAL_COPY.
 */
@Injectable()
export class CareReminderResendService {
  private readonly logger = new Logger('CareReminderResend');

  constructor(
    private readonly prisma: PrismaService,
    private readonly formLink: FormLinkService,
    private readonly outbound: OutboundMessageService,
    private readonly wechat: WechatOfficialAccountService,
    private readonly accounts: HospitalWechatOfficialAccountService,
  ) {}

  async resend(occurrenceId: string): Promise<{
    occurrence: any;
    message: any;
    formLink: any;
    reusedLink: boolean;
  }> {
    const occ = await this.prisma.careReminderOccurrence.findUnique({
      where: { id: occurrenceId },
      include: {
        schedule: true,
        patient: {
          include: { wechatIdentities: { take: 5, orderBy: { createdAt: 'desc' } } },
        },
      },
    });
    if (!occ) {
      throw new BadRequestException(`occurrence ${occurrenceId} not found`);
    }

    // ---- guard: state machine ----------------------------------------------
    if (occ.completedAt) {
      throw new BadRequestException({
        code: 'OCCURRENCE_ALREADY_COMPLETED',
        message: '该提醒已完成，无需再次发送。',
      });
    }
    if (!['SENT', 'DISPATCH_ACCEPTED', 'DELIVERED', 'CLICKED', 'MANUAL_ACTION_REQUIRED'].includes(occ.status)) {
      throw new BadRequestException({
        code: 'OCCURRENCE_NOT_RESENDABLE',
        message: `当前状态为 ${occ.status}，只有开放且未完成的提醒才能再次发送。`,
      });
    }

    const tenantId: string = occ.hospitalTenantId;
    const patient = occ.patient;
    const schedule = occ.schedule;
    if (occ.availableUntil.getTime() <= Date.now()) {
      throw new BadRequestException({ code: 'OCCURRENCE_WINDOW_ENDED', message: '本次提醒填写窗口已结束，请创建新的随访任务。' });
    }

    // ---- decide: reuse original link, or mint a new one ----------------------
    let reusedLink = false;
    let formLink: any = null;
    let linkUrl: string | null = null;

    if (occ.formLinkId) {
      const existing = await this.prisma.patientFormLink.findUnique({
        where: { id: occ.formLinkId },
      });
      if (existing && this.isLinkReusable(existing)) {
        // We can't recompute the plaintext token (only the hash is stored), so
        // recover the previously-sent linkUrl from outbound history.
        const lastMsg = await this.prisma.patientOutboundMessage.findFirst({
          where: { formLinkId: existing.id, linkUrl: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { linkUrl: true },
        });
        if (lastMsg?.linkUrl) {
          formLink = existing;
          linkUrl = lastMsg.linkUrl;
          reusedLink = true;
        }
      }
    }

    if (!formLink || !linkUrl) {
      const created = await this.formLink.create({
        hospitalTenantId: tenantId,
        patientId: occ.patientId,
        type: this.occurrenceTypeToFormLinkType(occ.occurrenceType),
        title: occ.title,
        description: schedule?.description ?? occ.title,
        payload: {
          careReminderOccurrenceId: occ.id,
          scheduleId: occ.scheduleId,
          sourceType: schedule?.sourceType,
          sourceId: schedule?.sourceId,
          ...((schedule?.payload as any) || {}),
        } as any,
        expiresAt: occ.availableUntil,
        createdBy: null,
      });
      formLink = created.formLink;
      linkUrl = created.linkUrl;
      reusedLink = false;

      // Re-point the occurrence at the new link so H5 completion (which matches
      // on formLinkId) still closes this occurrence.
      await this.prisma.careReminderOccurrence.update({
        where: { id: occ.id },
        data: { formLinkId: formLink.id },
      });
    }

    // ---- resolve channel (same rules as the worker) --------------------------
    const account = await this.accounts.getAccountForTenant(tenantId);
    const scopedOpenId = (() => {
      if (!account) return null;
      const match = (patient.wechatIdentities || []).find(
        (i: any) =>
          i.hospitalTenantId === tenantId && i.appId === account.appId && i.isVerified,
      );
      return match?.openId ?? null;
    })();
    const canWechat = await this.wechat.tenantCanReceiveWechat(tenantId);

    const channel: 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS' | 'MANUAL_COPY' =
      scopedOpenId && canWechat
        ? 'WECHAT_OFFICIAL_ACCOUNT'
        : patient.phone
          ? 'SMS'
          : 'MANUAL_COPY';
    const recipient =
      channel === 'WECHAT_OFFICIAL_ACCOUNT'
        ? scopedOpenId
        : channel === 'SMS'
          ? patient.phone
          : null;

    const messageType = this.occurrenceTypeToMessageType(occ.occurrenceType);
    const content = `${schedule?.description || occ.title}\n（再次提醒）请点击下方链接完成本次任务: ${linkUrl}`;

    // ---- v3.2: reuse the canonical message; append attempts (no new message) -
    // The occurrence keeps ONE PatientOutboundMessage (occ.outboundMessageId).
    // First send created it; nurse resend reuses it and appends attempts.
    let canonical = occ.outboundMessageId
      ? await this.prisma.patientOutboundMessage.findUnique({ where: { id: occ.outboundMessageId } })
      : null;
    if (!canonical) {
      canonical = await this.outbound.create({
        hospitalTenantId: tenantId,
        patientId: occ.patientId,
        formLinkId: formLink.id,
        channel,
        messageType,
        title: occ.title,
        content,
        linkUrl,
        recipient,
        createdBy: null,
        initialStatus: 'PENDING',
      });
    } else if (canonical.formLinkId !== formLink.id) {
      // Re-point the message at the (possibly new) link.
      canonical = await this.prisma.patientOutboundMessage.update({
        where: { id: canonical.id },
        data: { formLinkId: formLink.id, linkUrl },
      });
    }

    let dispatchedMessage = canonical;
    if (channel === 'MANUAL_COPY' && canonical.status !== 'MANUAL_ACTION_REQUIRED') {
      dispatchedMessage = await this.prisma.patientOutboundMessage.update({
        where: { id: canonical.id },
        data: { status: 'MANUAL_ACTION_REQUIRED', errorMessage: null },
      });
    }
    if (channel !== 'MANUAL_COPY') {
      const primary = await this.outbound.attemptDispatch({
        messageId: canonical.id,
        channel: channel as 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS',
        openId: channel === 'WECHAT_OFFICIAL_ACCOUNT' ? recipient : null,
        phone: channel === 'SMS' ? recipient : null,
        triggerReason: 'NURSE_RESEND',
        triggeredBy: null,
      });
      if (
        channel === 'WECHAT_OFFICIAL_ACCOUNT' &&
        primary.dispatched?.status === 'FAILED' &&
        patient.phone
      ) {
        const fb = await this.outbound.attemptDispatch({
          messageId: canonical.id,
          channel: 'SMS',
          phone: patient.phone,
          triggerReason: 'AUTO_FALLBACK',
          triggeredBy: null,
        });
        dispatchedMessage = fb.message ?? canonical;
      } else {
        dispatchedMessage = primary.message ?? canonical;
      }
    }

    // ---- bump resend bookkeeping; preserve authoritative delivery state --------
    const updatedOccurrence = await this.prisma.careReminderOccurrence.update({
      where: { id: occ.id },
      data: {
        status: channel === 'MANUAL_COPY'
          ? 'MANUAL_ACTION_REQUIRED'
          : ['SENT', 'DISPATCH_ACCEPTED', 'DELIVERED'].includes(dispatchedMessage?.status ?? '')
            ? 'DISPATCH_ACCEPTED'
            : 'FAILED',
        sentAt: channel === 'MANUAL_COPY' ? undefined : new Date(),
        outboundMessageId: dispatchedMessage?.id ?? canonical.id,
        resendCount: { increment: 1 },
        lastResentAt: new Date(),
        lastError: null,
      },
      include: { schedule: true },
    });

    return {
      occurrence: updatedOccurrence,
      message: dispatchedMessage,
      formLink,
      reusedLink,
    };
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  private isLinkReusable(link: {
    status: string;
    expiresAt: Date | null;
    revokedAt: Date | null;
    submitCount: number;
    maxSubmit: number;
  }): boolean {
    if (link.status !== 'ACTIVE') return false;
    if (link.revokedAt) return false;
    if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return false;
    if (link.submitCount >= link.maxSubmit) return false;
    return true;
  }

  private occurrenceTypeToFormLinkType(t: string): string {
    switch (t) {
      case 'MEDICATION_CHECKIN':
        return 'MEDICATION_CHECKIN';
      case 'VITAL_RECHECK':
        return 'VITAL_RECHECK';
      case 'QUESTIONNAIRE':
        return 'QUESTIONNAIRE';
      case 'GENERAL_MESSAGE':
        return 'GENERAL_MESSAGE';
      default:
        return 'GENERIC_NOTICE';
    }
  }

  private occurrenceTypeToMessageType(t: string): string {
    switch (t) {
      case 'MEDICATION_CHECKIN':
        return 'MEDICATION_REMINDER';
      case 'VITAL_RECHECK':
        return 'VITAL_RECHECK_REMINDER';
      case 'QUESTIONNAIRE':
        return 'QUESTIONNAIRE_REMINDER';
      case 'GENERAL_MESSAGE':
        return 'QUESTIONNAIRE_REMINDER';
      default:
        return 'QUESTIONNAIRE_REMINDER';
    }
  }
}
