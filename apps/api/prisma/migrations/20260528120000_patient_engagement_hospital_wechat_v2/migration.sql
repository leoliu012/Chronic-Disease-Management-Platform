-- patient_engagement_hospital_wechat_v2
--
-- 1. New table  HospitalWechatOfficialAccount  (one row per HospitalTenant)
-- 2. PatientWechatIdentity 加 hospitalTenantId 列, 安全回填, SET NOT NULL,
--    把唯一键从 (appId, openId)  改成 (hospitalTenantId, appId, openId).
--
-- Safe migration order (per spec):
--   - add column nullable
--   - ensure demo-tenant-001 exists
--   - backfill Patient / User where NULL → demo-tenant-001
--   - backfill PatientWechatIdentity.hospitalTenantId from Patient
--   - any leftover → demo-tenant-001
--   - SET NOT NULL
--   - swap unique constraint, add FK
--
-- 对 fresh DB 全部为 no-op; 对已有 v1 数据安全前进.

-- ---------------------------------------------------------------------------
-- 1) HospitalWechatOfficialAccount
-- ---------------------------------------------------------------------------

CREATE TABLE "HospitalWechatOfficialAccount" (
    "id"                        TEXT          NOT NULL,
    "hospitalTenantId"          TEXT          NOT NULL,
    "accountName"               TEXT,
    "originalId"                TEXT,
    "appId"                     TEXT          NOT NULL,
    "appSecretEncrypted"        TEXT          NOT NULL,
    "qrCodeUrl"                 TEXT,
    "h5BaseUrl"                 TEXT,
    "oauthCallbackDomain"       TEXT,
    "templateQuestionnaireId"   TEXT,
    "templateVitalId"           TEXT,
    "templateMedicationId"      TEXT,
    "templateHospitalVisitId"   TEXT,
    "isEnabled"                 BOOLEAN       NOT NULL DEFAULT false,
    "isVerified"                BOOLEAN       NOT NULL DEFAULT false,
    "accessTokenEncrypted"      TEXT,
    "accessTokenExpiresAt"      TIMESTAMP(3),
    "lastTokenRefreshAt"        TIMESTAMP(3),
    "createdAt"                 TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                 TIMESTAMP(3)  NOT NULL,
    CONSTRAINT "HospitalWechatOfficialAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HospitalWechatOfficialAccount_hospitalTenantId_key"
    ON "HospitalWechatOfficialAccount"("hospitalTenantId");
CREATE INDEX "HospitalWechatOfficialAccount_appId_idx"
    ON "HospitalWechatOfficialAccount"("appId");

ALTER TABLE "HospitalWechatOfficialAccount"
    ADD CONSTRAINT "HospitalWechatOfficialAccount_hospitalTenantId_fkey"
    FOREIGN KEY ("hospitalTenantId") REFERENCES "HospitalTenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2) Demo tenant (idempotent insert; needed for the backfill steps below)
--    seed-all.js will upsert this too — we do it here so the migration is
--    self-contained for SET NOT NULL.
-- ---------------------------------------------------------------------------

INSERT INTO "HospitalTenant" ("id", "name", "code", "displayName", "isActive", "createdAt", "updatedAt")
VALUES (
    'demo-tenant-001',
    '某某市人民医院慢病中心',
    'demo-hospital',
    '某某市人民医院 · 慢病管理中心',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) Backfill Patient / User rows that still have NULL hospitalTenantId
--    (v1 seed-all.js already does this for new demos; this catches anything
--    that was created between v1 and v2 without a tenant)
-- ---------------------------------------------------------------------------

UPDATE "Patient"
   SET "hospitalTenantId" = 'demo-tenant-001'
 WHERE "hospitalTenantId" IS NULL
   AND EXISTS (SELECT 1 FROM "HospitalTenant" WHERE "id" = 'demo-tenant-001');

UPDATE "User"
   SET "hospitalTenantId" = 'demo-tenant-001'
 WHERE "hospitalTenantId" IS NULL
   AND EXISTS (SELECT 1 FROM "HospitalTenant" WHERE "id" = 'demo-tenant-001');

-- ---------------------------------------------------------------------------
-- 4) PatientWechatIdentity.hospitalTenantId — add nullable → backfill → NOT NULL
-- ---------------------------------------------------------------------------

ALTER TABLE "PatientWechatIdentity" ADD COLUMN "hospitalTenantId" TEXT;

-- 4a) Inherit from the linked Patient
UPDATE "PatientWechatIdentity" pwi
   SET "hospitalTenantId" = p."hospitalTenantId"
  FROM "Patient" p
 WHERE pwi."patientId" = p."id"
   AND pwi."hospitalTenantId" IS NULL;

-- 4b) Any leftover (orphan identity, patient without tenant) → demo tenant
UPDATE "PatientWechatIdentity"
   SET "hospitalTenantId" = 'demo-tenant-001'
 WHERE "hospitalTenantId" IS NULL
   AND EXISTS (SELECT 1 FROM "HospitalTenant" WHERE "id" = 'demo-tenant-001');

-- 4c) SET NOT NULL (will fail loudly if anything is still NULL — that means
--     the demo tenant insert above didn't take, which is itself a clear signal)
ALTER TABLE "PatientWechatIdentity" ALTER COLUMN "hospitalTenantId" SET NOT NULL;

-- 4d) Swap unique constraint: (appId,openId) → (hospitalTenantId,appId,openId)
ALTER TABLE "PatientWechatIdentity" DROP CONSTRAINT IF EXISTS "PatientWechatIdentity_appId_openId_key";
DROP INDEX IF EXISTS "PatientWechatIdentity_appId_openId_key";

CREATE UNIQUE INDEX "PatientWechatIdentity_hospitalTenantId_appId_openId_key"
    ON "PatientWechatIdentity"("hospitalTenantId", "appId", "openId");
CREATE INDEX "PatientWechatIdentity_hospitalTenantId_idx"
    ON "PatientWechatIdentity"("hospitalTenantId");

-- 4e) Foreign key
ALTER TABLE "PatientWechatIdentity"
    ADD CONSTRAINT "PatientWechatIdentity_hospitalTenantId_fkey"
    FOREIGN KEY ("hospitalTenantId") REFERENCES "HospitalTenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
