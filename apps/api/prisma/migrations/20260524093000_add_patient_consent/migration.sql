-- PatientConsent — 患者端统一知情同意书记录 (patient-self-consent-bind)
--
-- 不论患者来自邀约库 (ChronicLead)、已有 Patient 档案，还是 HIS 暂存患者信息，
-- 只要患者在小程序绑定流程里签署《知情同意与隐私授权协议》，都在这里落一条独立记录。
--
-- 与 ChronicLead / Patient / PatientBindingRequest 松耦合（仅存 id，不建外键），
-- 因为同意书在「提交绑定申请」之前先签，签署时这些行可能尚未创建。

-- CreateEnum
CREATE TYPE "PatientConsentSource" AS ENUM (
    'MINI_PROGRAM',
    'NURSE_PROXY',
    'DOCTOR_PROXY'
);

-- CreateEnum
CREATE TYPE "PatientConsentStatus" AS ENUM (
    'SIGNED',
    'SUPERSEDED',
    'REVOKED'
);

-- CreateTable
CREATE TABLE "PatientConsent" (
    "id" TEXT NOT NULL,
    "demoOpenId" TEXT NOT NULL,
    "hospitalPatientId" TEXT,
    "chronicLeadId" TEXT,
    "patientId" TEXT,
    "bindingRequestId" TEXT,
    "consentVersion" TEXT NOT NULL,
    "consentSource" "PatientConsentSource" NOT NULL DEFAULT 'MINI_PROGRAM',
    "consentTextSnapshot" TEXT,
    "matchType" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "status" "PatientConsentStatus" NOT NULL DEFAULT 'SIGNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientConsent_demoOpenId_status_createdAt_idx" ON "PatientConsent"("demoOpenId", "status", "createdAt");
CREATE INDEX "PatientConsent_chronicLeadId_idx" ON "PatientConsent"("chronicLeadId");
CREATE INDEX "PatientConsent_patientId_idx" ON "PatientConsent"("patientId");
CREATE INDEX "PatientConsent_bindingRequestId_idx" ON "PatientConsent"("bindingRequestId");
CREATE INDEX "PatientConsent_hospitalPatientId_idx" ON "PatientConsent"("hospitalPatientId");
