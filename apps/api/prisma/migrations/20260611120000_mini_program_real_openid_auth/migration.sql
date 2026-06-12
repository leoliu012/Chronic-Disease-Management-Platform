CREATE TABLE "MiniProgramAuthSession" (
  "id" TEXT NOT NULL,
  "miniProgramAppId" TEXT NOT NULL,
  "miniProgramOpenId" TEXT NOT NULL,
  "miniProgramUnionId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MiniProgramAuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MiniProgramAuthSession_tokenHash_key" ON "MiniProgramAuthSession"("tokenHash");
CREATE INDEX "MiniProgramAuthSession_miniProgramAppId_miniProgramOpenId_idx" ON "MiniProgramAuthSession"("miniProgramAppId", "miniProgramOpenId");
CREATE INDEX "MiniProgramAuthSession_expiresAt_idx" ON "MiniProgramAuthSession"("expiresAt");

ALTER TABLE "PatientBindingRequest"
  ADD COLUMN "miniProgramAppId" TEXT,
  ADD COLUMN "miniProgramOpenId" TEXT,
  ADD COLUMN "miniProgramUnionId" TEXT,
  ALTER COLUMN "demoOpenId" DROP NOT NULL;

ALTER TABLE "PatientSession"
  ADD COLUMN "miniProgramAppId" TEXT,
  ADD COLUMN "miniProgramOpenId" TEXT,
  ADD COLUMN "miniProgramUnionId" TEXT,
  ALTER COLUMN "demoOpenId" DROP NOT NULL;

ALTER TABLE "PatientConsent"
  ADD COLUMN "miniProgramAppId" TEXT,
  ADD COLUMN "miniProgramOpenId" TEXT,
  ADD COLUMN "miniProgramUnionId" TEXT,
  ALTER COLUMN "demoOpenId" DROP NOT NULL;

CREATE INDEX "PatientBindingRequest_miniProgramAppId_miniProgramOpenId_status_createdAt_idx"
  ON "PatientBindingRequest"("miniProgramAppId", "miniProgramOpenId", "status", "createdAt");

CREATE INDEX "PatientSession_miniProgramAppId_miniProgramOpenId_patientId_idx"
  ON "PatientSession"("miniProgramAppId", "miniProgramOpenId", "patientId");

CREATE INDEX "PatientConsent_miniProgramAppId_miniProgramOpenId_status_createdAt_idx"
  ON "PatientConsent"("miniProgramAppId", "miniProgramOpenId", "status", "createdAt");
