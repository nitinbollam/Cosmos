-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MSAStatus" AS ENUM ('GENERATED', 'SUBMITTED', 'SUBMISSION_FAILED', 'ACCEPTED');

-- CreateTable
CREATE TABLE "MSATenant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "msaEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reporterDid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MSATenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MSAManufacturerDid" (
    "id" TEXT NOT NULL,
    "msaTenantId" TEXT NOT NULL,
    "reporterDid" TEXT NOT NULL,
    "manufacturerDid" TEXT NOT NULL,
    "manufacturerName" TEXT NOT NULL,
    "ediEndpoint" TEXT,
    "autoSubmit" BOOLEAN NOT NULL DEFAULT false,
    "ediCredentials" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MSAManufacturerDid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MSATransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "manufacturerDid" TEXT NOT NULL,
    "upcCode" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "quantityPurchased" INTEGER NOT NULL,
    "cartonCount" INTEGER NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "returnAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isQualifying" BOOLEAN NOT NULL DEFAULT true,
    "orderId" TEXT,
    "poId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MSATransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MSAReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reporterDid" TEXT NOT NULL,
    "manufacturerDid" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnding" TIMESTAMP(3) NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "totalTransactions" INTEGER NOT NULL,
    "netPurchases" DECIMAL(14,2) NOT NULL,
    "status" "MSAStatus" NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "submissionConfirmation" TEXT,
    "submissionError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MSAReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "manufactureDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "recalled" BOOLEAN NOT NULL DEFAULT false,
    "recalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MSATenant_tenantId_key" ON "MSATenant"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MSAManufacturerDid_msaTenantId_manufacturerDid_key" ON "MSAManufacturerDid"("msaTenantId", "manufacturerDid");

-- CreateIndex
CREATE INDEX "MSATransaction_tenantId_manufacturerDid_transactionDate_idx" ON "MSATransaction"("tenantId", "manufacturerDid", "transactionDate");

-- CreateIndex
CREATE INDEX "MSATransaction_tenantId_isQualifying_idx" ON "MSATransaction"("tenantId", "isQualifying");

-- CreateIndex
CREATE INDEX "MSAReport_tenantId_status_idx" ON "MSAReport"("tenantId", "status");

-- CreateIndex
CREATE INDEX "MSAReport_tenantId_weekEnding_idx" ON "MSAReport"("tenantId", "weekEnding");

-- CreateIndex
CREATE INDEX "Batch_tenantId_expiryDate_idx" ON "Batch"("tenantId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_tenantId_skuId_batchNumber_key" ON "Batch"("tenantId", "skuId", "batchNumber");

-- AddForeignKey
ALTER TABLE "MSAManufacturerDid" ADD CONSTRAINT "MSAManufacturerDid_msaTenantId_fkey" FOREIGN KEY ("msaTenantId") REFERENCES "MSATenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

