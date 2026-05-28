import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FormLinkService } from '../patient-engagement/form-link.service';
import { OutboundMessageService } from '../patient-engagement/outbound-message.service';
import { WechatOfficialAccountService } from '../patient-engagement/wechat-official-account.service';
import { HospitalWechatOfficialAccountService } from '../patient-engagement/hospital-wechat-account.service';

export type DirectMessagePriority = 'NORMAL' | 'IMPORTANT' | 'URGENT';
export type DirectMessageChannel = 'AUTO' | 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS' | 'MANUAL_COPY';

export type CreateDirectMessageInput = {
  hospitalTenantId: string;
  patientId: string;
  senderId: string;
  title: string;
  content: string;
  priority?: DirectMessagePriority;
  preferredChannel?: DirectMessageChannel;
  requiresAck?: boolean;
};

/**
 * PatientDirectMessageService
 * ----------------------------
 * Nurse → patient ad-hoc message. Architecturally a thin "intent" record on
 * top of the existing PatientFormLink + PatientOutboundMessage plumbing:
 *
 *   PatientDirectMessage   ← semantic envelope (sender, priority, ack)
 *     └─ PatientFormLink (type=GENERAL_MESSAGE)   ← H5 deliverable
 *          └─ PatientOutboundMessage             ← actual dispatch
 *
 * If requiresAck=true the H5 shows a 我已知晓 button; submission flips
 * PatientDirectMessage.status = ACKNOWLEDGED + sets acknowledgedAt.
 *
 * If requiresAck=false the H5 still opens (and marks CLICKED for audit),
 * but no submit action is required.
 */
@Injectable()
export class PatientDirectMessageService {
  private readonly logger = new Logger('PatientDirectMessage');

  constructor(
    private readonly prisma: PrismaService,
    private readonly formLink: FormLinkService,
    private readonly outbound: OutboundMessageService,
    private readonly wechat: WechatOfficialAccountService,
    private readonly accounts: HospitalWechatOfficialAccountService,
  ) {}

  async create(input: CreateDirectMessageInput) {
    if (!input.title || !input.content) {
      throw new BadRequestException('title and content are required');
    }

    const patient = await this.prisma.patient.findUnique({
      where: { id: input.patientId },
      include: {
        wechatIdentities: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!patient) throw new NotFoundException('patient not found');
    if (patient.hospitalTenantId !== input.hospitalTenantId) {
      throw new NotFoundException('patient does not belong to that tenant');
    }

    const priority = input.priority ?? 'NORMAL';
    const requiresAck = input.requiresAck ?? false;
    // 12 hours for NORMAL/IMPORTANT, 1 hour for URGENT.
    const expiresInHours = priority === 'URGENT' ? 1 : 12;

    // Step 1: create the form link (GENERAL_MESSAGE).
    const { formLink, token, linkUrl } = await this.formLink.create({
      hospitalTenantId: patient.hospitalTenantId,
      patientId: patient.id,
      type: 'GENERAL_MESSAGE',
      title: input.title,
      description: input.content,
      payload: {
        priority,
        requiresAck,
        senderId: input.senderId,
        contentPreview: input.content.slice(0, 200),
      },
      expiresInHours,
      maxSubmit: 1,
      requiresIdentityCheck: false,
      createdBy: input.senderId,
    });

    // Step 2: resolve channel.
    const account = await this.accounts.getAccountForTenant(input.hospitalTenantId);
    const scopedOpenId = (() => {
      if (!account) return null;
      const match = patient.wechatIdentities.find(
        (i) =>
          i.hospitalTenantId === input.hospitalTenantId &&
          i.appId === account.appId &&
          i.isVerified,
      );
      return match?.openId ?? null;
    })();
    const tenantCanWechat = await this.wechat.tenantCanReceiveWechat(input.hospitalTenantId);

    let channel: 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS' | 'MANUAL_COPY';
    if (input.preferredChannel && input.preferredChannel !== 'AUTO') {
      channel = input.preferredChannel;
    } else if (scopedOpenId && tenantCanWechat) {
      channel = 'WECHAT_OFFICIAL_ACCOUNT';
    } else if (patient.phone) {
      channel = 'SMS';
    } else {
      channel = 'MANUAL_COPY';
    }

    // Step 3: create the direct message row first so we can attach formLinkId.
    const directMsg = await this.prisma.patientDirectMessage.create({
      data: {
        hospitalTenantId: input.hospitalTenantId,
        patientId: input.patientId,
        senderId: input.senderId,
        title: input.title,
        content: input.content,
        priority,
        channel,
        formLinkId: formLink.id,
        requiresAck,
        status: 'PENDING',
      },
    });

    // Step 4: dispatch (or stage for MANUAL_COPY).
    const recipient =
      channel === 'WECHAT_OFFICIAL_ACCOUNT' ? scopedOpenId :
      channel === 'SMS' ? patient.phone :
      null;

    const outboundMessage = await this.outbound.create({
      hospitalTenantId: input.hospitalTenantId,
      patientId: patient.id,
      formLinkId: formLink.id,
      channel,
      messageType: 'QUESTIONNAIRE_REMINDER', // reuse existing template slot for GENERAL_MESSAGE
      title: input.title,
      content: `${input.content}\n${linkUrl}`,
      linkUrl,
      recipient,
      createdBy: input.senderId,
      initialStatus: 'PENDING',
    });

    if (channel !== 'MANUAL_COPY') {
      await this.outbound.dispatch(outboundMessage.id, {
        openId: channel === 'WECHAT_OFFICIAL_ACCOUNT' ? recipient : null,
        phone: channel === 'SMS' ? recipient : null,
      });
    }

    // Refresh the outbound message status and attach to direct message.
    const refreshed = await this.prisma.patientOutboundMessage.findUnique({
      where: { id: outboundMessage.id },
    });
    const updatedDirect = await this.prisma.patientDirectMessage.update({
      where: { id: directMsg.id },
      data: {
        outboundMessageId: outboundMessage.id,
        status:
          refreshed?.status === 'SENT' ? 'SENT' :
          refreshed?.status === 'FAILED' ? 'FAILED' :
          'PENDING',
      },
    });

    return {
      directMessage: updatedDirect,
      formLink,
      token,
      linkUrl,
      outboundMessage: refreshed,
    };
  }

  async listForPatient(patientId: string) {
    return this.prisma.patientDirectMessage.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { sender: { select: { id: true, username: true, displayName: true, role: true } } },
    });
  }

  /**
   * Called by PublicFormController when a GENERAL_MESSAGE form is submitted
   * (i.e. the patient tapped 我已知晓 on a requiresAck=true message).
   * Returns the direct message id if any, else null.
   */
  async acknowledgeByFormLinkId(formLinkId: string): Promise<string | null> {
    const directMsg = await this.prisma.patientDirectMessage.findFirst({
      where: { formLinkId, status: { not: 'ACKNOWLEDGED' } },
      select: { id: true, requiresAck: true },
    });
    if (!directMsg) return null;
    await this.prisma.patientDirectMessage.update({
      where: { id: directMsg.id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
      },
    });
    return directMsg.id;
  }

  /** Soft mark CLICKED when the H5 is opened (no submit action needed). */
  async markClickedByFormLinkId(formLinkId: string): Promise<void> {
    await this.prisma.patientDirectMessage.updateMany({
      where: { formLinkId, status: 'SENT' },
      data: { status: 'CLICKED' },
    });
  }
}
