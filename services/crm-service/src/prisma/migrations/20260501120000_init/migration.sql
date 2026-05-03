-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('OPEN', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CALL', 'EMAIL', 'NOTE');

CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Customer_tenantId_idx" ON "Customer"("tenantId");

CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "email" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'OPEN',
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Lead_tenantId_idx" ON "Lead"("tenantId");
CREATE INDEX "Lead_customerId_idx" ON "Lead"("customerId");

CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "customerId" TEXT,
    "leadId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Activity_tenantId_idx" ON "Activity"("tenantId");
CREATE INDEX "Activity_customerId_idx" ON "Activity"("customerId");
CREATE INDEX "Activity_leadId_idx" ON "Activity"("leadId");

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Activity" ADD CONSTRAINT "Activity_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Activity" ADD CONSTRAINT "Activity_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
