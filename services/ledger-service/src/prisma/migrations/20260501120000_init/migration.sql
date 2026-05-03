-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

CREATE TABLE "ChartAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChartAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChartAccount_tenantId_code_key" ON "ChartAccount"("tenantId", "code");
CREATE INDEX "ChartAccount_tenantId_idx" ON "ChartAccount"("tenantId");

CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fiscalPeriodClosed" BOOLEAN NOT NULL DEFAULT false,
    "isPosted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JournalEntry_tenantId_postedAt_idx" ON "JournalEntry"("tenantId", "postedAt");

CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "memo" TEXT,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "ChartAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
