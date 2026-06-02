#!/usr/bin/env python3
"""
apply_patient_engagement_v3_2_backend.py
-----------------------------------------
Idempotent backend patcher for Patient Engagement v3.2.

Canonical model going forward:
  - PatientOutboundMessage  = one patient-facing case / form / link.
  - PatientOutboundAttempt  = one delivery attempt (WeChat or SMS) under a message.
  - Resend NEVER creates a new PatientOutboundMessage; it appends an attempt.
  - WeChat-failure + SMS-fallback are two attempts on the SAME message.

Files touched:
  1. outbound-message.service.ts
       + recordAttempt() / recomputeDelivery() / attemptDispatch()
  2. patient-engagement.service.ts
       ~ sendForLink(): single message + attempts (initial + auto-fallback),
         no second fallback message row.
  3. admin-patient-engagement.controller.ts
       ~ listMessages(): pagination {items,total,page,pageSize} + formLink include
       ~ resendMessage(): reuse message, append NURSE_RESEND attempt, friendly errors
       ~ revokeLink(): also set message.status=CANCELED + LINK_REVOKED event
       + GET messages/:id/detail (message, formLink, attempts, submission)
  4. public-form.controller.ts
       ~ each submit handler writes formLink.submissionType/submissionId/submittedAt
       ~ hospital-visit-confirm also writes a HospitalVisitFeedback row
       ~ GET :token returns revokeReason (for friendly REVOKED page)
  5. care-reminder-resend.service.ts (v3.1)
       ~ reuse occurrence.outboundMessageId; append attempts; never new message
  6. care-reminder-worker.service.ts
       ~ first dispatch records an INITIAL attempt on the canonical message

Run from repo root:
  python3 scripts/apply_patient_engagement_v3_2_backend.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path.cwd()
OMS = ROOT / "apps/api/src/patient-engagement/outbound-message.service.ts"
PES = ROOT / "apps/api/src/patient-engagement/patient-engagement.service.ts"
ADMIN = ROOT / "apps/api/src/patient-engagement/admin-patient-engagement.controller.ts"
PFC = ROOT / "apps/api/src/patient-engagement/public-form.controller.ts"
CRR = ROOT / "apps/api/src/care-reminders/care-reminder-resend.service.ts"
CRW = ROOT / "apps/api/src/care-reminders/care-reminder-worker.service.ts"
PE_DTO = ROOT / "apps/api/src/patient-engagement/dto/send-engagement-message.dto.ts"

changed_files: list[str] = []


def fail(msg: str) -> None:
    print(f"[err] {msg}", file=sys.stderr)
    sys.exit(1)


def need(path: Path) -> str:
    if not path.exists():
        fail(f"missing {path} (run from repo root)")
    return path.read_text(encoding="utf-8")


def replace_once(src: str, old: str, new: str, label: str) -> str:
    if old not in src:
        fail(f"anchor not found while patching {label}")
    if src.count(old) != 1:
        fail(f"anchor not unique ({src.count(old)}x) while patching {label}")
    return src.replace(old, new, 1)


# ---------------------------------------------------------------------------
# 1) outbound-message.service.ts — attempt recording + aggregate + attemptDispatch
# ---------------------------------------------------------------------------
OMS_METHODS = """
  // ---------------------------------------------------------------------------
  // v3.2: delivery attempts
  // ---------------------------------------------------------------------------
  // PatientOutboundMessage is the canonical \"case\". Every real send (initial,
  // auto SMS fallback, nurse resend) is a PatientOutboundAttempt row under it.
  // recomputeDelivery() rolls the attempts up into message.status +
  // deliverySummary so the list UI can show \"本院服务号 + 短信\" and per-channel
  // warnings without N+1 queries.

  async recordAttempt(input: {
    messageId: string;
    hospitalTenantId?: string | null;
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
        hospitalTenantId: input.hospitalTenantId ?? undefined,
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
   * Canonical \"send one channel under an existing message\" primitive:
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

"""


def patch_oms() -> None:
    src = need(OMS)
    if "async attemptDispatch(" in src:
        print("[skip] outbound-message.service.ts already has attempt methods")
        return
    anchor = (
        "  /**\n"
        "   * Actually send a previously-created message through the right adapter.\n"
    )
    src = replace_once(src, anchor, OMS_METHODS + anchor, "OMS attempt methods")
    OMS.write_text(src, encoding="utf-8")
    changed_files.append("outbound-message.service.ts")
    print("[ok] patched outbound-message.service.ts")


# ---------------------------------------------------------------------------
# 2) patient-engagement.service.ts — sendForLink: one message + attempts
# ---------------------------------------------------------------------------
def patch_pes() -> None:
    src = need(PES)
    if "triggerReason: 'AUTO_FALLBACK'" in src or "// v3.2 sendForLink" in src:
        print("[skip] patient-engagement.service.ts sendForLink already at v3.2")
        return

    old = """    const message = await this.outbound.create({
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
    // original WeChat row stays FAILED for audit; the SMS row is the \"live\"
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
  }"""

    new = """    // v3.2 sendForLink: ONE canonical PatientOutboundMessage; each real send is
    // a PatientOutboundAttempt under it. WeChat-fail + SMS-fallback are two
    // attempts on the same message, not two messages.
    const existingMessageId: string | undefined = (args as any).reuseMessageId;
    const triggerReason: string = (args as any).triggerReason || 'INITIAL';

    let message: any;
    if (existingMessageId) {
      message = await this.prisma.patientOutboundMessage.findUnique({ where: { id: existingMessageId } });
      if (!message) throw new BadRequestException('原始消息不存在, 无法重发');
    } else {
      message = await this.outbound.create({
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
        initialStatus: 'PENDING',
      });
    }

    // MANUAL_COPY: nothing is dispatched; the link just lives in history.
    if (args.channel === 'MANUAL_COPY') {
      const refreshed = await this.prisma.patientOutboundMessage.findUnique({ where: { id: message.id } });
      return { message: refreshed };
    }

    const primary = await this.outbound.attemptDispatch({
      messageId: message.id,
      channel: args.channel as 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS',
      openId: args.channel === 'WECHAT_OFFICIAL_ACCOUNT' ? recipient : null,
      phone: args.channel === 'SMS' ? recipient : null,
      triggerReason,
      triggeredBy: args.createdBy ?? null,
    });

    await this.prisma.engagementEventLog.create({
      data: {
        patientId: args.patient.id,
        formLinkId: args.formLink.id,
        eventType: primary.dispatched?.status === 'SENT' ? 'MESSAGE_SENT' : 'MESSAGE_FAILED',
        metadata: {
          channel: args.channel,
          messageType,
          messageId: message.id,
          triggerReason,
          providerMessageId: primary.dispatched?.providerMessageId ?? null,
          errorMessage: primary.dispatched?.errorMessage ?? null,
          hospitalTenantId: args.formLink.hospitalTenantId,
        } as any,
      },
    });

    // Auto SMS fallback on WeChat failure — a SECOND attempt on the SAME message.
    if (
      args.channel === 'WECHAT_OFFICIAL_ACCOUNT' &&
      primary.dispatched?.status === 'FAILED' &&
      args.patient.phone
    ) {
      const fallback = await this.outbound.attemptDispatch({
        messageId: message.id,
        channel: 'SMS',
        phone: args.patient.phone,
        triggerReason: 'AUTO_FALLBACK',
        triggeredBy: args.createdBy ?? null,
      });
      await this.prisma.engagementEventLog.create({
        data: {
          patientId: args.patient.id,
          formLinkId: args.formLink.id,
          eventType: 'MESSAGE_FALLBACK_SMS',
          metadata: {
            messageId: message.id,
            primaryChannel: 'WECHAT_OFFICIAL_ACCOUNT',
            fallbackChannel: 'SMS',
            fallbackStatus: fallback.dispatched?.status,
            fallbackError: fallback.dispatched?.errorMessage ?? null,
            hospitalTenantId: args.formLink.hospitalTenantId,
          } as any,
        },
      });
      return {
        message: fallback.message ?? fallback.dispatched,
        primary: primary.dispatched,
        fallbackUsed: true,
      };
    }

    return { message: primary.message ?? primary.dispatched };
  }"""

    src = replace_once(src, old, new, "PES sendForLink")
    PES.write_text(src, encoding="utf-8")
    changed_files.append("patient-engagement.service.ts")
    print("[ok] patched patient-engagement.service.ts")


def patch_admin() -> None:
    _patch_admin_impl()


def patch_pfc() -> None:
    _patch_pfc_impl()


def patch_crr() -> None:
    _patch_crr_impl()


def patch_crw() -> None:
    _patch_crw_impl()


# ---------------------------------------------------------------------------
# 3) admin-patient-engagement.controller.ts
# ---------------------------------------------------------------------------
def _patch_admin_impl() -> None:
    src = need(ADMIN)
    changed = False

    # 3a. listMessages → pagination {items,total,page,pageSize} + formLink include
    old_list = """    if (query.channel) where.channel = query.channel;
    if (query.status) where.status = query.status;
    if (query.messageType) where.messageType = query.messageType;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    return this.prisma.patientOutboundMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { patient: { select: { id: true, name: true, hospitalPatientId: true } } },
    });
  }"""
    new_list = """    if (query.channel) where.channel = query.channel;
    if (query.status) where.status = query.status;
    if (query.messageType) where.messageType = query.messageType;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) {
        // inclusive end-of-day if a bare date was supplied
        const to = new Date(query.to);
        if (/^\\d{4}-\\d{2}-\\d{2}$/.test(query.to)) to.setHours(23, 59, 59, 999);
        where.createdAt.lte = to;
      }
    }
    // v3.2: pagination
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const [total, items] = await this.prisma.$transaction([
      this.prisma.patientOutboundMessage.count({ where }),
      this.prisma.patientOutboundMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          patient: { select: { id: true, name: true, hospitalPatientId: true } },
          formLink: {
            select: { id: true, type: true, status: true, expiresAt: true, usedAt: true, revokedAt: true, revokeReason: true, submitCount: true, submittedAt: true },
          },
        },
      }),
    ]);
    return { items, total, page, pageSize };
  }

  // v3.2: full case detail — message + formLink + attempts timeline + patient submission
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MANAGER)
  @Get('messages/:id/detail')
  async messageDetail(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    await this.tenant.assertMessageVisibleToUser(id, user);
    const message = await this.prisma.patientOutboundMessage.findUnique({
      where: { id },
      include: { patient: { select: { id: true, name: true, hospitalPatientId: true } } },
    });
    if (!message) throw new NotFoundException('Message not found');
    const formLink = message.formLinkId
      ? await this.prisma.patientFormLink.findUnique({ where: { id: message.formLinkId } })
      : null;
    const attempts = await this.prisma.patientOutboundAttempt.findMany({
      where: { messageId: id },
      orderBy: { createdAt: 'asc' },
    });
    const submission = formLink ? await this.resolveSubmission(formLink) : null;
    return { message, formLink, attempts, submission };
  }

  /**
   * Resolve the patient's submitted content for a form link. Order:
   *   1) formLink.submissionType/submissionId (authoritative, v3.2)
   *   2) latest EngagementEventLog FORM_SUBMITTED metadata.resultId (legacy fallback)
   */
  private async resolveSubmission(formLink: any): Promise<any | null> {
    let type: string | null = formLink.submissionType ?? null;
    let id: string | null = formLink.submissionId ?? null;
    let inferred = false;

    if (!type || !id) {
      const ev = await this.prisma.engagementEventLog.findFirst({
        where: { formLinkId: formLink.id, eventType: { in: ['FORM_SUBMITTED'] } },
        orderBy: { createdAt: 'desc' },
      });
      const meta: any = ev?.metadata || {};
      if (meta.resultType && meta.resultId) {
        type = type || meta.resultType;
        id = id || meta.resultId;
        inferred = true;
      } else if (meta.followUpId) {
        type = type || 'FollowUpRecord';
        id = id || meta.followUpId;
        inferred = true;
      }
    }
    if (!type || !id) return null;

    const submittedAt = formLink.submittedAt ?? null;
    try {
      if (type === 'QuestionnaireResult') {
        const r = await this.prisma.questionnaireResult.findUnique({ where: { id } });
        if (!r) return null;
        return {
          type, inferred, submittedAt: submittedAt ?? r.createdAt,
          data: {
            questionnaireType: r.questionnaireType, score: r.score, riskLevel: r.riskLevel,
            riskConclusion: r.riskConclusion, answers: r.answers, note: r.note, createdAt: r.createdAt,
          },
        };
      }
      if (type === 'VitalRecord') {
        const r = await this.prisma.vitalRecord.findUnique({ where: { id } });
        if (!r) return null;
        return {
          type, inferred, submittedAt: submittedAt ?? r.measuredAt,
          data: { vitalType: r.type, value: r.value, unit: r.unit, measuredAt: r.measuredAt, isAbnormal: r.isAbnormal, note: r.note },
        };
      }
      if (type === 'MedicationCheckIn') {
        const r = await this.prisma.medicationCheckIn.findUnique({ where: { id }, include: { medication: true } });
        if (!r) return null;
        return {
          type, inferred, submittedAt: submittedAt ?? r.checkedAt,
          data: {
            medicationName: r.medication?.medicationName ?? null, dosage: r.medication?.dosage ?? null,
            taken: r.taken, checkedAt: r.checkedAt, scheduledAt: r.scheduledAt, note: r.note,
          },
        };
      }
      if (type === 'HospitalVisitFeedback') {
        const r = await this.prisma.hospitalVisitFeedback.findUnique({ where: { id } });
        if (!r) return null;
        return {
          type, inferred, submittedAt: submittedAt ?? r.submittedAt,
          data: { action: r.action, note: r.note, submittedAt: r.submittedAt, hospitalVisitReminderId: r.hospitalVisitReminderId, taskId: r.taskId, riskAlertId: r.riskAlertId },
        };
      }
      if (type === 'FollowUpRecord') {
        const r = await this.prisma.followUpRecord.findUnique({ where: { id } });
        if (!r) return null;
        return {
          type, inferred, submittedAt: submittedAt ?? r.followUpTime,
          data: { action: r.result, note: r.suggestion, content: r.content, createdAt: r.followUpTime },
        };
      }
      if (type === 'PatientDirectMessage' || type === 'PatientDirectMessageAck') {
        const r = await this.prisma.patientDirectMessage.findUnique({ where: { id } });
        if (!r) return null;
        return {
          type: 'PatientDirectMessage', inferred, submittedAt: submittedAt ?? r.acknowledgedAt,
          data: { content: r.content, requiresAck: r.requiresAck, acknowledgedAt: r.acknowledgedAt },
        };
      }
    } catch {
      return null;
    }
    return null;
  }"""
    if "async messageDetail(" not in src:
        src = replace_once(src, old_list, new_list, "admin listMessages pagination + detail")
        changed = True

    # 3b. resendMessage → reuse message, append NURSE_RESEND attempt
    old_resend = """    const message = await this.prisma.patientOutboundMessage.findUnique({ where: { id } });
    if (!message) throw new NotFoundException('Message not found');
    if (!message.formLinkId) throw new ForbiddenException('该消息没有关联表单链接, 无法重发');
    const formLink = await this.prisma.patientFormLink.findUnique({ where: { id: message.formLinkId } });
    if (!formLink) throw new NotFoundException('Form link not found');
    if (formLink.status !== 'ACTIVE') {
      throw new ForbiddenException('原链接状态已变更, 请先撤销并重新生成');
    }
    const patient = await this.prisma.patient.findUnique({
      where: { id: message.patientId },
      include: {
        wechatIdentities: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const account = formLink.hospitalTenantId
      ? await this.accounts.getAccountForTenant(formLink.hospitalTenantId)
      : null;
    const scopedOpenId = (() => {
      if (!account) return null;
      const match = patient.wechatIdentities.find(
        (i) =>
          i.hospitalTenantId === formLink.hospitalTenantId &&
          i.appId === account.appId &&
          i.isVerified,
      );
      return match?.openId ?? null;
    })();

    const channel = (dto.preferredChannel as any) || message.channel;
    const sendOutcome = await this.engagement.sendForLink({
      formLink: {
        id: formLink.id,
        patientId: formLink.patientId,
        type: formLink.type,
        title: formLink.title,
        description: formLink.description,
        hospitalTenantId: formLink.hospitalTenantId,
      },
      patient: { id: patient.id, phone: patient.phone, scopedOpenId },
      channel,
      linkUrl: message.linkUrl || this.formLink.buildLinkUrl('__expired__'),
      createdBy: user.id,
    });

    await this.audit.record({
      user,
      action: 'PATIENT_ENGAGEMENT_MESSAGE_RESENT',
      targetType: 'PatientOutboundMessage',
      targetId: id,
      ipAddress: req?.ip,
      afterData: { channel, formLinkId: formLink.id },
    });
    return sendOutcome;
  }"""
    new_resend = """    const message = await this.prisma.patientOutboundMessage.findUnique({ where: { id } });
    if (!message) throw new NotFoundException('Message not found');
    if (!message.formLinkId) throw new ForbiddenException('该消息没有关联表单链接, 无法重发');
    const formLink = await this.prisma.patientFormLink.findUnique({ where: { id: message.formLinkId } });
    if (!formLink) throw new NotFoundException('Form link not found');
    // v3.2: resend reuses the same case (message). Do NOT implicitly create a
    // new link/case — if the link is no longer usable, fail clearly.
    if (formLink.status === 'REVOKED' || formLink.revokedAt) {
      throw new ForbiddenException('该链接已失效, 无法再次发送, 请重新创建随访案件.');
    }
    if (formLink.status === 'USED' || formLink.submitCount >= formLink.maxSubmit) {
      throw new ForbiddenException('该链接已被患者提交, 无需再次发送.');
    }
    if (formLink.status === 'EXPIRED' || (formLink.expiresAt && formLink.expiresAt.getTime() <= Date.now())) {
      throw new ForbiddenException('该链接已过期, 请重新创建随访案件.');
    }
    if (formLink.status !== 'ACTIVE') {
      throw new ForbiddenException('原链接状态已变更, 无法再次发送.');
    }
    const patient = await this.prisma.patient.findUnique({
      where: { id: message.patientId },
      include: {
        wechatIdentities: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const account = formLink.hospitalTenantId
      ? await this.accounts.getAccountForTenant(formLink.hospitalTenantId)
      : null;
    const scopedOpenId = (() => {
      if (!account) return null;
      const match = patient.wechatIdentities.find(
        (i) =>
          i.hospitalTenantId === formLink.hospitalTenantId &&
          i.appId === account.appId &&
          i.isVerified,
      );
      return match?.openId ?? null;
    })();

    // Default to AUTO so the system re-picks 本院服务号 / 短信兜底.
    let channel = (dto.preferredChannel as any) || 'AUTO';
    if (channel === 'AUTO') channel = scopedOpenId ? 'WECHAT_OFFICIAL_ACCOUNT' : 'SMS';
    if (channel === 'MANUAL_COPY') channel = scopedOpenId ? 'WECHAT_OFFICIAL_ACCOUNT' : 'SMS';

    const sendOutcome = await this.engagement.sendForLink({
      formLink: {
        id: formLink.id,
        patientId: formLink.patientId,
        type: formLink.type,
        title: formLink.title,
        description: formLink.description,
        hospitalTenantId: formLink.hospitalTenantId,
      },
      patient: { id: patient.id, phone: patient.phone, scopedOpenId },
      channel,
      linkUrl: message.linkUrl || this.formLink.buildLinkUrl('__expired__'),
      createdBy: user.id,
      // v3.2: reuse this message; append attempts instead of new rows.
      reuseMessageId: message.id,
      triggerReason: 'NURSE_RESEND',
    } as any);

    await this.audit.record({
      user,
      action: 'PATIENT_ENGAGEMENT_MESSAGE_RESENT',
      targetType: 'PatientOutboundMessage',
      targetId: id,
      ipAddress: req?.ip,
      afterData: { channel, formLinkId: formLink.id, reused: true },
    });
    return sendOutcome;
  }"""
    if "reuseMessageId: message.id" not in src:
        src = replace_once(src, old_resend, new_resend, "admin resendMessage reuse")
        changed = True

    # 3c. revokeLink → also CANCEL the message + LINK_REVOKED event
    old_revoke = """    this.tenant.assertWriteAllowed(user);
    await this.tenant.assertFormLinkVisibleToUser(id, user);
    const updated = await this.formLink.revoke(id, dto.reason, user.id);
    await this.prisma.engagementEventLog.create({
      data: {
        formLinkId: id,
        eventType: 'TOKEN_REVOKED',
        metadata: { reason: dto.reason, operatorId: user.id } as any,
      },
    });"""
    new_revoke = """    this.tenant.assertWriteAllowed(user);
    await this.tenant.assertFormLinkVisibleToUser(id, user);
    const updated = await this.formLink.revoke(id, dto.reason, user.id);
    // v3.2: the case is no longer live — mark its message CANCELED (unless the
    // patient already submitted) so the list reflects 已失效.
    await this.prisma.patientOutboundMessage.updateMany({
      where: { formLinkId: id, status: { notIn: ['SUBMITTED', 'CANCELED'] } },
      data: { status: 'CANCELED' },
    });
    await this.prisma.engagementEventLog.create({
      data: {
        formLinkId: id,
        eventType: 'LINK_REVOKED',
        metadata: { reason: dto.reason, operatorId: user.id } as any,
      },
    });"""
    if "eventType: 'LINK_REVOKED'" not in src:
        src = replace_once(src, old_revoke, new_revoke, "admin revoke cancel")
        changed = True

    if changed:
        ADMIN.write_text(src, encoding="utf-8")
        changed_files.append("admin-patient-engagement.controller.ts")
        print("[ok] patched admin-patient-engagement.controller.ts")
    else:
        print("[skip] admin controller already at v3.2")


# ---------------------------------------------------------------------------
# 4) public-form.controller.ts — submission linkage + visit feedback + revoked msg
# ---------------------------------------------------------------------------
def _patch_pfc_impl() -> None:
    src = need(PFC)
    changed = False

    # 4a. GET :token returns revokeReason (friendly REVOKED page)
    if "revokeReason: formLink.revokeReason" not in src:
        old = """      valid: formLink.status === 'ACTIVE',
      status: formLink.status,
      type: formLink.type,
      title: formLink.title,
      description: formLink.description,
      expiresAt: formLink.expiresAt,"""
        new = """      valid: formLink.status === 'ACTIVE',
      status: formLink.status,
      // v3.2: surface revoke reason so the H5 page can show a friendly
      // \"该提醒已失效\" message instead of a raw token error.
      revokeReason: formLink.revokeReason ?? null,
      type: formLink.type,
      title: formLink.title,
      description: formLink.description,
      expiresAt: formLink.expiresAt,"""
        src = replace_once(src, old, new, "pfc GET revokeReason")
        changed = True

    # 4b. questionnaire submit → link submission
    if "_linkSubmissionInTx(tx, formLink.id, 'QuestionnaireResult'" not in src:
        old = "      await this._tryCompleteOccurrenceInTx(tx, formLink.id, 'QuestionnaireResult', qr.id);"
        new = (
            "      await this._linkSubmissionInTx(tx, formLink.id, 'QuestionnaireResult', qr.id);\n"
            "      await this._tryCompleteOccurrenceInTx(tx, formLink.id, 'QuestionnaireResult', qr.id);"
        )
        src = replace_once(src, old, new, "pfc questionnaire link")
        changed = True

    # 4c. vital submit → link submission
    if "_linkSubmissionInTx(tx, formLink.id, 'VitalRecord'" not in src:
        old = "        await this._tryCompleteOccurrenceInTx(tx, formLink.id, 'VitalRecord', created[0].id);"
        new = (
            "        await this._linkSubmissionInTx(tx, formLink.id, 'VitalRecord', created[0].id);\n"
            "        await this._tryCompleteOccurrenceInTx(tx, formLink.id, 'VitalRecord', created[0].id);"
        )
        src = replace_once(src, old, new, "pfc vital link")
        changed = True

    # 4d. medication submit → link submission
    if "_linkSubmissionInTx(tx, formLink.id, 'MedicationCheckIn'" not in src:
        old = "      await this._tryCompleteOccurrenceInTx(tx, formLink.id, 'MedicationCheckIn', checkIn.id);"
        new = (
            "      await this._linkSubmissionInTx(tx, formLink.id, 'MedicationCheckIn', checkIn.id);\n"
            "      await this._tryCompleteOccurrenceInTx(tx, formLink.id, 'MedicationCheckIn', checkIn.id);"
        )
        src = replace_once(src, old, new, "pfc medication link")
        changed = True

    # 4e. hospital-visit submit → create HospitalVisitFeedback + link submission
    if "hospitalVisitFeedback.create" not in src:
        old = """      await tx.patientOutboundMessage.updateMany({
        where: { formLinkId: formLink.id, status: { in: ['SENT', 'PENDING', 'CLICKED'] } },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });

      // v3: mark linked CareReminderOccurrence COMPLETED (no-op if none).
      await this._tryCompleteOccurrenceInTx(tx, formLink.id, 'FollowUpRecord', followUp.id);

      return { followUp, reminderUpdated, taskCreated };"""
        new = """      // v3.2: structured patient 到院反馈 (distinct from the nurse-side followUp).
      const feedback = await tx.hospitalVisitFeedback.create({
        data: {
          hospitalTenantId: formLink.hospitalTenantId ?? '',
          patientId: formLink.patientId,
          formLinkId: formLink.id,
          hospitalVisitReminderId: reminderId ?? undefined,
          taskId: taskCreated?.id ?? undefined,
          riskAlertId: reminderUpdated?.sourceRiskAlertId ?? undefined,
          action,
          note: dto.note ?? undefined,
          source: 'H5_LINK',
        },
      });

      await tx.patientOutboundMessage.updateMany({
        where: { formLinkId: formLink.id, status: { in: ['SENT', 'PENDING', 'CLICKED'] } },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });

      await this._linkSubmissionInTx(tx, formLink.id, 'HospitalVisitFeedback', feedback.id);
      // v3: mark linked CareReminderOccurrence COMPLETED (no-op if none).
      await this._tryCompleteOccurrenceInTx(tx, formLink.id, 'FollowUpRecord', followUp.id);

      return { followUp, reminderUpdated, taskCreated, feedback };"""
        src = replace_once(src, old, new, "pfc hospital-visit feedback")
        changed = True

    # 4f. general-message-ack → link submission
    if "'PatientDirectMessage',\n        acknowledgedId ?? formLink.id,\n      );\n      await this._tryCompleteOccurrenceInTx(" not in src:
        old = """      await this._tryCompleteOccurrenceInTx(
        tx,
        formLink.id,
        'PatientDirectMessageAck',
        acknowledgedId ?? formLink.id,
      );

      return { acknowledgedId };"""
        new = """      await this._linkSubmissionInTx(
        tx,
        formLink.id,
        'PatientDirectMessage',
        acknowledgedId ?? formLink.id,
      );
      await this._tryCompleteOccurrenceInTx(
        tx,
        formLink.id,
        'PatientDirectMessageAck',
        acknowledgedId ?? formLink.id,
      );

      return { acknowledgedId };"""
        src = replace_once(src, old, new, "pfc general-message-ack link")
        changed = True

    # 4g. add the _linkSubmissionInTx helper next to _tryCompleteOccurrenceInTx
    if "private async _linkSubmissionInTx(" not in src:
        anchor = "  private async _tryCompleteOccurrenceInTx(\n"
        helper = (
            "  // v3.2: record the authoritative submission linkage on the form link so\n"
            "  // the message-detail API can resolve the patient's exact submitted content.\n"
            "  private async _linkSubmissionInTx(\n"
            "    tx: any,\n"
            "    formLinkId: string,\n"
            "    submissionType: string,\n"
            "    submissionId: string,\n"
            "  ): Promise<void> {\n"
            "    try {\n"
            "      await tx.patientFormLink.update({\n"
            "        where: { id: formLinkId },\n"
            "        data: { submissionType, submissionId, submittedAt: new Date() },\n"
            "      });\n"
            "    } catch {\n"
            "      // columns may not exist on trees that haven't run the v3.2 migration\n"
            "    }\n"
            "  }\n\n"
        )
        src = replace_once(src, anchor, helper + anchor, "pfc _linkSubmissionInTx helper")
        changed = True

    if changed:
        PFC.write_text(src, encoding="utf-8")
        changed_files.append("public-form.controller.ts")
        print("[ok] patched public-form.controller.ts")
    else:
        print("[skip] public-form controller already at v3.2")


# ---------------------------------------------------------------------------
# 5) care-reminder-resend.service.ts (v3.1) — reuse message, append attempts
# ---------------------------------------------------------------------------
def _patch_crr_impl() -> None:
    if not CRR.exists():
        print("[skip] care-reminder-resend.service.ts not present (v3.1 not applied) — skipping")
        return
    src = CRR.read_text(encoding="utf-8")
    if "v3.2: reuse the canonical message" in src:
        print("[skip] care-reminder-resend.service.ts already at v3.2")
        return

    # Replace the \"always create a new outbound message\" block with reuse-or-create
    # + attemptDispatch. Anchor on the ALWAYS-create comment block through the
    # dispatch + bookkeeping section.
    old = """    const messageType = this.occurrenceTypeToMessageType(occ.occurrenceType);
    const content = `${schedule?.description || occ.title}\\n（再次提醒）请点击下方链接完成本次任务: ${linkUrl}`;

    // ---- ALWAYS create a fresh outbound message (history) --------------------
    const message = await this.outbound.create({
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

    let dispatchedMessage = message;
    if (channel !== 'MANUAL_COPY') {
      const dispatched = await this.outbound.dispatch(message.id, {
        openId: channel === 'WECHAT_OFFICIAL_ACCOUNT' ? recipient : null,
        phone: channel === 'SMS' ? recipient : null,
      });
      // WeChat→SMS fallback, same as the worker.
      if (
        channel === 'WECHAT_OFFICIAL_ACCOUNT' &&
        dispatched?.status === 'FAILED' &&
        patient.phone
      ) {
        const fb = await this.outbound.create({
          hospitalTenantId: tenantId,
          patientId: occ.patientId,
          formLinkId: formLink.id,
          channel: 'SMS',
          messageType,
          title: occ.title,
          content,
          linkUrl,
          recipient: patient.phone,
          createdBy: null,
          initialStatus: 'PENDING',
        });
        await this.outbound.dispatch(fb.id, { openId: null, phone: patient.phone });
        dispatchedMessage =
          (await this.prisma.patientOutboundMessage.findUnique({ where: { id: fb.id } })) ?? fb;
      } else {
        dispatchedMessage =
          (await this.prisma.patientOutboundMessage.findUnique({ where: { id: message.id } })) ??
          message;
      }
    }"""
    new = """    const messageType = this.occurrenceTypeToMessageType(occ.occurrenceType);
    const content = `${schedule?.description || occ.title}\\n（再次提醒）请点击下方链接完成本次任务: ${linkUrl}`;

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
    }"""
    src = replace_once(src, old, new, "care-reminder resend attempts")
    CRR.write_text(src, encoding="utf-8")
    changed_files.append("care-reminder-resend.service.ts")
    print("[ok] patched care-reminder-resend.service.ts")


# ---------------------------------------------------------------------------
# 6) care-reminder-worker.service.ts — record INITIAL attempt on first dispatch
# ---------------------------------------------------------------------------
def _patch_crw_impl() -> None:
    if not CRW.exists():
        print("[skip] care-reminder-worker.service.ts not present — skipping")
        return
    src = CRW.read_text(encoding="utf-8")
    if "triggerReason: 'INITIAL'" in src:
        print("[skip] care-reminder-worker.service.ts already records attempts")
        return

    # After the primary outbound.dispatch in dispatchOne(), record an INITIAL attempt.
    old = """      const dispatched = await this.outbound.dispatch(message.id, {
        openId: primaryChannel === 'WECHAT_OFFICIAL_ACCOUNT' ? recipient : null,
        phone: primaryChannel === 'SMS' ? recipient : null,
      });"""
    new = """      const dispatched = await this.outbound.dispatch(message.id, {
        openId: primaryChannel === 'WECHAT_OFFICIAL_ACCOUNT' ? recipient : null,
        phone: primaryChannel === 'SMS' ? recipient : null,
      });
      // v3.2: record this as the INITIAL delivery attempt on the canonical message.
      if (primaryChannel !== 'MANUAL_COPY') {
        try {
          await this.outbound.recordAttempt({
            messageId: message.id,
            hospitalTenantId: tenantId,
            patientId: occ.patientId,
            formLinkId: formLink.id,
            channel: primaryChannel as 'WECHAT_OFFICIAL_ACCOUNT' | 'SMS',
            status: dispatched?.status === 'SENT' ? 'SENT' : 'FAILED',
            providerMessageId: dispatched?.providerMessageId ?? null,
            errorMessage: dispatched?.status === 'SENT' ? null : dispatched?.errorMessage ?? '发送失败',
            triggerReason: 'INITIAL',
          });
          await this.outbound.recomputeDelivery(message.id);
        } catch { /* attempts table may be pre-v3.2 */ }
      }"""
    if old not in src:
        # Worker dispatch shape differs; skip gracefully rather than fail the whole patch.
        print("[warn] care-reminder-worker dispatch anchor not found — skipping worker attempt logging")
        return
    src = src.replace(old, new, 1)

    # Also record the SMS fallback attempt inside the worker's fallback branch.
    old_fb = """        const fbDispatched = await this.outbound.dispatch(fb.id, {
          openId: null,
          phone: patient.phone,
        });
        const refreshed = await this.prisma.patientOutboundMessage.findUnique({ where: { id: fb.id } });
        return { formLink, token, linkUrl, message: refreshed };"""
    new_fb = """        const fbDispatched = await this.outbound.dispatch(fb.id, {
          openId: null,
          phone: patient.phone,
        });
        try {
          await this.outbound.recordAttempt({
            messageId: message.id,
            hospitalTenantId: tenantId,
            patientId: occ.patientId,
            formLinkId: formLink.id,
            channel: 'SMS',
            status: fbDispatched?.status === 'SENT' ? 'SENT' : 'FAILED',
            providerMessageId: fbDispatched?.providerMessageId ?? null,
            errorMessage: fbDispatched?.status === 'SENT' ? null : fbDispatched?.errorMessage ?? '发送失败',
            triggerReason: 'AUTO_FALLBACK',
          });
          await this.outbound.recomputeDelivery(message.id);
        } catch { /* attempts table may be pre-v3.2 */ }
        const refreshed = await this.prisma.patientOutboundMessage.findUnique({ where: { id: fb.id } });
        return { formLink, token, linkUrl, message: refreshed };"""
    if old_fb in src:
        src = src.replace(old_fb, new_fb, 1)

    CRW.write_text(src, encoding="utf-8")
    changed_files.append("care-reminder-worker.service.ts")
    print("[ok] patched care-reminder-worker.service.ts")


def _patch_dto_impl() -> None:
    src = need(PE_DTO)
    if "pageSize" in src:
        print("[skip] QueryMessagesDto already has pagination fields")
        return
    old = """  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}"""
    new = """  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  // patient_engagement_v3_2 — pagination
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}"""
    if old not in src:
        fail("QueryMessagesDto from/to block anchor not found")
    src = src.replace(old, new, 1)
    PE_DTO.write_text(src, encoding="utf-8")
    changed_files.append("send-engagement-message.dto.ts")
    print("[ok] patched send-engagement-message.dto.ts")


def main() -> None:
    patch_oms()
    patch_pes()
    _patch_dto_impl()
    patch_admin()
    patch_pfc()
    patch_crr()
    patch_crw()
    if changed_files:
        print("[done] v3.2 backend applied to: " + ", ".join(changed_files))
    else:
        print("[done] no backend changes needed.")


if __name__ == "__main__":
    main()
