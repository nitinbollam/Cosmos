-- CreateEnum
CREATE TYPE "TenantPlan" AS ENUM ('STARTER', 'GROWTH', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "OnboardingPhase" AS ENUM ('PROFILE', 'BILLING', 'READY');

-- CreateTable
CREATE TABLE "TenantOrganization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "plan" "TenantPlan" NOT NULL DEFAULT 'STARTER',
    "onboardingPhase" "OnboardingPhase" NOT NULL DEFAULT 'PROFILE',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "billingEmail" TEXT,
    "timeZone" TEXT NOT NULL DEFAULT 'Etc/UTC',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantOnboardingStep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "payload" JSONB,

    CONSTRAINT "TenantOnboardingStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantOrganization_slug_key" ON "TenantOrganization"("slug");

-- CreateIndex
CREATE INDEX "TenantOrganization_slug_idx" ON "TenantOrganization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TenantOnboardingStep_tenantId_stepKey_key" ON "TenantOnboardingStep"("tenantId", "stepKey");

-- CreateIndex
CREATE INDEX "TenantOnboardingStep_tenantId_idx" ON "TenantOnboardingStep"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantOnboardingStep" ADD CONSTRAINT "TenantOnboardingStep_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
