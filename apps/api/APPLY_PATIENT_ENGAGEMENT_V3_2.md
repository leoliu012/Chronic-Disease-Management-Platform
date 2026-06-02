# patient_engagement_v3_2_history_detail_filters_patch

v3.2 reworks 微信随访 from a "send log" into a **case list with delivery
attempts + patient submission detail**, and adds list filtering.

## Canonical model

- **PatientOutboundMessage** = one patient-facing case / form / link (a list row).
- **PatientOutboundAttempt** = one delivery attempt (WeChat or SMS) under a message.
- **Resend never creates a new message.** It appends an attempt to the existing
  message. WeChat-failure + SMS-fallback are two attempts on the *same* message.
- The list shows messages; the detail drawer shows the attempts timeline.

This rule is applied to **both** Patient Engagement resend and the v3.1
care-reminder resend (a `CareReminderOccurrence` keeps one canonical message via
`outboundMessageId`; nurse resend reuses it and appends attempts).

## What changed

### Schema (one additive migration `20260601120000_..._history_detail_filters`)
- `PatientOutboundAttempt` (new) — `messageId, channel, status, attemptNo,
  triggerReason (INITIAL/AUTO_FALLBACK/NURSE_RESEND), recipientMasked,
  providerMessageId, errorMessage, sentAt, ...`.
- `HospitalVisitFeedback` (new) — structured 到院反馈 (`action`
  WILL_VISIT/ARRIVED/CANNOT_VISIT/REFUSED, `note`, links to reminder/task/alert).
- `PatientOutboundMessage` += `attempts`, `lastAttemptAt`, `deliverySummary`.
- `PatientFormLink` += `submissionType`, `submissionId`, `submittedAt`
  (authoritative submission linkage).

All columns are additive / nullable-safe; no destructive backfill. Old v3.1
"duplicate resend" message rows remain as legacy data; new resends stop creating
message rows.

### Backend
- `OutboundMessageService`: `recordAttempt()`, `recomputeDelivery()` (rolls
  attempts up into `message.status` + `deliverySummary`, never downgrading
  CLICKED/SUBMITTED/CANCELED), `attemptDispatch()` (dispatch + attempt + recompute).
- `sendForLink()`: one message; initial send + auto SMS fallback are two attempts.
  Supports `reuseMessageId` + `triggerReason` for resend.
- `GET /patient-engagement/messages` — now filterable by `status / messageType /
  channel / from / to` and **paginated**: `{ items, total, page, pageSize }`.
  Tenant isolation unchanged (ADMIN cross-tenant; others own tenant;
  `patientId` still asserts visibility).
- `GET /patient-engagement/messages/:id/detail` (new) — `{ message, formLink,
  attempts, submission }`. `submission` resolves from
  `formLink.submissionType/submissionId` first, then EngagementEventLog metadata
  (legacy fallback, marked `inferred`).
- `resendMessage()` — reuses the case (no new message), appends a `NURSE_RESEND`
  attempt, defaults to AUTO, and returns clear errors when the link is
  revoked / used / expired (never silently makes a new case).
- `revokeLink()` ("使链接失效") — also sets the message to `CANCELED` and writes a
  `LINK_REVOKED` event.
- Public form submit handlers write `formLink.submissionType/submissionId/submittedAt`;
  hospital-visit-confirm also creates a `HospitalVisitFeedback`.
- `GET /public-forms/:token` returns `revokeReason` for the friendly H5 page.
- Care-reminder worker records an INITIAL attempt (and AUTO_FALLBACK on SMS
  fallback) on first dispatch.

The old `mark-manual-sent` and channel-switch endpoints are left intact for
backward compatibility but are no longer called by the UI.

### Frontend
- `PatientEngagementTab` rewritten: filter bar (状态 / 类型 / 创建时间从-至 +
  查询 / 重置), paginated case list with a **发送方式** summary (本院服务号 / 短信 /
  两者; failed channel shown in red), and a **详情抽屉** with 基本信息 / 发送尝试
  timeline / 患者填写内容 / 链接状态 / 操作.
- Removed 改短信 / 改服务号 / 标记手动. "撤销" → **"使链接失效"** (requires a reason
  the patient will see); "已撤销" → "已失效".
- `PublicFormPage` shows a friendly **"该提醒已失效"** page with the nurse's reason
  for REVOKED links (no token error).
- New styles appended to `patient-engagement-admin-tab.css`, consistent with the
  existing `pe-admin-*` look.

### Smoke
`smoke:patient-engagement` rewritten to cover: detail attempts (incl. WeChat
initial), SMS scenario, resend keeps message count but adds an attempt, submit →
detail returns answers/score/riskLevel + submission linkage, revoke →
CANCELED/REVOKED/friendly H5, and filters by status / type / date range +
pagination shape, and asserts the mark-manual/channel-switch buttons are gone
from the tab source. Cross-tenant isolation retained.

## Apply from repo root in WSL

```bash
ZIP="/mnt/c/Users/leoxi/Downloads/patient_engagement_v3_2_history_detail_filters_patch.zip"
TMP="/tmp/patient_engagement_v3_2_history_detail_filters_patch"
rm -rf "$TMP"
mkdir -p "$TMP"
unzip -q "$ZIP" -d "$TMP"
rsync -av "$TMP/" ./

python3 scripts/apply_patient_engagement_v3_2_schema.py
python3 scripts/apply_patient_engagement_v3_2_backend.py
python3 scripts/apply_patient_engagement_v3_2_frontend.py
python3 scripts/apply_patient_engagement_v3_2_package_json.py

cd apps/api
npx prisma generate
npx prisma migrate dev --name patient_engagement_v3_2_history_detail_filters
node prisma/seed-all.js
npm run smoke:patient-engagement

cd ../web
npm run build
```

All four Python patchers are **idempotent** (re-running prints `[skip]`).

### Notes
- **Prereq:** apply the v3.1 care-reminders patch first. The v3.2 backend patcher
  upgrades `care-reminder-resend.service.ts` / `care-reminder-worker.service.ts`
  to the attempt model; if those files aren't present it prints `[skip]` and
  continues (PE features still work).
- The pre-shipped migration means `migrate dev --name ...` just applies it (no
  drift → no duplicate migration). `npx prisma migrate dev` (no name) is equivalent.
- WeChat mock always succeeds when an openId exists, so the smoke exercises the
  SMS *channel* via a patient without an openId rather than a WeChat→SMS fallback;
  the fallback path itself is covered by `sendForLink`/worker logic.
