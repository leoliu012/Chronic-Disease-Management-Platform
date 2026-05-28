-- ============================================================================
-- patient_engagement_wechat_h5_v1
--
-- 患者触达 Patient Engagement:
--   平台服务号 + H5 一次性安全链接 + 短信兜底 + 手动复制.
--   小程序保留但不强制. 不接企业微信. 各医院在平台后台多租户管理.
--
-- 新增表:
--   HospitalTenant            — 平台多租户分组
--   PatientWechatIdentity     — 患者 ↔ 平台服务号 openId
--   PatientFormLink           — 一次性 H5 任务链接 (token hash)
--   PatientOutboundMessage    — 触达消息流水 (wechat / sms / manual)
--   EngagementEventLog        — 触达细粒度审计
--
-- 兼容性:
--   User / Patient 各加一个可选 hospitalTenantId, 旧数据保持 NULL,
--   seed 脚本会把 demo 数据回填到 demo-hospital tenant.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- HospitalTenant
-- ----------------------------------------------------------------------------
CREATE TABLE "HospitalTenant" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "displayName" TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "HospitalTenant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HospitalTenant_code_key" ON "HospitalTenant"("code");

-- ----------------------------------------------------------------------------
-- User.hospitalTenantId / Patient.hospitalTenantId  (both optional)
-- ----------------------------------------------------------------------------
ALTER TABLE "User"    ADD COLUMN "hospitalTenantId" TEXT;
ALTER TABLE "Patient" ADD COLUMN "hospitalTenantId" TEXT;

CREATE INDEX "User_hospitalTenantId_idx"    ON "User"("hospitalTenantId");
CREATE INDEX "Patient_hospitalTenantId_idx" ON "Patient"("hospitalTenantId");

ALTER TABLE "User"
  ADD CONSTRAINT "User_hospitalTenantId_fkey"
  FOREIGN KEY ("hospitalTenantId") REFERENCES "HospitalTenant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Patient"
  ADD CONSTRAINT "Patient_hospitalTenantId_fkey"
  FOREIGN KEY ("hospitalTenantId") REFERENCES "HospitalTenant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- PatientWechatIdentity
-- ----------------------------------------------------------------------------
CREATE TABLE "PatientWechatIdentity" (
  "id"          TEXT NOT NULL,
  "patientId"   TEXT NOT NULL,
  "appId"       TEXT NOT NULL,
  "openId"      TEXT NOT NULL,
  "unionId"     TEXT,
  "source"      TEXT NOT NULL,
  "isVerified"  BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PatientWechatIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientWechatIdentity_appId_openId_key"
  ON "PatientWechatIdentity"("appId", "openId");
CREATE INDEX "PatientWechatIdentity_patientId_idx"
  ON "PatientWechatIdentity"("patientId");
CREATE INDEX "PatientWechatIdentity_unionId_idx"
  ON "PatientWechatIdentity"("unionId");

ALTER TABLE "PatientWechatIdentity"
  ADD CONSTRAINT "PatientWechatIdentity_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- PatientFormLink
-- ----------------------------------------------------------------------------
CREATE TABLE "PatientFormLink" (
  "id"               TEXT NOT NULL,
  "hospitalTenantId" TEXT,
  "patientId"        TEXT NOT NULL,
  "taskId"           TEXT,
  "riskAlertId"      TEXT,
  "type"             TEXT NOT NULL,
  "tokenHash"        TEXT NOT NULL,
  "shortCode"        TEXT,
  "title"            TEXT NOT NULL,
  "description"      TEXT,
  "payload"          JSONB,
  "expiresAt"        TIMESTAMP(3) NOT NULL,
  "usedAt"           TIMESTAMP(3),
  "revokedAt"        TIMESTAMP(3),
  "revokeReason"     TEXT,
  "maxSubmit"        INTEGER NOT NULL DEFAULT 1,
  "submitCount"      INTEGER NOT NULL DEFAULT 0,
  "status"           TEXT NOT NULL DEFAULT 'ACTIVE',
  "requiresIdentityCheck" BOOLEAN NOT NULL DEFAULT false,
  "identityCheckFailureCount" INTEGER NOT NULL DEFAULT 0,
  "identityLockedUntil"       TIMESTAMP(3),
  "createdBy"        TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PatientFormLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientFormLink_tokenHash_key" ON "PatientFormLink"("tokenHash");
CREATE UNIQUE INDEX "PatientFormLink_shortCode_key" ON "PatientFormLink"("shortCode");
CREATE INDEX "PatientFormLink_hospitalTenantId_idx" ON "PatientFormLink"("hospitalTenantId");
CREATE INDEX "PatientFormLink_patientId_type_status_idx"
  ON "PatientFormLink"("patientId", "type", "status");
CREATE INDEX "PatientFormLink_taskId_idx"      ON "PatientFormLink"("taskId");
CREATE INDEX "PatientFormLink_riskAlertId_idx" ON "PatientFormLink"("riskAlertId");
CREATE INDEX "PatientFormLink_expiresAt_idx"   ON "PatientFormLink"("expiresAt");

ALTER TABLE "PatientFormLink"
  ADD CONSTRAINT "PatientFormLink_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientFormLink"
  ADD CONSTRAINT "PatientFormLink_hospitalTenantId_fkey"
  FOREIGN KEY ("hospitalTenantId") REFERENCES "HospitalTenant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- PatientOutboundMessage
-- ----------------------------------------------------------------------------
CREATE TABLE "PatientOutboundMessage" (
  "id"                TEXT NOT NULL,
  "hospitalTenantId"  TEXT,
  "patientId"         TEXT NOT NULL,
  "formLinkId"        TEXT,
  "channel"           TEXT NOT NULL,
  "messageType"       TEXT NOT NULL,
  "recipientMasked"   TEXT,
  "recipientRawHash"  TEXT,
  "templateId"        TEXT,
  "title"             TEXT NOT NULL,
  "content"           TEXT NOT NULL,
  "linkUrl"           TEXT,
  "status"            TEXT NOT NULL DEFAULT 'PENDING',
  "providerMessageId" TEXT,
  "errorMessage"      TEXT,
  "sentAt"            TIMESTAMP(3),
  "clickedAt"         TIMESTAMP(3),
  "submittedAt"       TIMESTAMP(3),
  "createdBy"         TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PatientOutboundMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientOutboundMessage_hospitalTenantId_idx"
  ON "PatientOutboundMessage"("hospitalTenantId");
CREATE INDEX "PatientOutboundMessage_patientId_channel_status_idx"
  ON "PatientOutboundMessage"("patientId", "channel", "status");
CREATE INDEX "PatientOutboundMessage_formLinkId_idx"
  ON "PatientOutboundMessage"("formLinkId");
CREATE INDEX "PatientOutboundMessage_messageType_createdAt_idx"
  ON "PatientOutboundMessage"("messageType", "createdAt");

ALTER TABLE "PatientOutboundMessage"
  ADD CONSTRAINT "PatientOutboundMessage_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientOutboundMessage"
  ADD CONSTRAINT "PatientOutboundMessage_formLinkId_fkey"
  FOREIGN KEY ("formLinkId") REFERENCES "PatientFormLink"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PatientOutboundMessage"
  ADD CONSTRAINT "PatientOutboundMessage_hospitalTenantId_fkey"
  FOREIGN KEY ("hospitalTenantId") REFERENCES "HospitalTenant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- EngagementEventLog
-- ----------------------------------------------------------------------------
CREATE TABLE "EngagementEventLog" (
  "id"          TEXT NOT NULL,
  "patientId"   TEXT,
  "formLinkId"  TEXT,
  "eventType"   TEXT NOT NULL,
  "ipAddress"   TEXT,
  "userAgent"   TEXT,
  "metadata"    JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EngagementEventLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EngagementEventLog_patientId_createdAt_idx"
  ON "EngagementEventLog"("patientId", "createdAt");
CREATE INDEX "EngagementEventLog_formLinkId_createdAt_idx"
  ON "EngagementEventLog"("formLinkId", "createdAt");
CREATE INDEX "EngagementEventLog_eventType_createdAt_idx"
  ON "EngagementEventLog"("eventType", "createdAt");
